'use strict';
// Cloudflare D1 HTTP API 客户端（供本机脚本 / CI 写入，非 Workers 内调用）
// 凭据来源（优先级从高到低）：
//   1) 真实环境变量 CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN（CI Secrets / 系统环境变量）
//   2) db/.env —— 由 dotenv 加载，默认**不覆盖**上面已存在的值
// 仅在真正写入时才校验凭据；dry-run 不调用本模块。
const path = require('path');
const paths = require('../paths');
// 凭据文件跟随工作目录（见 paths.js）：默认 <仓库根>/db/.env
require('dotenv').config({ path: paths.dbEnvFile(), quiet: true });

function cfg() {
  const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
  const DB_ID = process.env.CF_D1_DATABASE_ID;
  const TOKEN = process.env.CF_API_TOKEN;
  if (!ACCOUNT_ID || !DB_ID || !TOKEN) return null;
  return { ACCOUNT_ID, DB_ID, TOKEN };
}
exports.cfg = cfg;

function endpoint() {
  const c = cfg();
  if (!c) throw new Error('缺少 Cloudflare 凭据：请设置 CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN');
  return c;
}

// HTTP 层健壮性（2026-11-10 评审 #3）：裸 fetch 无超时，CF API 半开连接会让
// syncTailRun / applyTailFill 等定时链路 await 永久挂死。20s 超时 + 3 次退避重试；
// 写入侧全是幂等 UPSERT / INSERT OR IGNORE，重试安全。
const HTTP_TIMEOUT_MS = 20000;
const RETRIES = 3;

async function post(path, body) {
  const c = endpoint();
  const url = `https://api.cloudflare.com/client/v4/accounts/${c.ACCOUNT_ID}/d1/database/${c.DB_ID}${path}`;
  let lastErr;
  for (let i = 0; i < RETRIES; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000 * i));   // 1s / 2s 退避
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const j = await res.json();
      if (!j.success) throw new Error('CF D1 API 错误: ' + JSON.stringify(j.errors || j.messages || j));
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// 单条语句（DDL / 查询 / 单插）
async function exec(sql) {
  const r = await post('/query', { sql });
  return (r && r[0]) ? r[0] : r;
}
// 单条查询，返回结果数组
async function query(sql, params = []) {
  const r = await post('/query', { sql, params });
  return (r && r[0] && r[0].results) || [];
}
// 批量语句（每条语句形如 { sql, params }）
// 2026-11-10 实测（评审 #14）：REST /query 已支持 { batch: [{sql, params}, ...] }，
// 且为隐式事务 —— batch 中途任一语句失败，整批回滚（真实写入探针验证）。
// 旧注释「/query 要求单个 sql」「/execute 404」已过时；params 挂在多语句字符串上
// 仍不被支持（7400），故按「一条语句一个 params」走 batch，与本函数签名天然匹配。
// 分片提交（每片一个原子事务，片间串行保序）；写入侧幂等 UPSERT，片级重试安全。
const BATCH_SIZE = 50;
async function batch(statements) {
  const out = [];
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const slice = statements.slice(i, i + BATCH_SIZE);
    const results = await post('/query', { batch: slice });
    out.push(...results);   // 每元素为单条语句的结果对象（与旧实现输出形状一致）
  }
  return out;
}

exports.exec = exec;
exports.query = query;
exports.batch = batch;
