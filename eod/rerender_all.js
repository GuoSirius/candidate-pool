'use strict';
/*
 * eod/rerender_all.js —— 从当日归档离线重渲染「全部」HTML 报告
 * ---------------------------------------------------------------------------
 * 用途：改了报告样式（例如 2026-11-09 全报告加 mini K 线）之后，不必重抓行情，
 *       一条命令把当天所有报告按当前代码重刷一遍。全程零网络、不推送、不写 D1。
 *
 *   node eod/rerender_all.js                       # 今天
 *   node eod/rerender_all.js --date 2026-11-09    # 指定交易日
 *   npm run report:rerender -- --date 2026-11-09
 *
 * 覆盖 6 类报告：主报告 / 尾盘(正式+观察+盘中) / 盘前 / 游资 / 形态 / 消息脉搏。
 * 每一步独立 try/catch，单份失败不影响其余；末尾做表格列数一致性校验。
 * 注：pulse 的「领涨股明细」由在线 enrichLeaders 补充，离线重建只保留快照里的 lead 字段，
 *     这是刻意的降级（不为了装饰性图表去重新采集消息面）。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const paths = require('../paths');
const { dayjs } = require('../time');
const { rerenderTail, rerenderPreopen, rerenderHotmoney } = require('./lib/rerender');

const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const date = argOf('--date') || dayjs.tz().format('YYYY-MM-DD');
const ROOT = paths.PKG_ROOT;
const EOD_DATA = path.join(paths.eodDir(), 'data');
// 尾盘归档 2026-11-09 起按流水线分子目录（tail.config.store.dataDir = data/eod），
// 别硬编码成 data/ 根，否则会静默「无归档」。
const TAIL_DATA = path.join(paths.eodDir(), require('./tail.config').store.dataDir);
const results = [];

function runNode(args, timeout = 180_000) {
  const out = execFileSync(process.execPath, args, {
    cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
  });
  return String(out || '').trim().split('\n').filter(Boolean).slice(-2).join(' / ');
}
function step(name, fn) {
  try {
    const r = fn();
    const skipped = r && r.skipped;
    results.push({ name, status: skipped ? '跳过' : 'OK', file: skipped ? '' : String(r.file || r), detail: skipped ? r.skipped : String(r.detail || '') });
  } catch (e) {
    results.push({ name, status: '失败', file: '', detail: String((e && e.message) || e).slice(0, 200) });
  }
}

// ---------- 1. 主报告：gen_candidates --offline（只读快照，只写 HTML） ----------
step('主报告', () => {
  const snap = path.join(paths.dataDir(), `snapshot-${date}.json`);
  if (!fs.existsSync(snap)) return { skipped: `缺 ${path.basename(snap)}` };
  const file = path.join(paths.reportsDir(), `stock_list_${date.replace(/-/g, '')}.html`);
  const detail = runNode([path.join(ROOT, 'gen_candidates.js'), '--offline', '--snapshot', snap, '--out', file, '--quiet']);
  return { file, detail };
});

// ---------- 2. 尾盘三份：正式 / 观察 / 盘中，逐档 replay ----------
const tailDir = TAIL_DATA;
const tailArchives = (fs.existsSync(tailDir) ? fs.readdirSync(tailDir) : [])
  .filter((f) => new RegExp(`^eod-${date}(-obs|-intraday)?\\.json$`).test(f)).sort();
for (const f of tailArchives) {
  const label = `尾盘${f.includes('-intraday') ? '·盘中' : f.includes('-obs') ? '·观察' : '·正式'}`;
  step(label, () => ({ file: rerenderTail(path.join(tailDir, f)) }));
}
if (!tailArchives.length) results.push({ name: '尾盘', status: '跳过', file: '', detail: `无 ${date} 尾盘归档` });

// ---------- 3. 盘前 ----------
step('盘前', () => { const r = rerenderPreopen(date); return r.skipped ? r : { file: r }; });

// ---------- 4. 游资 ----------
step('游资', () => { const r = rerenderHotmoney(date); return r.skipped ? r : { file: r }; });

// ---------- 5. 形态：--replay 从当日 K 线日档零网络重算 ----------
step('形态', () => {
  const kl = path.join(EOD_DATA, 'pattern', `pattern-kline-${date}.json`);
  if (!fs.existsSync(kl)) return { skipped: `缺 ${path.basename(kl)}` };
  const file = path.join(paths.eodDir(), 'reports', 'pattern', `pattern-${date}.html`);
  const detail = runNode([path.join(ROOT, 'eod', 'pattern_screener.js'), '--date', date, '--replay', '--no-notify']);
  return { file, detail };
});

// ---------- 6. 消息脉搏：从 latest.json 离线重建 latest.html ----------
step('消息脉搏', () => {
  const snapFile = path.join(ROOT, 'pulse', 'data', 'latest.json');
  if (!fs.existsSync(snapFile)) return { skipped: '缺 pulse/data/latest.json' };
  const snapshot = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
  if (String(snapshot.runAtText || '').slice(0, 10) !== date) {
    return { skipped: `latest.json 是 ${String(snapshot.runAtText).slice(0, 10)}，非 ${date}` };
  }
  const analysis = require('../pulse/analyze').analyze(snapshot);
  const html = require('../pulse/gen_report').buildReport(snapshot, analysis);
  const file = path.join(require('../pulse/config').REPORT_DIR, 'latest.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html, 'utf8');
  return { file, detail: `离线重建（领涨股明细沿用快照 lead 字段）` };
});

// ---------- 校验：每个 table 的表头列数 vs 首个数据行 td 数 ----------
function checkTableCols(html) {
  const tables = [...String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)];
  const bad = [];
  let checked = 0;
  for (const t of tables) {
    const body = t[1];
    const head = (body.match(/<thead>([\s\S]*?)<\/thead>/) || [])[1];
    if (!head) continue;
    const headRows = [...head.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => r[1]);
    if (!headRows.length) continue;
    const thOf = (s) => [...s.matchAll(/<th\b/g)].length;
    const rowspanOf = (s) => [...s.matchAll(/<th[^>]*rowspan="2"/g)].length;
    const cols = headRows.length >= 2 ? rowspanOf(headRows[0]) + thOf(headRows[1]) : thOf(headRows[0]);
    const tbody = (body.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/) || [])[1] || body;
    const row = [...tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((r) => r[1]).find((r) => /<td\b/.test(r) && !/<td[^>]*colspan=/.test(r));
    if (!row) continue;
    const tds = [...row.matchAll(/<td\b/g)].length;
    checked++;
    if (cols !== tds) bad.push(`表头${cols}列 / 数据行${tds}列`);
  }
  return { checked, bad };
}

console.log(`\n=== ${date} 报告重渲染 ===`);
for (const r of results) {
  let extra = '';
  if (r.status === 'OK' && r.file && fs.existsSync(r.file)) {
    const html = fs.readFileSync(r.file, 'utf8');
    const svg = [...html.matchAll(/<svg\b/g)].length;
    const spark = [...html.matchAll(/<td class="spark"/g)].length;
    const chk = checkTableCols(html);
    extra = `${(fs.statSync(r.file).size / 1024).toFixed(0)}K · SVG ${svg} · K列 ${spark} · 表格 ${chk.checked} 个${chk.bad.length ? ' ❌ ' + chk.bad.join(', ') : ' ✓'}`;
  } else if (r.status !== 'OK') {
    extra = r.detail;
  }
  console.log(`${r.status.padEnd(4)} | ${r.name.padEnd(12)} | ${extra}`);
  if (r.status === 'OK' && r.file && r.detail) console.log(`     └ ${r.detail.slice(0, 160)}`);
}
const failed = results.filter((r) => r.status === '失败');
console.log(`\n合计 ${results.length} 项：OK ${results.filter((r) => r.status === 'OK').length} / 跳过 ${results.filter((r) => r.status === '跳过').length} / 失败 ${failed.length}`);
if (failed.length) process.exitCode = 1;
