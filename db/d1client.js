'use strict';
// Cloudflare D1 HTTP API 客户端（供本机脚本 / CI 写入，非 Workers 内调用）
// 凭据来源（优先级从高到低）：
//   1) 真实环境变量 CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN（CI Secrets / 系统环境变量）
//   2) db/.env —— 由 dotenv 加载，默认**不覆盖**上面已存在的值
// 仅在真正写入时才校验凭据；dry-run 不调用本模块。
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

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
// 批量语句（按 200 条分块，避免单次请求过大）
async function batch(statements) {
  const out = [];
  for (let i = 0; i < statements.length; i += 200) {
    const slice = statements.slice(i, i + 200);
    const r = await post('/execute', { statements: slice });
    (r || []).forEach(x => { if (x && x.results) out.push(...x.results); });
  }
  return out;
}

exports.exec = exec;
exports.query = query;
exports.batch = batch;
