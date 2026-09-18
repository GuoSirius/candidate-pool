-- ===========================================================================
-- Cloudflare D1 建表脚本（SQLite 语法）
-- 用法：见 db/.env.example 与部署步骤；首次建库后执行本文件。
-- 设计要点：pick_record 为「一次运行 × 一只票」一行，同票跨 run 自动成多行，
--          满足「同一只股票在不同时期被收录，全部保留、可区分」的需求。
-- ===========================================================================

-- 股票基础档案：一票一档，长期复用（题材/地域/主营/最赚钱业务由 enrich 低频补全）
CREATE TABLE IF NOT EXISTS stock_base (
  code            TEXT PRIMARY KEY,
  name            TEXT,
  sector          TEXT,            -- 申万一级行业
  concepts        TEXT,            -- 题材概念（逗号分隔）
  region          TEXT,            -- 地域（省份/城市）
  main_business   TEXT,            -- 主营业务
  top_business    TEXT,            -- 最赚钱业务
  updated_at      TEXT
);

-- 每日运行批次：一次初筛 = 一行
CREATE TABLE IF NOT EXISTS run_batch (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  anchor_date     TEXT UNIQUE,     -- 锚定日（YYYY-MM-DD）
  target_date     TEXT,
  run_at          TEXT,
  universe_count  INTEGER,
  r01_count       INTEGER,
  r07_count       INTEGER,
  r05_count       INTEGER,
  high_count      INTEGER,
  secondary_count INTEGER,
  conditional_count INTEGER,
  excluded_count  INTEGER,
  kline_fail_rate REAL,
  source          TEXT,
  note            TEXT
);

-- 入选/评估记录：每次运行、每只票一行（同票跨 run 多行）
CREATE TABLE IF NOT EXISTS pick_record (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id           INTEGER NOT NULL,
  anchor_date      TEXT NOT NULL,
  code             TEXT NOT NULL,
  name             TEXT,
  sector           TEXT,
  tier             TEXT,           -- high / secondary / conditional / excluded
  r01_ok           INTEGER,        -- 0/1：R01 四门槛全过
  r07_laggard      INTEGER,        -- 0/1：R07 板块内补涨滞后
  r05_partial      INTEGER,        -- 0/1：R05 尾盘量价部分触发
  core             INTEGER,        -- R01 达成项数 0-4
  r01_chg          REAL,           -- 当日涨幅 %
  price            REAL,           -- 收盘价（入选价）
  turnover         REAL,           -- 换手 %
  circ_market_cap  REAL,           -- 流通市值（元）
  total_market_cap REAL,           -- 总市值（元）
  sector_pct       REAL,           -- 行业涨幅中位数 %
  sector_rank      INTEGER,
  reason           TEXT,           -- 入选/排除原因
  picked_at        TEXT,
  UNIQUE(run_id, code)
);

-- 日线行情：全池每日，复盘收益底座（close 用于入选后 N 日表现）
CREATE TABLE IF NOT EXISTS price_daily (
  code              TEXT NOT NULL,
  date              TEXT NOT NULL, -- 锚定日
  open              REAL,
  high              REAL,
  low               REAL,
  close             REAL,
  chg_pct           REAL,
  turnover          REAL,
  circ_market_cap   REAL,
  total_market_cap  REAL,
  PRIMARY KEY (code, date)
);

-- 自定义分组（分类观察）
CREATE TABLE IF NOT EXISTS watch_group (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT UNIQUE NOT NULL,
  color       TEXT,
  description TEXT,
  created_at  TEXT
);

-- 票-组 关联：一票可入多组
CREATE TABLE IF NOT EXISTS pick_group_rel (
  code       TEXT NOT NULL,
  group_id   INTEGER NOT NULL,
  note       TEXT,
  created_at TEXT,
  PRIMARY KEY (code, group_id)
);

-- 评论/备注：可按 run 或纯按票
CREATE TABLE IF NOT EXISTS stock_note (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL,
  anchor_date TEXT,         -- 可为空（通用备注，不限某次运行）
  type       TEXT,          -- comment / memo
  content    TEXT NOT NULL,
  created_at TEXT
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_pick_code ON pick_record(code);
CREATE INDEX IF NOT EXISTS idx_pick_date ON pick_record(anchor_date);
CREATE INDEX IF NOT EXISTS idx_pick_tier ON pick_record(tier);
CREATE INDEX IF NOT EXISTS idx_pick_run  ON pick_record(run_id);
CREATE INDEX IF NOT EXISTS idx_price_code ON price_daily(code);
CREATE INDEX IF NOT EXISTS idx_price_date ON price_daily(date);
CREATE INDEX IF NOT EXISTS idx_note_code  ON stock_note(code);
CREATE INDEX IF NOT EXISTS idx_group_rel_code ON pick_group_rel(code);
CREATE INDEX IF NOT EXISTS idx_group_rel_gid ON pick_group_rel(group_id);
