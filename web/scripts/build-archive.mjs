#!/usr/bin/env node
/**
 * 历史报告 / 数据归档（构建期生成，不进 git）
 * ---------------------------------------------------------------------------
 * 用法：
 *   node scripts/build-archive.mjs                    # 默认输出到 public/archive
 *   node scripts/build-archive.mjs --out dist/archive
 *
 * 设计前提（改动前先看）：
 *  - **只读**仓库原有的 reports/ data/ eod/reports/ eod/data/，一行都不写回。
 *    原目录结构被 gen_candidates / rerender_all / 3 个 GitHub workflow 硬依赖，
 *    其中 daily-screen.yml 会把 reports/、data/ 原样同步到 daily-artifacts 分支
 *    ——物理重组会直接打断 GitHub Pages 上的旧直链，故绝不移动。
 *  - 输出到 web/public/archive/（已 gitignore），Vite 构建时自动复制进 dist/，
 *    随 `npm run deploy` 同源发布到 Cloudflare Pages；dev 也能直接访问。
 *  - 只纳入 git 跟踪的正式产物；raw/、pattern-kline-*、preopen-baseline-* 等
 *    可重建缓存由正则天然排除。pulse 报告未入库，不纳入；周报 / 回流简报
 *    自 2026-11-11 起已统一为单文件 HTML，纳入 weekly / reflow 两类（旧 .md 不纳入）。
 *  - 每类可只有 reports 没有 data（weekly / reflow 无逐日数据档），data 省略即跳过。
 *  - Cloudflare Pages 不提供目录列表，故必须生成 index.json 供前端枚举。
 * ---------------------------------------------------------------------------
 */
import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(WEB, '..');
const argv = process.argv.slice(2);
const outFlag = argv.indexOf('--out');
const OUT = resolve(WEB, outFlag >= 0 && argv[outFlag + 1] ? argv[outFlag + 1] : 'public/archive');

const VARIANT_LABEL = { '': '正式', '-obs': '观察', '-intraday': '盘中' };
const VARIANT_ORDER = { '': 0, '-obs': 1, '-intraday': 2 };

/** 类型映射：新增一类只加这里 + 前端无需改动（index.json 驱动） */
const TYPES = [
  {
    key: 'nextday', label: '次日候选',
    reports: { dir: 'reports', re: /^stock_list_(\d{4})(\d{2})(\d{2})\.html$/ },
    data: { dir: 'data', re: /^snapshot-(\d{4}-\d{2}-\d{2})\.json$/ },
  },
  {
    key: 'tail', label: '尾盘选股',
    reports: { dir: 'eod/reports/eod', re: /^eod-(\d{4}-\d{2}-\d{2})(-obs|-intraday)?\.html$/ },
    data: { dir: 'eod/data/eod', re: /^eod-(\d{4}-\d{2}-\d{2})(-obs|-intraday)?\.json$/ },
  },
  {
    key: 'preopen', label: '盘前选股',
    reports: { dir: 'eod/reports/preopen', re: /^preopen-(\d{4}-\d{2}-\d{2})\.html$/ },
    data: { dir: 'eod/data/preopen', re: /^preopen-(\d{4}-\d{2}-\d{2})\.json$/ },
  },
  {
    key: 'hotmoney', label: '游资席位',
    reports: { dir: 'eod/reports/hotmoney', re: /^hotmoney-(\d{4}-\d{2}-\d{2})\.html$/ },
    data: { dir: 'eod/data/hotmoney', re: /^hotmoney-(\d{4}-\d{2}-\d{2})\.json$/ },
  },
  {
    key: 'pattern', label: '形态选股',
    reports: { dir: 'eod/reports/pattern', re: /^pattern-(\d{4}-\d{2}-\d{2})\.html$/ },
    data: { dir: 'eod/data/pattern', re: /^pattern-(\d{4}-\d{2}-\d{2})\.json$/ },
  },
  {
    key: 'weekly', label: '胜率周报',
    reports: { dir: 'eod/reports/weekly', re: /^winrate-(\d{4}-\d{2}-\d{2})\.html$/ },
  },
  {
    key: 'reflow', label: '观察池回流',
    reports: { dir: 'eod/reports/pool_reflow', re: /^pool_reflow-(\d{4}-\d{2}-\d{2})\.html$/ },
  },
];

/** 从各类文件名提取 (交易日, 口径)。nextday 是紧凑 8 位日期，其余是 YYYY-MM-DD。 */
function parseName(file, re) {
  const m = file.match(re);
  if (!m) return null;
  // nextday 是 (\d{4})(\d{2})(\d{2}) 三段式，其余类型的 m[1] 已是 YYYY-MM-DD
  const date = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : m[1];
  return { date, variant: m[m.length - 1] && /^-/.test(m[m.length - 1]) ? m[m.length - 1] : '' };
}

const warnings = [];
const types = [];
let totalReports = 0, totalData = 0;
const hash = createHash('sha256');

// 幂等：只清归档目录本身，绝不碰 public/ 下其它资源
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const t of TYPES) {
  const entry = { key: t.key, label: t.label, reports: [], data: [], count: 0, dataCount: 0 };
  for (const kind of ['reports', 'data']) {
    const cfg = t[kind];
    if (!cfg) continue;                       // weekly / reflow 只有 reports，没有逐日 data
    const srcDir = join(ROOT, cfg.dir);
    if (!existsSync(srcDir)) {
      warnings.push(`${t.key}/${kind}: 源目录不存在 ${cfg.dir}（已跳过）`);
      continue;
    }
    const dstDir = join(OUT, kind, t.key);
    mkdirSync(dstDir, { recursive: true });
    for (const file of readdirSync(srcDir)) {
      const parsed = parseName(file, cfg.re);
      if (!parsed) continue;
      const src = join(srcDir, file);
      if (!statSync(src).isFile()) continue;
      copyFileSync(src, join(dstDir, file));
      const size = statSync(src).size;
      const url = `/archive/${kind}/${t.key}/${file}`;
      if (kind === 'reports') {
        entry.reports.push({
          file, date: parsed.date, variant: parsed.variant, size, url,
          label: `${parsed.date}${parsed.variant ? ' · ' + (VARIANT_LABEL[parsed.variant] || parsed.variant) : ''}`,
        });
        hash.update(`${url}:${size};`);
      } else {
        entry.data.push({ file, date: parsed.date, size, url });
      }
    }
  }
  // 日期倒序；同日按 正式 → 观察 → 盘中
  const cmp = (a, b) => a.date === b.date
    ? (VARIANT_ORDER[a.variant] ?? 9) - (VARIANT_ORDER[b.variant] ?? 9)
    : (a.date < b.date ? 1 : -1);
  entry.reports.sort(cmp);
  entry.data.sort(cmp);
  entry.count = entry.reports.length;
  entry.dataCount = entry.data.length;
  totalReports += entry.count;
  totalData += entry.dataCount;
  types.push(entry);
}

const doc = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  base: '/archive',
  fingerprint: hash.digest('hex'),
  totalReports,
  totalData,
  types: types.filter((t) => t.count > 0),
};
writeFileSync(join(OUT, 'index.json'), JSON.stringify(doc), 'utf8');

for (const t of doc.types) console.log(`  ${t.label.padEnd(8)} 报告 ${String(t.count).padStart(3)} | 数据 ${String(t.dataCount).padStart(3)}`);
console.log(`[archive] 合计 报告 ${totalReports} / 数据 ${totalData} → ${OUT}`);
if (warnings.length) console.warn(`[archive] 警告:\n  ${warnings.join('\n  ')}`);
