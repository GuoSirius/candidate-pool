#!/usr/bin/env node
/**
 * scripts/verify-pack.mjs —— 打包体检：敏感文件 / 文件集合 / 必需文件 / 代码覆盖 / 依赖闭包 / 体积
 * ---------------------------------------------------------------------------
 * 为什么必须有这个脚本：
 *   `files` 是**硬白名单**，目录级条目（如 "db/"）会**绕过 .gitignore**。
 *   实测本仓库首次配置时，`db/.env`（Cloudflare API 令牌）与 `db/local.db`
 *   被原样打进了 tarball —— 一旦 `npm publish` 就是**凭据泄露**，且 npm 的
 *   撤销额度有限。故把检查固化成脚本，由 CI 在 publish **之前**执行，命中即失败。
 *
 *   第二个坑（2026-11-11 定位）：**排除规则会随目录重组静默失效**。
 *   早期数据在 `eod/data/eod-*.json` 根层，`"!eod/data/eod-*.json"` 有效；
 *   v3.3.0 起数据按管道搬进 `eod/data/{eod,preopen,pattern,hotmoney}/` 子目录，
 *   这条排除再没匹配到任何文件，历史归档又开始全量入包并单调增长。
 *   结果 v3.3.0 ~ v3.6.0 四次发版**全被 2MB 红线拦下**，线上版本一直停在 3.2.0。
 *
 *   第三个追问（同一天）：「以后还会因为包体积逐渐变大而失败吗？」
 *   —— 数据累积这条路已被结构性切断（files 精确 glob + 运行数据零容忍），
 *   逐日报告 / 快照再怎么涨都进不了包。但**固定 2MB 总量红线仍会被代码自身增长撞到**：
 *   v3.2.0 代码资产 366KB → v3.6.0 712KB，四个月翻了近一倍。
 *   所以把门禁的判据从「一个总量数字」升级为「文件集合 + 分类可见」：
 *     · ALLOWED 逐文件登记：任何不属于代码 / 模板 / 种子 / 元数据的文件一律失败；
 *     · 分类体积每次都打印，增长看得见；单文件上限，防止有人塞进大 JSON；
 *     · 剔除 CHANGELOG.md：唯一随发版次数单调增长、运行时又完全不读的文件。
 *
 *   第四个追问（同一天）：「再核对一次 files，确保无遗漏、无多余」。
 *   用**相对 require 闭包**逐文件扫描，果然发现两处真实断裂：
 *     · `rules.js` 被 `gen_candidates.js` 等 8 个入包文件依赖，却从来没进过 files
 *       → 装包后主命令直接 `Cannot find module './rules'`；
 *     · `pulse/` 被 `eod/rerender_all.js` 依赖，`npm run pulse` 也指向它，
 *       但整个目录都不在白名单 → `report:rerender` 与 `pulse` 两条命令都不可用。
 *   只靠「点名必需文件」永远抓不到这类间接依赖，故把闭包检查做成硬闸：
 *   任何 `require('../xxx')` 指向包外即失败；`pulse/` 按精确 glob 纳入，
 *   不含 `data/` `reports/` 运行产物。
 *
 * 用法：node scripts/verify-pack.mjs        （npm run verify:pack）
 * 退出码：0 通过；1 有违规或缺文件；2 无法解析 npm 输出（同样是失败）。
 * ---------------------------------------------------------------------------
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix as pathPosix } from 'node:path';

// 禁止入包：凭据、本地库、密钥、日志、依赖目录、运行数据。模板文件（*.example*）不受影响。
const FORBIDDEN = [
  [/(^|\/)\.env$/i, '环境变量文件（可能含 Cloudflare / D1 令牌）'],
  [/(^|\/)\.env\.(local|production|development|staging)$/i, '环境变量文件'],
  [/(^|\/)local\.db/i, '本地 SQLite 库（体积大且是派生数据）'],
  [/(^|\/)notify_config\.json$/i, '推送凭据（Server酱 / 邮箱授权码）'],
  [/(^|\/)\.dev\.vars/i, 'wrangler 本地密钥'],
  [/\.(pem|key|p12|pfx)$/i, '私钥 / 证书'],
  [/\.log$/i, '日志'],
  [/(^|\/)node_modules\//, '依赖目录（会撑爆包体）'],
  [/(^|\/)\.git\//, 'git 内部数据'],
  // eod/data/ 下只有「行业映射种子」是安装后首跑必需的，其余全是逐日累积的运行数据。
  // 目录级 files 条目绕过 .gitignore，连本地 20MB 级的 K 线缓存都会被打进来。
  [/^eod\/data\/(?!industry-map\.json$)/, '运行数据（历史归档 / 原始快照 / K 线缓存），不随 npm 包发布'],
  [/^pulse\/(data|reports)\//, 'pulse 运行产物（快照 / HTML 报告），不随 npm 包发布'],
];

/**
 * 允许入包的文件集合（逐文件裁决）。
 * 与 package.json 的 files 一一对应，但两者职责不同：files 决定「装什么」，
 * 这里决定「只允许装这些」。即使有人把 files 改回目录级 "eod/" 或 "pulse/"，
 * 带进来的数据文件也会在此被逐个拦下，而不是等体积涨到 2MB 才报错。
 * 新增一类资产时必须同时改 files 和这里，并补自检正反例。
 */
const ALLOWED = [
  /^package\.json$/,
  /^README\.md$/i,                       // npm 强制包含，无法排除
  /^[a-z0-9_.-]+\.js$/,                  // 根层代码（含 rules.js）
  /^(candidates|notify_config)\.example\.json$/,
  /^bin\/[^/]+\.js$/,
  /^eod\/[^/]+\.(js|json)$/,
  /^eod\/lib\/[^/]+\.(js|json)$/,
  /^eod\/data\/industry-map\.json$/,     // 唯一运行数据例外：安装后首跑的行业映射种子
  /^pulse\/[^/]+\.(js|mjs)$/,
  /^pulse\/lib\/[^/]+\.js$/,
  /^pulse\/sources\/[^/]+\.js$/,
  /^db\/[^/]+\.(js|sql)$/,
  /^db\/\.env\.example$/,
];

// 必须入包：点名关键入口，缺一即失败。间接依赖交给下面的 require 闭包检查兜底。
const REQUIRED = [
  'package.json',
  'bin/candidate-pool.js',
  'bin/tail-screener.js',
  'paths.js',
  'scaffold.js',
  'gen_candidates.js',
  'rules.js',                            // 规则引擎单一真相源，8 个入包文件依赖
  'eod/tail_screener.js',
  'eod/lib/sector.js',
  'pulse/run.js',
  'pulse/analyze.js',                    // eod/rerender_all.js 的硬依赖
  'db/schema.sql',
  'candidates.example.json',
  'notify_config.example.json',
  'db/.env.example',
  'eod/data/industry-map.json',
];

// 体积红线（兜底）与单文件上限。红线不是「运行数据的探测器」，别拿它当唯一判据。
const SIZE_LIMIT = 2 * 1024 * 1024;
const FILE_LIMIT = 512 * 1024;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const violations = (list) => list.filter((f) => FORBIDDEN.some(([re]) => re.test(f)));
const allowed = (f) => ALLOWED.some((re) => re.test(f));

/**
 * 剥掉注释再扫 require —— JSDoc 里常有 `const x = require('./lib/runlog')` 这类示例，
 * 不剥会满屏假阳性；`[^:]` 保护 URL 里的 `https://` 不被当成行注释。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\*/.test(l))
    .join('\n');
}

/**
 * 守门规则自检 —— 每次体检前先跑。
 * 这类「正则白名单」最怕被后人顺手放宽（把 .env 的规则删掉就再也不报警了），
 * 所以把正反例都钉在这里：正例必须被抓到，反例必须放行。
 */
function selfTest() {
  const mustFlag = ['db/.env', 'db/.env.local', 'db/local.db', 'db/local.db-wal',
    'notify_config.json', 'worker/.dev.vars', 'certs/server.pem', 'npm-debug.log',
    'node_modules/dayjs/index.js', '.git/config',
    'eod/data/eod/eod-2026-11-11.json',
    'eod/data/eod/raw/eod-2026-11-11.raw.json',
    'eod/data/pattern/pattern-kline-2026-11-09.json',
    'eod/data/perf-weekly.json',
    'pulse/data/latest.json', 'pulse/reports/latest.html'];
  const mustPass = ['db/.env.example', 'notify_config.example.json', 'paths.js',
    'db/schema.sql', 'eod/data/industry-map.json', 'bin/candidate-pool.js',
    'eod/lib/sector.js', 'eod/tail_screener.js', 'rules.js', 'pulse/run.js'];
  const mustAllow = ['package.json', 'README.md', 'paths.js', 'rules.js',
    'gen_candidates.js', 'candidates.example.json', 'bin/candidate-pool.js',
    'eod/tail_screener.js', 'eod/pattern.templates.json', 'eod/lib/sector.js',
    'eod/lib/pattern.fixture.json', 'eod/data/industry-map.json',
    'pulse/run.js', 'pulse/probe.mjs', 'pulse/lib/ui.js', 'pulse/sources/news.js',
    'db/schema.sql', 'db/.env.example'];
  const mustReject = ['CHANGELOG.md', 'eod/data/perf-weekly.json',
    'eod/data/eod/eod-2026-11-11.json', 'eod/reports/tail/a.html',
    'eod/logs/tail.log', 'web/package.json', 'db/local.db',
    'pulse/data/latest.json', 'pulse/reports/latest.html'];
  const missed = mustFlag.filter((f) => violations([f]).length === 0);
  const wrong = mustPass.filter((f) => violations([f]).length > 0);
  const blocked = mustAllow.filter((f) => !allowed(f));
  const leaked = mustReject.filter((f) => allowed(f));
  if (missed.length || wrong.length || blocked.length || leaked.length) {
    console.error('✖ 守门规则自检失败 —— 该拦的没拦：', [...missed, ...leaked],
      '；不该拦的拦了：', [...wrong, ...blocked]);
    process.exit(1);
  }
  // 注释剥离本身也要自检：示例 require 必须被忽略，真实 require 与 URL 必须保留。
  const sample = [
    '/*', " * const x = require('./lib/runlog');", ' */',
    "const a = require('../rules');", "// const b = require('./ghost');",
    "const url = 'https://news.example.com/a';",
  ].join('\n');
  const clean = stripComments(sample);
  if (clean.includes("require('./lib/runlog')") || clean.includes("require('./ghost')")
    || !clean.includes("require('../rules')") || !clean.includes('https://')) {
    console.error('✖ 注释剥离自检失败：JSDoc / 行注释 / URL 处理有误');
    process.exit(1);
  }
  console.log(`✔ 守门规则自检通过（禁入正例 ${mustFlag.length} / 反例 ${mustPass.length}；`
    + `集合正例 ${mustAllow.length} / 反例 ${mustReject.length}；注释剥离 OK）`);
}
selfTest();

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let out;
try {
  out = execFileSync(npm, ['pack', '--dry-run', '--json'], {
    encoding: 'utf8',
    // Windows 下 spawn 一个 .cmd 必须经 shell（否则 EINVAL）；参数是常量，无注入面
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (e) {
  console.error('✖ npm pack --dry-run --json 执行失败：', e.message);
  process.exit(2);
}

/**
 * npm 的 --json 形状是「以包名为键的对象」：{ "candidate-pool": { files: [...], size, ... } }，
 * **不是数组** —— 按 [ ... ] 截取会切到 files 数组中间而 JSON.parse 失败。
 * 另外 stdout 可能混入 `prepare` 等生命周期脚本输出，故退化为「首个 { 到末个 }」再解析。
 */
function parsePackJson(text) {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s < 0 || e < s) throw new Error('输出里找不到 JSON 对象');
    return JSON.parse(t.slice(s, e + 1));
  }
}

let parsed;
try {
  parsed = parsePackJson(out);
} catch (err) {
  console.error(`✖ 无法解析 npm pack 的 JSON 输出（${err.message}）：\n` + out.slice(0, 500));
  process.exit(2);
}

const meta = Object.values(parsed)[0] || {};
const files = (meta.files || []).map((f) => f.path);
const filename = meta.filename || `${meta.name}-${meta.version}.tgz`;
console.log(`包体：${filename}  压缩后 ${kb(meta.size)} / 解包 ${kb(meta.unpackedSize)}  共 ${files.length} 个文件`);

/** 分类体积：每次都打印，让「代码正常增长」与「误打包数据」一眼可分 */
function category(p) {
  if (p === 'eod/data/industry-map.json') return '种子数据';
  if (p.startsWith('eod/lib/')) return 'eod/lib 代码';
  if (p.startsWith('eod/')) return 'eod 根层代码';
  if (p.startsWith('pulse/')) return 'pulse 代码';
  if (p.startsWith('db/')) return 'db 代码';
  if (p.startsWith('bin/')) return 'bin 入口';
  return '文档 / 模板 / 元数据';
}
const byCategory = new Map();
for (const f of meta.files || []) {
  const k = category(f.path);
  const v = byCategory.get(k) || { n: 0, z: 0 };
  v.n++;
  v.z += f.size || 0;
  byCategory.set(k, v);
}
console.log(`体积构成（距 ${kb(SIZE_LIMIT)} 红线尚余 ${kb(Math.max(0, SIZE_LIMIT - meta.unpackedSize))}）：`);
for (const [k, v] of [...byCategory].sort((a, b) => b[1].z - a[1].z)) {
  console.log(`   ${kb(v.z).padStart(12)}  ${String(v.n).padStart(3)} 个  ${k}`);
}

let bad = 0;
if (files.length !== meta.entryCount) {
  console.error(`✖ 文件数不一致：files=${files.length} entryCount=${meta.entryCount}`);
  bad++;
}
for (const f of files) {
  for (const [re, why] of FORBIDDEN) {
    if (re.test(f)) {
      console.error(`✖ 禁止入包：${f}  —— ${why}`);
      bad++;
    }
  }
}
const unexpected = files.filter((f) => !allowed(f));
for (const f of unexpected) {
  console.error(`✖ 未登记入包：${f}（不属于代码 / 模板 / 种子 / 元数据，先查 files 白名单）`);
}
bad += unexpected.length;

const fat = (meta.files || []).filter((f) => (f.size || 0) > FILE_LIMIT);
for (const f of fat) {
  console.error(`✖ 单文件超过 ${kb(FILE_LIMIT)}：${f.path}（${kb(f.size)}）—— 需压缩或显式登记`);
}
bad += fat.length;

const missing = REQUIRED.filter((p) => !files.includes(p));
for (const p of missing) console.error(`✖ 缺少必需文件：${p}（files 白名单可能漏了它）`);
bad += missing.length;

/**
 * 代码覆盖 —— 白名单收窄成显式 glob 后的反向风险是「新增代码忘了加白名单」。
 * 用 git 跟踪清单反查：bin/ eod/ db/ pulse/ 下的代码资产（排除各自 data/reports）
 * 必须全部出现在 tarball 中。脱离 git 仓库运行时跳过。
 */
function missingCode() {
  let listed;
  try {
    listed = execFileSync('git', ['ls-files', 'bin', 'eod', 'db', 'pulse'], { encoding: 'utf8' })
      .split(/\r?\n/).filter(Boolean);
  } catch {
    console.log('· 代码覆盖检查跳过（当前目录不是 git 仓库）');
    return [];
  }
  const set = new Set(files);
  return listed.filter((f) =>
    !f.startsWith('eod/data/') &&
    !f.startsWith('eod/reports/') &&
    !f.startsWith('pulse/data/') &&
    !f.startsWith('pulse/reports/') &&
    (/\.(js|mjs|json|sql)$/.test(f) || f.endsWith('.env.example')) &&
    !set.has(f));
}
const uncovered = missingCode();
for (const f of uncovered) console.error(`✖ 代码资产未入包：${f}（files 白名单漏了它）`);
bad += uncovered.length;

/**
 * 运行时相对依赖闭包 —— 上面两条查的是「清单齐不齐」，这条查的是「装了能不能跑」。
 * `rules.js` 这类被间接 require 的模块，点名清单永远抓不到；只有真去解析每个
 * 入包 JS 的 require / import，才能发现它指向了包外文件。
 */
function brokenRequires() {
  const set = new Set(files);
  const out = [];
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)|(?:from|import)\s*['"](\.[^'"]+)['"]/g;
  for (const f of files.filter((x) => /\.(js|mjs|cjs)$/.test(x))) {
    let src;
    try {
      src = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const m of stripComments(src).matchAll(re)) {
      const spec = m[1] || m[2];
      const base = pathPosix.normalize(pathPosix.join(pathPosix.dirname(f), spec));
      const cand = [base, `${base}.js`, `${base}.json`, `${base}.mjs`, `${base}.cjs`,
        pathPosix.join(base, 'index.js')];
      if (!cand.some((c) => set.has(c))) out.push(`${f} → ${spec}`);
    }
  }
  return out;
}
const broken = brokenRequires();
for (const b of broken) console.error(`✖ 运行时依赖未入包：${b}（装包后会 Cannot find module）`);
bad += broken.length;
if (!uncovered.length && !broken.length) console.log('✔ 文件集合已登记、代码资产与 require 闭包完整');

if (meta.unpackedSize > SIZE_LIMIT) {
  console.error(`✖ 解包体积 ${kb(meta.unpackedSize)} 超过红线 ${kb(SIZE_LIMIT)}`);
  console.error('  先看上面的「未登记入包 / 禁止入包」：那是误打包，改 files 白名单，不要调红线。');
  console.error('  若构成全是代码资产，说明代码规模正常增长：人工复核后调整 SIZE_LIMIT 并留痕，别用调大数字掩盖误打包。');
  const byDir = new Map();
  for (const f of meta.files || []) {
    const parts = f.path.split('/');
    const key = parts.length > 2 ? `${parts.slice(0, 2).join('/')}/` : parts[0];
    byDir.set(key, (byDir.get(key) || 0) + (f.size || 0));
  }
  for (const [dir, size] of [...byDir].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.error(`   ${kb(size).padStart(14)}  ${dir}`);
  }
  bad++;
} else if (meta.unpackedSize > SIZE_LIMIT * 0.8) {
  console.log(`· 提示：已用红线的 ${(meta.unpackedSize / SIZE_LIMIT * 100).toFixed(0)}%，代码规模在增长；`
    + '后续若触线请复核构成再调整阈值。');
}

if (bad) {
  console.error(`\n打包体检未通过：${bad} 项问题（**不要发布**）`);
  process.exit(1);
}
console.log('✔ 打包体检通过：无运行数据 / 敏感文件、文件集合已登记、代码与依赖闭包完整、体积在红线内');
