'use strict';
// 本地 SQLite 客户端：使用 Node 22 内置 node:sqlite，零依赖。
// 接口与 d1client.js 完全一致（exec / query / batch 均为 async），
// persist.js / enrich_stock_base.js 可以「本地开发」与「Cloudflare D1」之间无缝切换。
//
// 用法：
//   const { createClient } = require('./sqlite_client');
//   const db = createClient();           // 默认 db/local.db
//   const db = createClient('x.db');     // 指定文件
//   await db.query('SELECT ...', [p]);   // 查询 -> 行数组
//   await db.query('INSERT ...', [p]);   // 写入 -> []
//   await db.batch([{sql, params}, ...]);
//   db.close();

const fs = require('fs');
const path = require('path');

// 必须在 require node:sqlite 之前抑制实验性告警（否则仍会在首次加载时打印）
const _origEmit = process.emit;
process.emit = function (type, ...args) {
  if (type === 'warning' && args[0] && args[0].name === 'ExperimentalWarning' &&
      /SQLite/i.test(args[0].message || '')) return false;
  return _origEmit.apply(process, arguments);
};

const { DatabaseSync } = require('node:sqlite');

const paths = require('../paths');

// 本地库文件跟随工作目录（见 paths.js）：默认 <仓库根>/db/local.db。
// 注意 SCHEMA_FILE 是**代码资产**，永远跟包走，不随工作目录移动。
const DEFAULT_FILE = paths.localDb();
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

function applySchema(db) {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  db.exec(sql); // schema.sql 全部 IF NOT EXISTS，可重复执行
}

function createClient(file) {
  const f = file || DEFAULT_FILE;
  const dir = path.dirname(f);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(f);
  // 每次打开都应用 schema.sql：它是唯一真相源，且全部 IF NOT EXISTS，重复执行安全（毫秒级）。
  // 反面教训（2026-09-21 线上四页 500）：原实现是「仅当缺 run_batch 表时才建表」——
  // 于是库早已存在的机器上，后续新增的 tail_run / tail_pick 永远不会被创建，
  // 本地库结构永久停在旧版本，直到某个接口查询时才炸。不要再加任何「缺某表才建」的条件。
  applySchema(db);

  const isRead = (sql) => /^\s*(SELECT|WITH|PRAGMA|EXPLAIN|VALUES)\b/i.test(sql.trim());

  async function exec(sql) { db.exec(sql); return []; }

  async function query(sql, params = []) {
    const ps = db.prepare(sql);
    if (isRead(sql)) return ps.all(...params);
    ps.run(...params);
    return [];
  }

  async function batch(statements) {
    // 显式事务（不依赖 node:sqlite 的 db.transaction，跨版本更稳）
    db.exec('BEGIN');
    try {
      for (const st of statements) db.prepare(st.sql).run(...(st.params || []));
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw e;
    }
    return [];
  }

  function close() { try { db.close(); } catch (_) {} }

  return { exec, query, batch, close, file: f };
}

module.exports = { createClient, DEFAULT_FILE };
