#!/usr/bin/env node
/**
 * scripts/verify-pack.mjs —— 打包体检：敏感文件守门 + 必需文件点名 + 体积
 * ---------------------------------------------------------------------------
 * 为什么必须有这个脚本：
 *   `files` 是**硬白名单**，目录级条目（如 "db/"）会**绕过 .gitignore**。
 *   实测本仓库首次配置时，`db/.env`（Cloudflare API 令牌）与 `db/local.db`
 *   被原样打进了 tarball —— 一旦 `npm publish` 就是**凭据泄露**，且 npm 的
 *   撤销额度有限。故把检查固化成脚本，由 CI 在 publish **之前**执行，命中即失败。
 *
 * 用法：node scripts/verify-pack.mjs        （npm run verify:pack）
 * 退出码：0 通过；1 有违规或缺文件；2 无法解析 npm 输出（同样是失败）。
 * ---------------------------------------------------------------------------
 */
import { execFileSync } from 'node:child_process';

// 禁止入包：凭据、本地库、密钥、日志、依赖目录。模板文件（*.example*）不受影响。
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
];

// 必须入包：缺任何一个，装了也用不了。
// 注意后四项是「首次运行脚手架」的依赖 —— 少了它们的后果不是报错，而是
// 空目录首跑直接失败（缺模板）或全市场塌成单一「未分类」（缺行业映射种子）。
const REQUIRED = [
  'package.json',
  'bin/candidate-pool.js',
  'bin/tail-screener.js',
  'paths.js',
  'scaffold.js',
  'gen_candidates.js',
  'eod/tail_screener.js',
  'eod/lib/sector.js',
  'db/schema.sql',
  'candidates.example.json',
  'notify_config.example.json',
  'db/.env.example',
  'eod/data/industry-map.json',
];

// 体积红线：超过它通常是误把 data/ 或 node_modules 打进来了
const SIZE_LIMIT = 2 * 1024 * 1024;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const violations = (list) => list.filter((f) => FORBIDDEN.some(([re]) => re.test(f)));

/**
 * 守门规则自检 —— 每次体检前先跑。
 * 这类「正则白名单」最怕被后人顺手放宽（把 .env 的规则删掉就再也不报警了），
 * 所以把正反例都钉在这里：正例必须被抓到，反例必须放行。
 */
function selfTest() {
  const mustFlag = ['db/.env', 'db/.env.local', 'db/local.db', 'db/local.db-wal',
    'notify_config.json', 'worker/.dev.vars', 'certs/server.pem', 'npm-debug.log',
    'node_modules/dayjs/index.js', '.git/config'];
  const mustPass = ['db/.env.example', 'notify_config.example.json', 'paths.js',
    'db/schema.sql', 'eod/data/industry-map.json', 'bin/candidate-pool.js'];
  const missed = mustFlag.filter((f) => violations([f]).length === 0);
  const wrong = mustPass.filter((f) => violations([f]).length > 0);
  if (missed.length || wrong.length) {
    console.error('✖ 守门规则自检失败 —— 该拦的没拦：', missed, '；不该拦的拦了：', wrong);
    process.exit(1);
  }
  console.log(`✔ 守门规则自检通过（正例 ${mustFlag.length} / 反例 ${mustPass.length}）`);
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

const missing = REQUIRED.filter((p) => !files.includes(p));
for (const p of missing) console.error(`✖ 缺少必需文件：${p}（files 白名单可能漏了它）`);
bad += missing.length;

if (meta.unpackedSize > SIZE_LIMIT) {
  console.error(`✖ 解包体积 ${kb(meta.unpackedSize)} 超过红线 ${kb(SIZE_LIMIT)}，检查是否误打包数据目录`);
  bad++;
}

if (bad) {
  console.error(`\n打包体检未通过：${bad} 项问题（**不要发布**）`);
  process.exit(1);
}
console.log('✔ 打包体检通过：无敏感文件、必需文件齐全、体积在红线内');
