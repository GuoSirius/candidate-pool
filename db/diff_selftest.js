'use strict';
/*
 * db/diff_selftest.js —— 结构同步的自测（零依赖，node db/diff_selftest.js）
 * ---------------------------------------------------------------------------
 * 为什么必须有：2026-09-21 的事故本质是「结构同步**静默失效**」——本地永不建新表、
 * 远程靠人工执行，两边都不报错，直到接口 500 才被发现。所以「新增字段能否被识别」
 * 这类能力不能只靠一次人工试验，得有可重跑的回归保护。
 *
 * 覆盖：新增列（可自动 / 不可自动）、新增索引、新增表、删列只报告不执行、
 *       引号标识符、幂等性（跑第二遍必须零差异）。
 * 退出码非 0 表示失败。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const diffLib = require('./diff');
const { createClient } = require('./sqlite_client');

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? '  OK  ' : '  FAIL'} ${name}${cond || detail === undefined ? '' : `  → ${detail}`}`);
  if (!cond) failed++;
}
const names = (arr) => arr.map((x) => x.table + '.' + x.column).sort();

// 期望结构：demo 表比库中现状多出 4 列，其中 2 列可自动追加、2 列不允许
const DESIRED = `
CREATE TABLE IF NOT EXISTS demo (
  id TEXT NOT NULL PRIMARY KEY,
  a  TEXT,
  b  REAL,
  c  TEXT NOT NULL,
  d  TEXT UNIQUE,
  e  TEXT NOT NULL DEFAULT 'z'
);
CREATE INDEX IF NOT EXISTS idx_demo_a ON demo (a);
`;

// 库里现状：旧版 demo（无 b/c/d/e）+ 一个 schema 里已删除的列 legacy_col
const LEGACY = `
CREATE TABLE legacy_tbl (x TEXT);
CREATE TABLE demo (id TEXT NOT NULL PRIMARY KEY, a TEXT, legacy_col TEXT);
INSERT INTO demo (id, a, legacy_col) VALUES ('1', 'hello', 'old');
`;

(async () => {
  const file = path.join(os.tmpdir(), `cp-diff-selftest-${process.pid}.db`);
  const client = createClient(file);
  const readActual = async () => {
    // 与 db/migrate.js::readActual 等价的读结构逻辑
    const t = await client.query("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL");
    const i = await client.query("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL");
    return diffLib.parseObjects([...t, ...i].map((r) => `${r.sql};`).join('\n'));
  };

  try {
    await client.exec(LEGACY);

    console.log('\n[1] 差异识别：新增列 / 不可自动列 / 新增索引 / 删列');
    const desired = diffLib.parseObjects(DESIRED);
    const d1 = diffLib.diffSchema(desired, await readActual());
    check('可自动新增列 = demo.b, demo.e', JSON.stringify(names(d1.addColumns)) === JSON.stringify(['demo.b', 'demo.e']), JSON.stringify(names(d1.addColumns)));
    check('不可自动新增列 = demo.c, demo.d', JSON.stringify(names(d1.unsafeColumns)) === JSON.stringify(['demo.c', 'demo.d']), JSON.stringify(names(d1.unsafeColumns)));
    check('新增索引 = idx_demo_a', d1.addIndexes.length === 1 && d1.addIndexes[0].name === 'idx_demo_a', JSON.stringify(d1.addIndexes.map((x) => x.name)));
    check('删列只报告不执行 = demo.legacy_col', d1.droppedColumns.length === 1 && d1.droppedColumns[0].column === 'legacy_col', JSON.stringify(names(d1.droppedColumns)));
    check('不给「不允许的列」生成 DDL', !diffLib.applyStatements(d1).some((s) => /ADD COLUMN (c|d)\b/.test(s)));
    check('不给删列生成 DDL', !diffLib.applyStatements(d1).some((s) => /DROP/i.test(s)));

    console.log('\n[2] 执行差异：DDL 真的能跑通，且存量行不被破坏');
    const stmts = diffLib.applyStatements(d1);
    await client.batch(stmts.map((sql) => ({ sql })));
    const cols = (await client.query('PRAGMA table_info(demo)')).map((r) => r.name);
    check('demo 现含 b/e', cols.includes('b') && cols.includes('e'), cols.join(','));
    const row = (await client.query("SELECT * FROM demo WHERE id='1'"))[0];
    check('存量行 a 保留', row && row.a === 'hello', JSON.stringify(row));
    check('存量行 b 补空值', row && row.b === null, JSON.stringify(row && row.b));
    check("新列 e 取默认值 'z'", row && row.e === 'z', JSON.stringify(row && row.e));
    const idx = (await client.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_demo_a'")).length;
    check('索引已建', idx === 1, String(idx));

    console.log('\n[3] 幂等性：再比一次必须只剩「不可自动」与「删列」');
    const d2 = diffLib.diffSchema(desired, await readActual());
    check('无新增表/列/索引', d2.addTables.length === 0 && d2.addColumns.length === 0 && d2.addIndexes.length === 0, JSON.stringify({ t: d2.addTables.length, c: d2.addColumns.length, i: d2.addIndexes.length }));
    check('DDL 为空（可安全重复跑）', diffLib.applyStatements(d2).length === 0, JSON.stringify(diffLib.applyStatements(d2)));

    console.log('\n[4] 健壮性：引号/反引号/方括号标识符 & 大小写/空白差异不误报');
    const quoted = diffLib.parseObjects(`
      create table if not exists "demo" (
        "id" text not null primary key,
        \`a\`  TEXT,
        [b]    REAL,
        c      TEXT NOT NULL,
        d      TEXT UNIQUE,
        e      TEXT NOT NULL DEFAULT 'z'
      );
      CREATE INDEX IF NOT EXISTS "idx_demo_a" ON "demo" ("a");
    `);
    const d3 = diffLib.diffSchema(quoted, await readActual());
    check('引号写法解析出 6 列', quoted.tables.get('demo') && quoted.tables.get('demo').columns.size === 6, quoted.tables.get('demo') && quoted.tables.get('demo').columns.size);
    check('引号/大小写差异不误报为缺列', d3.addColumns.length === 0 && d3.changedColumns.length === 0, JSON.stringify({ add: names(d3.addColumns), chg: names(d3.changedColumns) }));

    console.log('\n[5] 新增整表');
    const withNew = diffLib.parseObjects(DESIRED + '\nCREATE TABLE IF NOT EXISTS brand_new (k TEXT PRIMARY KEY, v TEXT);');
    const d4 = diffLib.diffSchema(withNew, await readActual());
    check('识别出 brand_new', d4.addTables.length === 1 && d4.addTables[0].table === 'brand_new', JSON.stringify(d4.addTables.map((x) => x.table)));
    await client.batch(diffLib.applyStatements(d4).map((sql) => ({ sql })));
    check('brand_new 已建', (await client.query("SELECT name FROM sqlite_master WHERE type='table' AND name='brand_new'")).length === 1);
    // 注意：demo.legacy_col 是「只报告不执行」的删列项，故第二遍不会 isEmptyDiff 全空；
    // 这里断言的是「可执行项已归零」——即重复运行不会产生任何 DDL。
    const d5 = diffLib.diffSchema(withNew, await readActual());
    check('第二遍无可执行项（DDL 为空）', diffLib.applyStatements(d5).length === 0, JSON.stringify(diffLib.applyStatements(d5)));
    check('第二遍仅剩已声明的人工项（删列）', d5.droppedColumns.length === 1 && d5.unsafeColumns.length === 2, JSON.stringify({ drop: names(d5.droppedColumns), unsafe: names(d5.unsafeColumns) }));
  } finally {
    client.close();
    try { fs.unlinkSync(file); } catch (_) {}
  }

  console.log(failed ? `\n自我检查失败：${failed} 项` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('[致命]', (e && e.stack) || e);
  process.exit(1);
});
