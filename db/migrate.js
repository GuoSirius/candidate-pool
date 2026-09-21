'use strict';
/*
 * db/migrate.js —— 数据库结构同步（本地 db/local.db ←→ 线上 Cloudflare D1）
 * ---------------------------------------------------------------------------
 * 为什么需要它（2026-09-21 事故）：改了 schema.sql 之后，**没有任何可靠路径**能把它
 * 落到两个库上 —— 详见 db/ddl.js 头部的完整记录。后果是新增的 tail_run / tail_pick
 * 线上从来没建过，四个尾盘页面接口全部 `no such table` → HTTP 500。
 *
 * 现在只需一条命令：
 *   npm run db:migrate          # 同步线上 D1（默认；无凭据则提示并跳过）
 *   npm run db:migrate:local    # 同步本地 db/local.db
 *   npm run db:migrate:both     # 两边一起
 *   npm run db:migrate:dry      # 只打印将执行什么，不写库（安全预览）
 *
 * 幂等性：schema.sql 全部 IF NOT EXISTS，所以本脚本是「收敛到期望状态」，
 * 任何时刻重复运行都没有副作用 —— 不需要「按序号补差」那套记账。
 * schema_meta 表仅记录 schema.sql 的 hash 与已应用的增量迁移，供事后核对。
 *
 * 何时需要手写迁移文件：给**已存在**的表加列/改约束时（CREATE TABLE IF NOT EXISTS
 * 不会补列）。写成 db/migrations/NNN-描述.sql，本脚本按文件名顺序执行且只执行一次。
 */

const crypto = require('crypto');
const { resolveTargets } = require('./clients');
const ddl = require('./ddl');
const { dayjs } = require('../time');

const argv = process.argv;
const DRY = argv.includes('--dry-run') || argv.includes('--dry');
const FORCE = argv.includes('--force');

const META_TABLE = 'schema_meta';
// 与 schema.sql 中的定义保持一致（此处再写一遍是为了「先有表才能读 hash」的启动顺序）
const META_DDL = `CREATE TABLE IF NOT EXISTS ${META_TABLE} (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT)`;

const hash12 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const nowBjt = () => dayjs.tz().format('YYYY-MM-DD HH:mm:ss');
const log = (m) => console.log(m);

/** 从 CREATE TABLE 语句里抽表名（用于「本次新建了哪些表」的汇报）。 */
function tableNames(statements) {
  const out = [];
  for (const s of statements) {
    const m = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_]\w*)/i.exec(s);
    if (m) out.push(m[1]);
  }
  return out;
}

async function existingTables(client) {
  const rows = await client.query("SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set((rows || []).map((r) => r.name));
}

const UPSERT_META = `INSERT INTO ${META_TABLE} (key, value, updated_at) VALUES (?,?,?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

async function syncOne(target, statements, migrations) {
  const { name, client } = target;

  // 探测阶段全部只读：--dry-run 绝不建表、不写入任何东西
  const before = await existingTables(client);
  const wanted = tableNames(statements).filter((t) => t !== META_TABLE);
  const missing = wanted.filter((t) => !before.has(t));

  // schema_meta 可能尚不存在（首次运行），读不到就按「首次记录」处理 —— 不要在这里建表
  let oldHash = null;
  try {
    const oldRows = await client.query(`SELECT value FROM ${META_TABLE} WHERE key = ?`, ['schema_hash']);
    oldHash = oldRows && oldRows.length ? oldRows[0].value : null;
  } catch (_) {
    oldHash = null;
  }

  const newHash = hash12(ddl.readSchema());
  const changed = oldHash !== newHash;

  log(
    `[${name}] 语句 ${statements.length} 条；缺表 ${missing.length ? missing.join(', ') : '无'}；` +
      `hash ${newHash}${oldHash ? (changed ? `（较上次 ${oldHash} 已变化）` : '（与上次一致）') : '（首次记录）'}`,
  );

  if (DRY) {
    log(`[${name}] --dry-run：未写入任何内容`);
    return { name, missing, created: [], changed, wrote: false };
  }

  // 写入前先确保元信息表存在（否则无法记录 hash 与已应用迁移）
  await client.batch([{ sql: META_DDL }]);

  // 收敛结构。missing 单独作为触发条件：即使 hash 相同（例如库被重建过），缺表也要补建。
  if (changed || FORCE || missing.length) {
    await client.batch(statements.map((sql) => ({ sql })));
  }

  // 3) 增量迁移：按文件名顺序，只执行尚未记录过的
  const doneRows = await client.query(`SELECT key FROM ${META_TABLE} WHERE key LIKE 'mig:%'`);
  const done = new Set((doneRows || []).map((r) => r.key));
  const applied = [];
  for (const m of migrations) {
    const key = `mig:${m.name}`;
    if (done.has(key)) continue;
    await client.batch(m.statements.map((sql) => ({ sql })));
    await client.batch([{ sql: UPSERT_META, params: [key, hash12(m.statements.join(';')), nowBjt()] }]);
    applied.push(m.name);
  }

  await client.batch([{ sql: UPSERT_META, params: ['schema_hash', newHash, nowBjt()] }]);

  const after = await existingTables(client);
  const created = wanted.filter((t) => !before.has(t) && after.has(t));
  log(
    `[${name}] 完成` +
      (created.length ? `，新建 ${created.join(', ')}` : '，无需新建表') +
      (applied.length ? `，应用迁移 ${applied.join(', ')}` : ''),
  );
  return { name, missing, created, changed, wrote: true };
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
