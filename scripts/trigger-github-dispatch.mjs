#!/usr/bin/env node
/**
 * 本地准点触发 GitHub Actions workflow_dispatch
 * ====================================================================
 * 背景：GitHub 的 schedule cron 在公开/免费仓库上有调度队列延迟（实测 ~6.5h 抖动），
 *       导致三个尾盘/初筛工作流总在晚间 20-22 点才跑，数据虽仍正确但严重迟滞。
 *       本脚本由本机在交易时段「准点」调用 dispatch API，GitHub 收到即执行，
 *       无调度队列延迟 —— 让 GitHub 也准点跑。
 *
 * 配套改动：三个 workflow 的 `schedule:` 段已删除，仅保留 `workflow_dispatch`，
 *           避免「GitHub 自带定时」与「本脚本」双触发（双触发会重复推送通知）。
 *
 * 用法：
 *   node scripts/trigger-github-dispatch.mjs --workflow observe
 *   node scripts/trigger-github-dispatch.mjs --workflow screen --input wait=true
 *   node scripts/trigger-github-dispatch.mjs --workflow daily  --input mode=live
 *   node scripts/trigger-github-dispatch.mjs --workflow tail-observe.yml --dry-run
 *
 * 别名（含默认 ref / inputs，本地自动化直接用别名即可）：
 *   observe → tail-observe.yml   (ref=main, 无 inputs)   —— 本地 14:20 触发，工作流内等 14:30
 *   screen  → tail-screen.yml    (ref=main, wait=true)   —— 本地 14:40 触发，工作流内等 14:50
 *   daily   → daily-screen.yml   (ref=main, mode=live)   —— 本地 15:30 触发
 *
 * 凭证（任选其一，优先级从高到低）：
 *   1. --token <pat>
 *   2. 环境变量 GH_TOKEN / GITHUB_TOKEN（推荐：在系统环境变量里设好，重启 WorkBuddy 生效）
 *   3. 文件 .github/dispatch-token（已 gitignore，chmod 600；仅作兜底）
 *   PAT 需 fine-grained 权限 actions:write（或 classic repo 的 workflow 权限）。
 *
 * 仓库：默认从 `git remote get-url origin` 推断 owner/repo；可用 --repo owner/name 覆盖。
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ALIASES = {
  observe: { file: 'tail-observe.yml', ref: 'main', inputs: {} },
  screen: { file: 'tail-screen.yml', ref: 'main', inputs: { wait: 'true' } },
  daily: { file: 'daily-screen.yml', ref: 'main', inputs: { mode: 'live' } },
};

function printHelp() {
  console.log(`用法: node scripts/trigger-github-dispatch.mjs --workflow <observe|screen|daily|文件名> [选项]

选项:
  -w, --workflow <name>   别名 observe|screen|daily，或 workflow 文件名 / 数字 id（必填）
  -i, --input <k=v>       传给 workflow_dispatch 的 input（可多次），如 mode=live
  -r, --ref <branch>      触发的分支（默认 main）
      --repo <owner/name> 覆盖自动推断的仓库
      --token <pat>       临时指定 GitHub token（也可用 GH_TOKEN 环境变量）
      --retries <n>       失败重试次数（默认 3）
  -n, --dry-run           只打印请求，不实际发送
  -h, --help              显示本帮助`);
}

function parseArgs(argv) {
  const out = { inputs: {}, dryRun: false, retries: 3, token: undefined, repo: undefined, ref: undefined, workflow: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workflow' || a === '-w') out.workflow = argv[++i];
    else if (a === '--input' || a === '-i') {
      const kv = argv[++i];
      const eq = kv.indexOf('=');
      if (eq === -1) throw new Error(`--input 需为 key=value 形式，收到: ${kv}`);
      out.inputs[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === '--ref') out.ref = argv[++i];
    else if (a === '--repo') out.repo = argv[++i];
    else if (a === '--token') out.token = argv[++i];
    else if (a === '--retries') out.retries = parseInt(argv[++i], 10);
    else if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`未知参数: ${a}`);
  }
  if (!out.workflow) throw new Error('缺少 --workflow（observe|screen|daily 或 workflow 文件名）');
  return out;
}

function detectRepo() {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    const m = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch {
    /* 非 git 仓库或 remote 未设 */
  }
  return undefined;
}

function resolveToken(argToken) {
  if (argToken) return argToken;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const p = resolve(__dirname, '..', '.github', 'dispatch-token');
  try {
    return readFileSync(p, 'utf8').trim();
  } catch {
    return undefined;
  }
}

function resolveTarget(args) {
  const alias = ALIASES[args.workflow];
  if (alias) {
    return { file: alias.file, ref: args.ref || alias.ref, inputs: { ...alias.inputs, ...args.inputs } };
  }
  // 当作文件名或数字 id
  return { file: args.workflow, ref: args.ref || 'main', inputs: args.inputs };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dispatch(owner, repo, file, ref, inputs, token, retries) {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(file)}/dispatches`;
  const body = JSON.stringify({ ref, inputs });
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'trigger-github-dispatch',
        },
        body,
      });
      if (res.status === 204) return { ok: true, status: 204 };
      const text = (await res.text().catch(() => '')) || '';
      // 5xx / 429 可重试（GitHub 偶发限流或网关抖动）
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
        if (attempt < retries) {
          console.warn(`⚠️ 第 ${attempt} 次返回 ${res.status}，2s 后重试…`);
          await sleep(attempt * 2000);
          continue;
        }
        return { ok: false, status: res.status, text };
      }
      return { ok: false, status: res.status, text };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        console.warn(`⚠️ 第 ${attempt} 次网络异常（${e.message}），2s 后重试…`);
        await sleep(attempt * 2000);
        continue;
      }
    }
  }
  return { ok: false, status: 0, text: String((lastErr && lastErr.message) || lastErr) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoArg = args.repo || detectRepo();
  const [owner, repoName] = (repoArg || '').split('/');
  if (!owner || !repoName) {
    console.error('❌ 无法确定仓库（--repo owner/name 或 git remote origin 必须存在）');
    process.exit(2);
  }
  const { file, ref, inputs } = resolveTarget(args);
  const url = `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(file)}/dispatches`;

  console.log(`→ 触发 ${owner}/${repoName} :: ${file} (ref=${ref})`);
  console.log(`  inputs=${JSON.stringify(inputs)}`);

  if (args.dryRun) {
    console.log(`[dry-run] POST ${url}`);
    console.log(`[dry-run] body=${JSON.stringify({ ref, inputs })}`);
    console.log('[dry-run] 未实际发送。去掉 --dry-run 即真实触发。');
    process.exit(0);
  }

  const token = resolveToken(args.token);
  if (!token) {
    console.error('❌ 未找到 GitHub token：请用 --token，或设置环境变量 GH_TOKEN，或写入 .github/dispatch-token');
    process.exit(2);
  }

  const result = await dispatch(owner, repoName, file, ref, inputs, token, args.retries);
  if (result.ok) {
    console.log(`✅ dispatch 成功：${file}（HTTP 204，GitHub 已入队，稍后于 Actions 页面可见）`);
    process.exit(0);
  } else {
    console.error(`❌ dispatch 失败：HTTP ${result.status} ${result.text || ''}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(2);
});
