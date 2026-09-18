#!/usr/bin/env node
/**
 * 一键发布前端到 Cloudflare Pages。
 *
 * 用法：
 *   npm run deploy                                    # 读取 web/deploy.config.json
 *   npm run deploy -- --api https://x.workers.dev     # 临时指定 Worker 地址
 *   npm run deploy -- --project my-web --branch main  # 覆盖项目名 / 分支
 *
 * 取址优先级：CLI 参数 > 环境变量 > deploy.config.json > 兜底默认值。
 * wrangler 复用：优先 web/node_modules，其次 ../worker/node_modules，最后 npx 兜底，
 * 因此通常无需为前端单独安装 wrangler。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function loadConfig() {
  const p = resolve(root, 'deploy.config.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn(`[deploy] deploy.config.json 解析失败，已忽略：${e.message}`);
    return {};
  }
}

const cfg = loadConfig();
const apiBase = String(flag('--api') || process.env.VITE_API_BASE || cfg.apiBase || '').trim();
const projectName = flag('--project') || process.env.PAGES_PROJECT || cfg.projectName || 'candidate-pool-web';
const branch = flag('--branch') || process.env.PAGES_BRANCH || cfg.branch || 'main';

if (!apiBase || apiBase.includes('REPLACE_ME')) {
  console.error(
    '[deploy] ✗ 缺少 Worker 地址。请在 web/deploy.config.json 填 apiBase，或运行：\n' +
      '         npm run deploy -- --api https://<你的-worker子域>.workers.dev',
  );
  process.exit(1);
}

function run(cmd, cmdArgs, extraEnv) {
  console.log(`\n[deploy] $ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env, ...(extraEnv || {}) },
  });
  if (r.status !== 0) {
    console.error(`[deploy] ✗ 命令失败：${cmd} ${cmdArgs.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

// 1) 构建：注入 VITE_API_BASE（Vite 在 build 时读取）
run('npm', ['run', 'build'], { VITE_API_BASE: apiBase });

// 2) 解析 wrangler：web → ../worker → npx
const binPath = (dir) => resolve(dir, 'node_modules', '.bin', isWin ? 'wrangler.cmd' : 'wrangler');
const local = [binPath(root), binPath(resolve(root, '..', 'worker'))].find((p) => existsSync(p));
let wranglerCmd = 'npx';
let wranglerPrefix = ['-y', 'wrangler'];
if (local) {
  wranglerCmd = local;
  wranglerPrefix = [];
  console.log(`[deploy] 使用本地 wrangler：${local}`);
} else {
  console.log('[deploy] 未找到本地 wrangler，回退 npx（首次会临时下载）。');
}

// 3) 发布到 Cloudflare Pages
run(wranglerCmd, [
  ...wranglerPrefix,
  'pages',
  'deploy',
  'dist',
  '--project-name',
  projectName,
  '--branch',
  branch,
  '--commit-dirty=true',
]);

console.log('\n[deploy] ✅ 发布完成');
console.log(`[deploy]    project = ${projectName}`);
console.log(`[deploy]    branch  = ${branch}`);
console.log(`[deploy]    API     = ${apiBase}`);
console.log(`[deploy]    访问地址 = https://${projectName}.pages.dev （首次部署后约 1～2 分钟生效）`);
