'use strict';
/*
 * db/diff.js —— 结构差异识别（声明式：期望结构 vs 库中实际结构）
 * ---------------------------------------------------------------------------
 * 为什么需要它：
 *   db/migrate.js 若只是把 schema.sql 整份重放，`CREATE TABLE IF NOT EXISTS`
 *   对【已存在的表】是空操作 —— 也就是**新增字段永远不会生效**，只有「新建整表」才生效。
 *   而「给老表加字段」恰恰是最常见的结构变更（本项目已手工加过 run_at / vol_ratio）。
 *
 * 于是把「识别」与「执行」分开：
 *   本文件只做**纯函数**解析与比对（不碰数据库，可单测）；
 *   由 db/migrate.js 决定怎么执行、以及哪些差异必须人工写迁移文件。
 *
 * 能自动处理的（安全、可逆性无要求）：
 *   - 期望里有、库里没有的【表】      → CREATE TABLE
 *   - 期望里有、库里没有的【列】      → ALTER TABLE ... ADD COLUMN（受 SQLite 限制，见 unsafeReason）
 *   - 期望里有、库里没有的【索引】    → CREATE INDEX
 *
 * 只识别、不擅自执行的（必须人工写 db/migrations/NNN-*.sql）：
 *   - 列定义变了（改类型 / 改约束）    → SQLite 不支持直接改，需重建表
 *   - 列被删 / 表被删                  → 涉及数据丢弃，必须人工确认
 *   - 不满足 ALTER 限制的新列          → 见 unsafeReason 的返回原因
 */

const { splitStatements } = require('./ddl');

/** D1 内部表（如 _cf_KV）与 sqlite 内部表不参与比对，避免每次运行都刷警告。 */
const INTERNAL_TABLE = /^(sqlite_|_cf_)/i;

/** 取「从 openIdx 处的左括号」到匹配右括号之间的内容。 */
function extractParenBody(sql, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return sql.slice(openIdx + 1, i);
    }
  }
  return sql.slice(openIdx + 1);
}

/** 按「顶层逗号」切分（跳过括号内的逗号，如 PRIMARY KEY (a, b)）。 */
function splitTopLevel(body) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** 归一化用于比对（忽略空白与大小写的差异）。 */
function normalize(s) {
  return String(s).replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * 标识符：`foo` / "foo" / [foo] / foo 四种写法都要认。
 * 为什么必须处理：`sqlite_master.sql` 存的是**建表原文**，若某侧建表时带了引号
 * （wrangler / D1 控制台 / 手工执行的 DDL 常有），而解析规则只认裸标识符，
 * 结果会是「列被静默丢弃」→ 误判为缺列 → ALTER 报 duplicate column name。
 * 带上引号消除这个隐患，两侧写法不同也能正确比对。
 */
const IDENT = `(?:["\`\\[]([^"\`\\]]+)["\`\\]]|([A-Za-z_]\\w*))`;

/** 从 IDENT 的匹配结果里取名字（去掉引号）。 */
function identName(m, offset) {
  return m[offset + 1] != null ? m[offset + 1] : m[offset + 2];
}

/** 该列定义能否用 `ALTER TABLE ADD COLUMN` 安全追加；不能则给出原因。 */
function unsafeReason(def) {
  const d = normalize(def);
  if (/PRIMARY\s+KEY/.test(d)) return '主键列无法用 ALTER TABLE 追加';
  if (/\bUNIQUE\b/.test(d)) return 'UNIQUE 列无法用 ALTER TABLE 追加';
  if (/AUTOINCREMENT/.test(d)) return 'AUTOINCREMENT 无法用 ALTER TABLE 追加';
  if (/\bNOT\s+NULL\b/.test(d) && !/\bDEFAULT\b/.test(d)) return 'NOT NULL 却没有 DEFAULT，既有行无法补值';
  return null;
}

function parseTableBody(body) {
  const columns = new Map();
  const constraints = [];
  for (const raw of splitTopLevel(body)) {
    const part = raw.trim();
    if (!part) continue;
    // 表级约束（PRIMARY KEY / UNIQUE / FOREIGN KEY / CHECK / CONSTRAINT ...）不是列
    if (/^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT)\b/i.test(part)) {
      constraints.push(normalize(part));
      continue;
    }
    const m = new RegExp(`^${IDENT}\\s+([\\s\\S]+)$`).exec(part);
    if (m) columns.set(identName(m, 0), m[3].trim());
  }
  return { columns, constraints };
}

/**
 * 解析 DDL 文本 → { tables, indexes }。
 * 只识别 CREATE TABLE / CREATE INDEX（本项目 DDL 仅用这两类）。
 * @param {string} sqlText schema.sql 全文，或 sqlite_master.sql 拼接而成的文本
 */
function parseObjects(sqlText) {
  const tables = new Map();
  const indexes = new Map();
  for (const stmt of splitStatements(sqlText)) {
    const t = new RegExp(
      `^\\s*CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}\\s*\\(`,
      'i',
    ).exec(stmt);
    if (t) {
      const name = identName(t, 0);
      const body = extractParenBody(stmt, t.index + t[0].length - 1);
      tables.set(name, { name, ddl: stmt, ...parseTableBody(body) });
      continue;
    }
    const i = new RegExp(
      `^\\s*CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}\\s+ON\\s+${IDENT}`,
      'i',
    ).exec(stmt);
    if (i) {
      const iname = identName(i, 0);
      indexes.set(iname, { name: iname, table: identName(i, 2), ddl: stmt });
    }
  }
  return { tables, indexes };
}

/**
 * 比对期望结构与实际结构。
 * @returns {{addTables: Array, addColumns: Array, unsafeColumns: Array,
 *            changedColumns: Array, addIndexes: Array,
 *            droppedTables: string[], droppedColumns: Array}}
 */
function diffSchema(desired, actual) {
  const addTables = [];
  const addColumns = [];
  const unsafeColumns = [];
  const changedColumns = [];
  const addIndexes = [];
  const droppedTables = [];
  const droppedColumns = [];

  for (const [tname, dt] of desired.tables) {
    const at = actual.tables.get(tname);
    if (!at) {
      addTables.push({ table: tname, ddl: dt.ddl });
      continue;
    }
    for (const [cname, cdef] of dt.columns) {
      const acdef = at.columns.get(cname);
      if (acdef === undefined) {
        const reason = unsafeReason(cdef);
        (reason ? unsafeColumns : addColumns).push({ table: tname, column: cname, def: cdef, reason });
      } else if (normalize(cdef) !== normalize(acdef)) {
        changedColumns.push({ table: tname, column: cname, desired: cdef, actual: acdef });
      }
    }
    for (const cname of at.columns.keys()) {
      if (!dt.columns.has(cname)) droppedColumns.push({ table: tname, column: cname });
    }
  }

  for (const tname of actual.tables.keys()) {
    if (!desired.tables.has(tname) && !INTERNAL_TABLE.test(tname)) droppedTables.push(tname);
  }
  for (const [iname, di] of desired.indexes) {
    if (!actual.indexes.has(iname)) addIndexes.push(di);
  }

  return { addTables, addColumns, unsafeColumns, changedColumns, addIndexes, droppedTables, droppedColumns };
}

/** 差异是否为空（用于判断「结构已经是最新」）。 */
function isEmptyDiff(d) {
  return (
    d.addTables.length === 0 &&
    d.addColumns.length === 0 &&
    d.addIndexes.length === 0 &&
    d.unsafeColumns.length === 0 &&
    d.changedColumns.length === 0 &&
    d.droppedTables.length === 0 &&
    d.droppedColumns.length === 0
  );
}

/**
 * 差异 → 可执行 DDL（纯函数，不碰数据库）。
 * migrate.js 与 db/diff_selftest.js 共用这一份，保证「测的」就是「跑的」。
 * 只输出安全项；unsafeColumns / changedColumns / dropped* 一律不在此处执行。
 * @returns {string[]}
 */
function applyStatements(d) {
  const stmts = [];
  for (const t of d.addTables) stmts.push(t.ddl);
  for (const c of d.addColumns) {
    stmts.push(`ALTER TABLE ${c.table} ADD COLUMN ${c.column} ${c.def}`);
  }
  for (const i of d.addIndexes) stmts.push(i.ddl);
  return stmts;
}

module.exports = {
  parseObjects,
  diffSchema,
  isEmptyDiff,
  applyStatements,
  unsafeReason,
  normalize,
  splitTopLevel,
  INTERNAL_TABLE,
};
