-- ===========================================================================
-- Cloudflare D1 建表脚本（SQLite 语法）
-- 用法：见 db/.env.example 与部署步骤；首次建库后执行本文件。
-- 设计要点：
--   1) pick_record 为「一次运行 × 一只票」一行，同票跨 run 自动成多行，
--      满足「同一只股票在不同时期被收录，全部保留、可区分」的需求。
--   2) 所有时间字段（*_at / *_date / date）统一为「北京时间字符串」，
--      格式 YYYY-MM-DD HH:mm:ss（无 Z），由 dayjs 生成，避免 +8h 时差。
--   3) 列注释以 SQL 行内注释（--）书写，已写入 sqlite_master 的建表原文，
--      在 DB Browser for SQLite / DBeaver 等工具的「DDL / SQL」视图中可直接查看。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 股票基础档案：一票一档，长期复用。
-- 题材 / 地域 / 主营 / 最赚钱业务由 enrich_stock_base.js 低频从东财 F10 补全。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_base (
  code            TEXT PRIMARY KEY,                -- 股票代码（沪深京，如 sh600519 / sz000001 / bj830799）
  name            TEXT,                            -- 股票名称（以行情接口返回为准）
  sector          TEXT,                            -- 申万一级行业
  concepts        TEXT,                            -- 题材概念（顿号分隔，如「锂电池、光伏、军工」）
  region          TEXT,                            -- 地域（省份/城市）
  main_business   TEXT,                            -- 主营业务概述
  top_business    TEXT,                            -- 最赚钱业务（按毛利率挑选，含毛利率/营收占比）
  updated_at      TEXT                             -- 档案最近更新时间（北京时间 YYYY-MM-DD HH:mm:ss）
);

-- ---------------------------------------------------------------------------
-- 每日运行批次：一次初筛（一个 anchor_date）对应一行汇总。
-- anchor_date = 数据锚定日（收盘后的 T-1）；target_date = 面向的交易日（T）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_batch (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  anchor_date     TEXT UNIQUE,                     -- 锚定日（YYYY-MM-DD），唯一；初筛数据基于该日收盘
  target_date     TEXT,                            -- 面向交易日（YYYY-MM-DD，即 T）
  run_at          TEXT,                            -- 本批次运行时间（北京时间 YYYY-MM-DD HH:mm:ss）
  universe_count  INTEGER,                         -- 观察池标的总数
  r01_count       INTEGER,                         -- 触发 R01（量能验证突破）的标的数
  r07_count       INTEGER,                         -- 触发 R07（板块内补涨滞后）的标的数
  r05_count       INTEGER,                         -- 触发 R05（尾盘量价部分达标）的标的数
  high_count      INTEGER,                         -- 重点（R01 四门槛全过）数量
  secondary_count INTEGER,                         -- 次级（R01 核心项≥3 且市值/高位区达标）数量
  conditional_count INTEGER,                       -- 条件（R01 核心项≥2 且市值/高位区达标）数量
  excluded_count  INTEGER,                         -- 未达任何梯队的数量（仅统计，不入库）
  kline_fail_rate REAL,                            -- K 线获取失败率（0~1，越高数据越不可靠）
  source          TEXT,                            -- 数据来源（如 tencent-live / tencent-offline）
  note            TEXT                             -- 备注（人工或脚本补充）
);

-- ---------------------------------------------------------------------------
-- 入选 / 评估记录：每次运行、每只入选票一行（同票跨 run 成多行）。
-- tier 仅表示 R01 梯队；即便 tier='excluded'，只要触发 R07/R05 也会被写入
--   （r07_laggard / r05_partial 标记为 1），前端据此识别其入选维度。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pick_record (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id           INTEGER NOT NULL,               -- 关联 run_batch.id
  anchor_date      TEXT NOT NULL,                  -- 锚定日（YYYY-MM-DD）
  code             TEXT NOT NULL,                  -- 股票代码
  name             TEXT,                           -- 股票名称（快照时刻）
  sector           TEXT,                           -- 申万一级行业
  tier             TEXT,                           -- 梯队：high / secondary / conditional / excluded
  r01_ok           INTEGER,                        -- 0/1：R01 四门槛是否全过（重点）
  r07_laggard      INTEGER,                        -- 0/1：是否触发 R07 板块内补涨滞后
  r05_partial      INTEGER,                        -- 0/1：是否触发 R05 尾盘量价部分达标
  core             INTEGER,                        -- R01 量价突破达成项数（0~4）
  r01_chg          REAL,                           -- 当日涨幅 %（R01 口径）
  price            REAL,                           -- 入选价（收盘价，元）
  turnover         REAL,                           -- 当日换手率 %
  circ_market_cap  REAL,                           -- 流通市值（元）
  total_market_cap REAL,                           -- 总市值（元）
  sector_pct       REAL,                           -- 所属行业当日涨幅中位数 %
  sector_rank      INTEGER,                        -- 行业内的涨幅排名（R07 口径）
  reason           TEXT,                           -- 入选 / 排除原因（中文说明）
  picked_at        TEXT,                           -- 入选记录写入时间（北京时间 YYYY-MM-DD HH:mm:ss）
  UNIQUE(run_id, code)
);

-- ---------------------------------------------------------------------------
-- 日线行情：全观察池每日一条，作为入选后 N 日表现复盘的收益底座。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_daily (
  code              TEXT NOT NULL,                 -- 股票代码
  date              TEXT NOT NULL,                 -- 行情日期（YYYY-MM-DD，锚定日）
  open              REAL,                          -- 开盘价（元）
  high              REAL,                          -- 最高价（元）
  low               REAL,                          -- 最低价（元）
  close             REAL,                          -- 收盘价（元）
  chg_pct           REAL,                          -- 当日涨跌幅 %
  turnover          REAL,                          -- 换手率 %
  circ_market_cap   REAL,                          -- 流通市值（元）
  total_market_cap  REAL,                          -- 总市值（元）
  PRIMARY KEY (code, date)
);

-- ---------------------------------------------------------------------------
-- 自定义分组：用于把票按主题/策略分类观察（如「军工」「低位补涨」）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watch_group (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT UNIQUE NOT NULL,                -- 分组名称（唯一）
  color       TEXT,                                -- 分组颜色（十六进制，如 #4F8DFD），前端展示用
  description TEXT,                                -- 分组说明
  created_at  TEXT                                 -- 创建时间（北京时间 YYYY-MM-DD HH:mm:ss）
);

-- ---------------------------------------------------------------------------
-- 票-组 关联：一只票可加入多个分组。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pick_group_rel (
  code       TEXT NOT NULL,                        -- 股票代码
  group_id   INTEGER NOT NULL,                     -- 关联 watch_group.id
  note       TEXT,                                 -- 入组备注（如入选该组的理由）
  created_at TEXT,                                 -- 关联创建时间（北京时间 YYYY-MM-DD HH:mm:ss）
  PRIMARY KEY (code, group_id)
);

-- ---------------------------------------------------------------------------
-- 评论 / 备注：可按运行（anchor_date）或纯按票记录。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_note (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL,                        -- 股票代码
  anchor_date TEXT,                                -- 关联运行锚定日（可空：通用备注，不限某次运行）
  type       TEXT,                                 -- 类型：comment（评论）/ memo（备忘）
  content    TEXT NOT NULL,                        -- 备注内容
  created_at TEXT                                  -- 创建时间（北京时间 YYYY-MM-DD HH:mm:ss）
);

-- ---------------------------------------------------------------------------
-- 索引：加速按票 / 按日 / 按梯队 / 按组 的查询。
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pick_code ON pick_record(code);
CREATE INDEX IF NOT EXISTS idx_pick_date ON pick_record(anchor_date);
CREATE INDEX IF NOT EXISTS idx_pick_tier ON pick_record(tier);
CREATE INDEX IF NOT EXISTS idx_pick_run  ON pick_record(run_id);
CREATE INDEX IF NOT EXISTS idx_price_code ON price_daily(code);
CREATE INDEX IF NOT EXISTS idx_price_date ON price_daily(date);
CREATE INDEX IF NOT EXISTS idx_note_code  ON stock_note(code);
CREATE INDEX IF NOT EXISTS idx_group_rel_code ON pick_group_rel(code);
CREATE INDEX IF NOT EXISTS idx_group_rel_gid ON pick_group_rel(group_id);
