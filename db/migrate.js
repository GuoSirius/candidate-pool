'use strict';
/*
 * db/migrate.js —— 数据库结构同步（本地 db/local.db ←→ 线上 Cloudflare D1）
 * ---------------------------------------------------------------------------
 * 为什么需要它（2026-09-21 事故）：改了 schema.sql 之后，**没有任何可靠路径**能把它
 * 落到两个库上 —— 本地 sqlite 只在「缺 run_batch 表」时才建表，远程完全靠人工
 * `wrangler d1 execute`。于是新增的 tail_run / tail_pick 线上从未被创建，
 * /api/tail/* 全部 `no such table` → 四个页面 HTTP 500。详见 db/ddl.js 头部。
 *
 * 一条命令同步两边：
 *   npm run db:migrate          # 同步线上 D1（默认；无凭据则提示并跳过）
 *   npm run db:migrate:local    # 同步本地 db/local.db
 *   npm run db:migrate:both     # 两边一起
 *   npm run db:migrate:dry      # 只打印差异，不写库（安全预览）
 *
 * 执行策略：**差异驱动**，不是「整份重放」。
 *   schema.sql 是期望结构，先用 db/diff.js 与库中实际结构比对，只补真正缺的东西：
 *     缺表 → CREATE TABLE ；缺列 → ALTER TABLE ADD COLUMN ；缺索引 → CREATE INDEX
 *   （整份重放对已存在的表是空操作，新增字段永远不会生效 —— 所以必须做差异识别。）
 *
 * 需要人工写迁移的情况（本脚本只识别、不擅自执行，避免静默丢数据）：
 *   · 改列定义（类型/约束）→ SQLite 不支持直接改，需重建表
 *   · 删列 / 删表           → 涉及数据丢弃
 *   · 不满足 ALTER 限制的新列（主键 / UNIQUE / NOT NULL 无默认值）
 *   这些写成 db/migrations/NNN-描述.sql，由本脚本按文件名顺序执行且只执行一次。
 */

const crypto = require('crypto');
const { resolveTargets } = require('./clients');
const ddl = require('./ddl');
const diffLib = require('./diff');
const { dayjs } = require('../time');

const argv = process.argv;
const DRY = argv.includes('--dry-run') || argv.includes('--dry');

const META_TABLE = 'schema_meta';
// 与 schema.sql 中的定义保持一致（此处再写一遍是为了「先有表才能读 hash」的启动顺序）
const META_DDL = `CREATE TABLE IF NOT EXISTS ${META_TABLE} (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT)`;
const UPSERT_META = `INSERT INTO ${META_TABLE} (key, value, updated_at) VALUES (?,?,?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

const hash12 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const nowBjt = () => dayjs.tz().format('YYYY-MM-DD HH:mm:ss');
const log = (m) => console.log(m);
const warn = (m) => console.warn(m);

/** 读出库中的实际结构（表 + 索引的 DDL 原文，SQLite 会把 CREATE 语句存在 sqlite_master 里）。 */
async function readActual(client) {
  const tables = await client.query(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL",
  );
  const indexes = await client.query(
    "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL",
  );
  const text = [...tables, ...indexes].map((r) => `${r.sql};`).join('\n');
  return diffLib.parseObjects(text);
}

/** 应用差异：只执行安全项，返回实际执行的语句条数。 */
async function applyDiff(client, d) {
  const stmts = diffLib.applyStatements(d).map((sql) => ({ sql }));
  if (stmts.length) await client.batch(stmts);
  return stmts.length;
}

function reportDiff(tag, d) {
  const bits = [];
  if (d.addTables.length) bits.push(`新建表 ${d.addTables.map((t) => t.table).join(', ')}`);
  if (d.addColumns.length) bits.push(`新增列 ${d.addColumns.map((c) => `${c.table}.${c.column}`).join(', ')}`);
  if (d.addIndexes.length) bits.push(`新建索引 ${d.addIndexes.map((i) => i.name).join(', ')}`);
  log(`[${tag}] ${bits.length ? bits.join('；') : '结构已是最新，无需变更'}`);
}

function reportManual(tag, d) {
  for (const c of d.unsafeColumns) {
    warn(`[${tag}] ⚠ 无法自动加列 ${c.table}.${c.column}（${c.reason}）→ 请写 db/migrations/ 迁移`);
  }
  for (const c of d.changedColumns) {
    warn(`[${tag}] ⚠ 列定义已变 ${c.table}.${c.column}：库里「${c.actual}」≠ 期望「${c.desired}」→ 需手写迁移（SQLite 不支持直接改列）`);
  }
  for (const c of d.droppedColumns) {
    warn(`[${tag}] ⚠ schema.sql 里已没有列 ${c.table}.${c.column}，但库里仍存在：本脚本不会自动删列`);
  }
  for (const t of d.droppedTables) {
    warn(`[${tag}] ⚠ schema.sql 里已没有表 ${t}，但库里仍存在：本脚本不会自动删表`);
  }
}

async function syncOne(target, statements, migrations) {
  const { name, client } = target;

  const desired = diffLib.parseObjects(ddl.readSchema());
  const actual = await readActual(client);
  const d = diffLib.diffSchema(desired, actual);

  let oldHash = null;
  try {
    const rows = await client.query(`SELECT value FROM ${META_TABLE} WHERE key = ?`, ['schema_hash']);
    oldHash = rows && rows.length ? rows[0].value : null;
  } catch (_) {
    oldHash = null; // schema_meta 尚不存在（首次运行）
  }
  const newHash = hash12(ddl.readSchema());

  reportDiff(name, d);
  reportManual(name, d);

  if (DRY) {
    const n = d.addTables.length + d.addColumns.length + d.addIndexes.length;
    log(`[${name}] --dry-run：以上 ${n} 项结构变更未执行；schema hash ${newHash}`);
    return;
  }

  // 写入前先确保元信息表存在（否则无法记录 hash 与已应用迁移）
  await client.batch([{ sql: META_DDL }]);

  let applied = await applyDiff(client, d);

  // 解析器安全网：万一 schema.sql 的写法超出解析能力（解析出 0 张表），退回整份重放。
  // IF NOT EXISTS 保证重放无副作用，只是「新建整表」生效 —— 聊胜于无，不会更糟。
  if (desired.tables.size === 0) {
    warn(`[${name}] ⚠ 未能从 schema.sql 解析出任何表，退化为整份重放（请检查 db/diff.js 的解析规则）`);
    await client.batch(statements.map((sql) => ({ sql })));
    applied += statements.length;
  }

  // 增量迁移：按文件名顺序，只执行尚未记录过的
  const doneRows = await client.query(`SELECT key FROM ${META_TABLE} WHERE key LIKE 'mig:%'`);
  const done = new Set((doneRows || []).map((r) => r.key));
  const migrated = [];
  for (const m of migrations) {
    const key = `mig:${m.name}`;
    if (done.has(key)) continue;
    await client.batch(m.statements.map((sql) => ({ sql })));
    await client.batch([{ sql: UPSERT_META, params: [key, hash12(m.statements.join(';')), nowBjt()] }]);
    migrated.push(m.name);
  }
  if (migrated.length) log(`[${name}] 已应用迁移 ${migrated.join(', ')}`);

  await client.batch([{ sql: UPSERT_META, params: ['schema_hash', newHash, nowBjt()] }]);
  log(
    `[${name}] 完成，执行 ${applied} 条 DDL` +
      (oldHash && oldHash !== newHash ? `；schema hash ${oldHash} → ${newHash}` : `；schema hash ${newHash}`),
  );
}

(async () => {
  const { targets, notes } = resolveTargets(argv);
  for (const n of notes) log(`[提示] ${n}`);

  const statements = ddl.loadStatements();
  const migrations = ddl.loadMigrations();
  log(`[schema] ${ddl.SCHEMA_FILE} → ${statements.length} 条语句；增量迁移文件 ${migrations.length} 个`);

  if (!targets.length) {
    log('[结束] 没有可同步的目标库（配好凭据后重跑，或加 --local 同步本地）');
    return;
  }

  let failed = false;
  for (const t of targets) {
    try {
      await syncOne(t, statements, migrations);
    } catch (e) {
      failed = true;
      console.error(`[${t.name}] 失败：${(e && e.message) || e}`);
    }
  }
  if (failed) process.exit(1);
})().catch((e) => {
  console.error('[致命]', (e && e.stack) || e);
  process.exit(1);
});
