'use strict';
/*
 * db/ddl.js —— DDL 的唯一读取入口（schema.sql 是唯一真相源）
 * ---------------------------------------------------------------------------
 * 背景（2026-09-21 事故）：
 *   同一份建表语句曾被复制到 3 个地方 —— db/schema.sql、
 *   eod/lib/store_d1.js::ensureTables、db/persist.js::ensureColumns，彼此没有约束关系。
 *   而两条「自动应用」路径都是坏的：
 *     · 本地：db/sqlite_client.js 只在【缺 run_batch 表】时才应用 schema。
 *       库一旦早已存在，后来新增的 tail_run / tail_pick 就永远不会被创建。
 *     · 远程：压根没有自动应用路径，只靠人工 `wrangler d1 execute`。
 *   结果：local.db 与线上 D1 都没有尾盘两张表 → /api/tail/* 全部
 *   `no such table` → 被 onError 兜成 HTTP 500（四个页面全挂）。
 *
 * 现在的约定：
 *   1. schema.sql 只写「最终想要的形状」，全部 IF NOT EXISTS，**可重复执行**；
 *   2. 任何需要建表/建索引的地方都从这里取语句，不再各写一份；
 *   3. 需要「改已存在的表」（SQLite 的 CREATE TABLE IF NOT EXISTS 不会补列）时，
 *      写成 db/migrations/NNN-描述.sql，由 db/migrate.js 按文件名顺序执行一次并记录。
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * 把 SQL 文本切成单条语句。
 * - 去掉 `--` 注释（本项目 schema.sql 大量使用行尾内联注释，需一并清掉）；
 * - 按 `;` 切分；本项目 DDL 不含「字符串字面量里带分号」的情况，故简单切分足够。
 *
 * 必须切分的原因：Cloudflare D1 的 /query 路由只接受**单条**语句。
 *
 * @param {string} sql
 * @returns {string[]}
 */
function splitStatements(sql) {
  return String(sql)
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** schema.sql 的原始文本（用于计算 hash / 判断是否变化）。 */
function readSchema() {
  return fs.readFileSync(SCHEMA_FILE, 'utf8');
}

/** schema.sql 切分后的语句数组（建表 + 建索引，全部幂等）。 */
function loadStatements() {
  return splitStatements(readSchema());
}

/**
 * 增量迁移文件（db/migrations/NNN-*.sql），按文件名升序。
 * 目录不存在时返回空数组（本项目当前没有需要 ALTER 的变更）。
 * @returns {Array<{name: string, statements: string[]}>}
 */
function loadMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      statements: splitStatements(fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')),
    }));
}

module.exports = {
  SCHEMA_FILE,
  MIGRATIONS_DIR,
  splitStatements,
  readSchema,
  loadStatements,
  loadMigrations,
};
