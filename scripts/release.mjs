#!/usr/bin/env node
/**
 * 交互式发布脚本 —— 根目录 npm run release 调用。
 *
 * 完整链路：未提交检测 → 类型门禁 → 选版本 → changelogen 写版本号 + CHANGELOG →
 *           同步子包版本 → 提交 → 打 tag → 推送 → 部署(Worker + Pages)。
 *
 * 依赖：根 package.json 需有 scripts: typecheck / release；
 *       worker、web 各自有 deploy；changelogen / husky / commitlint 已装(devDep)。
 * 纯 Node 内置能力（无第三方依赖），交互部分用 raw mode 处理方向键。
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { join } from 'node:path';

const ROOT = process.cwd(); // npm run 在仓库根目录执行

const RELEASE_TYPES = [
  { type: 'patch', label: 'patch  (修复 / 补丁)' },
  { type: 'minor', label: 'minor  (新功能，向下兼容)' },
  { type: 'major', label: 'major  (破坏性变更)' },
];

// ---------- 工具 ----------

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`\n✖ 步骤失败，已中止：${cmd}`);
    process.exit(1);
  }
}

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function ask(question) {
  const rl = createInterface({ input, output });
  return rl.question(question).finally(() => rl.close());
}

async function confirm(question, defaultYes = false) {
  const a = (await ask(question)).trim().toLowerCase();
  if (a === '') return defaultYes;
  return a === 'y' || a === 'yes';
}

function readPkg(p) {
  return JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
}

function writePkg(p, obj) {
  writeFileSync(join(ROOT, p), JSON.stringify(obj, null, 2) + '\n');
}

function bump(version, type) {
  const [maj, min, pat] = version.split('.').map(Number);
  if (type === 'major') return `${maj + 1}.0.0`;
  if (type === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

/** 把新版本号同步写入 worker / web 两个子包，避免版本漂移 */
function syncSubPackages(version) {
  for (const p of ['worker/package.json', 'web/package.json']) {
    const pkg = readPkg(p);
    if (pkg.version !== version) {
      pkg.version = version;
      writePkg(p, pkg);
      console.log(`  ↳ 已同步 ${p} → v${version}`);
    }
  }
}

// 注：CHANGELOG 不再在发布选择界面打印，避免遮挡版本选择；
// 发版类型确认后由 changelogen 基于自上次 tag 以来的提交自动生成。

/** 渲染可选发版类型列表（高亮当前项） + 当前/新版本，界面保持简洁便于选版本 */
function renderScreen(currentVersion, selectedType) {
  const lines = [];
  lines.push(`当前版本: v${currentVersion}`);
  lines.push('');
  lines.push('↑/↓ 切换发版类型,  Enter 确认,  Ctrl+C 取消');
  lines.push('');
  for (const opt of RELEASE_TYPES) {
    const nv = bump(currentVersion, opt.type);
    const mark = opt.type === selectedType ? '●' : ' ';
    lines.push(`${mark} ${opt.label.padEnd(28)} →  v${nv}`);
  }
  lines.push('');
  lines.push('（CHANGELOG 将由 changelogen 基于自上次 tag 以来的提交自动生成）');
  return lines.join('\n');
}

/** 方向键选择发版类型，每次切换重绘屏幕 */
function selectRelease(currentVersion, commits) {
  return new Promise((resolve, reject) => {
    let idx = 0;
    const draw = () => {
      const screen = renderScreen(currentVersion, RELEASE_TYPES[idx].type, commits);
      process.stdout.write('\x1B[2J\x1B[3J\x1B[H' + screen);
    };
    const onData = (buf) => {
      const k = buf.toString();
      if (k === '\x1B[A') idx = (idx - 1 + RELEASE_TYPES.length) % RELEASE_TYPES.length;
      else if (k === '\x1B[B') idx = (idx + 1) % RELEASE_TYPES.length;
      else if (k === '\r' || k === '\n') {
        cleanup();
        resolve(RELEASE_TYPES[idx].type);
        return;
      } else if (k === '\x03') {
        cleanup();
        process.stdout.write('\n\n已取消发布。\n');
        reject(new Error('cancelled'));
        return;
      } else {
        return;
      }
      draw();
    };
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
    draw();
  });
}

// ---------- 主流程 ----------

async function main() {
  // ① 类型门禁
  run('npm run typecheck');

  // ② 未提交检测
  const status = sh('git status --porcelain');
  if (status) {
    console.log('\n⚠ 发现未提交的文件：');
    console.log(status);
    const msg = (await ask('请输入提交信息（约定式，如 "feat: ..."）：')).trim();
    if (!msg) {
      console.error('提交信息为空，已取消。');
      process.exit(1);
    }
    if (!(await confirm(`确认用 "${msg}" 提交并继续发布？(Y/n) `, true))) {
      console.error('已取消。');
      process.exit(1);
    }
    run('git add -A');
    execSync(`git commit -m ${JSON.stringify(msg)}`, { stdio: 'inherit' });
  }

  // ③ 发版选择
  const pkg = readPkg('package.json');
  const currentVersion = pkg.version;
  let selected;
  try {
    selected = await selectRelease(currentVersion);
  } catch {
    process.exit(1);
  }

  const newVersion = bump(currentVersion, selected);
  process.stdout.write(`\n\n确认发布 v${newVersion}\n`);

  // ④ 发布：changelogen 按选定类型 bump 版本号 + 增量写中文 CHANGELOG
  run(`npx changelogen --${selected} --bump`);

  // ⑤ 同步子包版本
  syncSubPackages(newVersion);

  // ⑥ 提交 + 打 tag + 推送（发布阶段）
  run('git add package.json worker/package.json web/package.json CHANGELOG.md');
  execSync(`git commit -m ${JSON.stringify(`chore(release): v${newVersion}`)}`, { stdio: 'inherit' });
  run(`git tag v${newVersion}`);
  const branch = sh('git rev-parse --abbrev-ref HEAD');
  run(`git push origin ${branch}`);
  run('git push origin --tags');
  console.log(`\n✅ 已发布 v${newVersion} 并推送 (branch=${branch})`);

  // ⑦ 部署阶段：Worker + Pages（Cloudflare）
  console.log('\n🚀 开始部署到 Cloudflare ...');
  run('npm run deploy --prefix worker');
  run('npm run deploy --prefix web');
  console.log(`\n🎉 全部完成：v${newVersion} 已发布并部署。`);
}

main().catch((e) => {
  console.error(e?.message ? `\n✖ ${e.message}` : e);
  process.exit(1);
});
