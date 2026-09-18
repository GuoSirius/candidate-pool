#!/usr/bin/env node
/**
 * 一键发布前端到 Cloudflare Pages（静态资源 + Pages Functions 同源）。
 *
 * 用法：
 *   npm run deploy                                    # 读取 web/deploy.config.json（默认同源模式）
 *   npm run deploy -- --api ""                        # 显式同源：前端走相对 /api
 *   npm run deploy -- --api https://x.example.com     # 跨源：调用外部 Worker
 *   npm run deploy -- --project my-web --branch main  # 覆盖项目名 / 分支
 *
 * 取址优先级：CLI 参数 > 环境变量 > deploy.config.json。
 *   - apiBase 为空字符串 ⇒ 同源模式，前端走相对 /api，由本项目的 functions/ 提供（推荐）。
 *   - apiBase 为绝对地址  ⇒ 跨源模式，需要目标端开启 CORS。
 *
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
// 注意用 ?? 而非 ||：空字符串是合法值（同源模式），不能被短路掉。
const apiBase = String(flag('--api') ?? process.env.VITE_API_BASE ?? cfg.apiBase ?? '').trim();
const projectName = flag('--project') || process.env.PAGES_PROJECT || cfg.projectName || 'candidate-pool-web';
const branch = flag('--branch') || process.env.PAGES_BRANCH || cfg.branch || 'main';

if (apiBase.includes('REPLACE_ME')) {
  console.error(
    '[deploy] ✗ apiBase 仍是占位符。请改为：\n' +
      '         --api ""              同源模式（推荐，走本项目的 Pages Functions）\n' +
      '         --api https://...     跨源模式（调用外部 Worker）',
  );
  process.exit(1);
}

const sameOrigin = apiBase === '';
if (sameOrigin) {
  console.log('[deploy] 同源模式：前端走相对 /api，由本项目的 functions/ 提供。');
  if (!existsSync(resolve(root, 'functions'))) {
    console.error(
      '[deploy] ✗ 同源模式但未找到 web/functions 目录，部署后 /api 将 404。\n' +
        '         请创建 functions/api/[[route]].ts，或改用 --api 指定外部地址。',
    );
    process.exit(1);
  }
} else if (/\.workers\.dev$/i.test(apiBase)) {
  console.warn('[deploy] ⚠ 注意：*.workers.dev 在中国大陆常被 DNS 污染 / SNI 拦截，浏览器侧可能打不开。');
}

if (!existsSync(resolve(root, 'wrangler.toml'))) {
  console.warn('[deploy] ⚠ 未找到 web/wrangler.toml：Pages 项目配置与 D1 绑定将沿用控制台设置。');
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

// 1) 构建：注入 VITE_API_BASE（Vite 在 build 时读取；空串 = 相对路径）
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

// 3) 发布到 Cloudflare Pages。
//    cwd = web/，wrangler 会自动发现同级的 functions/ 与 wrangler.toml。
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
console.log(`[deploy]    API     = ${sameOrigin ? '同源 /api' : apiBase}`);
console.log(`[deploy]    访问地址 = https://${projectName}.pages.dev`);
console.log(`[deploy]    健康检查 = https://${projectName}.pages.dev/health`);
