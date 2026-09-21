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

async function post(path, body) {
  const c = endpoint();
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.ACCOUNT_ID}/d1/database/${c.DB_ID}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!j.success) throw new Error('CF D1 API 错误: ' + JSON.stringify(j.errors || j.messages || j));
  return j.result;
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
// 说明：Cloudflare D1 的 /execute 路由在本账号/数据库稳定返回 404 "Route not found"，
// 而 /query 的批量 { statements:[...] } 入参也被拒绝（要求单个 sql）。
// 因此改为走 /query 逐条提交 { sql, params }（与 query() 同一可用路径），
// 以有界并发（CONC）提交，避免串行过慢、又不过度压测 API 限流。
const BATCH_CONC = 10;
async function batch(statements) {
  const out = [];
  for (let i = 0; i < statements.length; i += BATCH_CONC) {
    const slice = statements.slice(i, i + BATCH_CONC);
    const results = await Promise.all(slice.map(s =>
      post('/query', { sql: s.sql, params: s.params || [] })
    ));
    results.forEach(r => { if (Array.isArray(r)) out.push(...r); });
  }
  return out;
}

exports.exec = exec;
exports.query = query;
exports.batch = batch;
