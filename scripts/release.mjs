#!/usr/bin/env node
/**
 * 交互式发布脚本 —— 根目录 npm run release 调用。
 *
 * 完整链路：未提交检测 → 类型门禁 → 选版本 → changelogen 写版本号 + CHANGELOG →
 *           同步子包版本 → 预览 Release 说明 → 提交 → 打 tag → 推送。
 *
 * **本机到此为止，且不执行 npm publish**：tag 推送即触发 .github/workflows/release.yml，
 * 由 CI 完成「版本一致性校验 → 离线自测 → 打包体检 → npm publish → 建 GitHub Release」。
 *
 * **不含部署**：Cloudflare（Pages + Worker 共用一份 API）已退出本脚本，
 * 需要发布前端/接口时单独跑 `npm run deploy`。理由见本节末尾注释。
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

  // ⑥ Release 说明预览 —— CI 用的是**同一个脚本**，所以这里看到什么，GitHub Release 就是什么。
  //    刻意放在打 tag 之前：说明为空能在发版前发现（否则 CI 会安静地建出一个空 Release）。
  console.log('\n── Release 说明预览（取自 CHANGELOG.md，CI 复用同一脚本生成）──\n');
  let notes = '';
  try {
    notes = sh(`node scripts/release-notes.mjs --tag v${newVersion} --install`);
  } catch { /* 生成失败当空处理，下面统一告警 */ }
  console.log(notes || '(空)');
  if (!notes || notes.includes('无变更记录') || notes.length < 80) {
    console.log(`\n⚠ Release 说明看起来是空的 —— CI 建出的 Release 也会是空的。`);
    console.log(`  多半是 changelogen 没写出 \`## v${newVersion}\` 段落；可稍后用`);
    console.log(`  \`npm run release:notes -- --tag v${newVersion} --source git\` 核对 git 兜底分支。`);
  }

  // ⑦ 提交 + 打 tag + 推送（本机到此为止，发布动作在 CI）
  run('git add package.json worker/package.json web/package.json CHANGELOG.md');
  execSync(`git commit -m ${JSON.stringify(`chore(release): v${newVersion}`)}`, { stdio: 'inherit' });
  run(`git tag v${newVersion}`);
  const branch = sh('git rev-parse --abbrev-ref HEAD');
  run(`git push origin ${branch}`);
  run('git push origin --tags');

  const REPO = (() => {
    const m = String((pkg.repository && pkg.repository.url) || '').match(/github\.com[/:]([^/]+\/[^/.]+)/);
    return m ? m[1] : 'GuoSirius/candidate-pool';
  })();
  console.log(`\n✅ 本机部分完成：v${newVersion} 已提交并推送 (branch=${branch})`);
  console.log('\n接下来由 GitHub Actions 自动完成（**本机不执行 npm publish**）：');
  console.log('  版本校验 → 离线自测 → 打包体检 → npm publish → 建 GitHub Release');
  console.log(`  · 运行日志 : https://github.com/${REPO}/actions/workflows/release.yml`);
  console.log(`  · npm      : https://www.npmjs.com/package/${pkg.name}/v/${newVersion}`);
  console.log(`  · Release  : https://github.com/${REPO}/releases/tag/v${newVersion}`);
  console.log('  约 1~2 分钟。若 Actions 标红，最常见原因是仓库尚未配置 Secret `NPM_TOKEN`。');

  // 为什么不再在这里 deploy：
  //   1. 部署与「发版」是两件事 —— tag 一旦推上去就无法回滚，而部署失败在那之后发生，
  //      结果是一个「版本已发布、站点却还是旧的」的中间态，很容易误判成发布失败。
  //   2. 网页的静态资源与 API 现在由同一个 Pages 项目承载（独立 Worker 已退出发布流程），
  //      发不发版都可能需要单独部署；把它绑死在 release 里会让纯粹的发版动作带上副作用。
  //   需要上线时单独执行：npm run deploy
  console.log('\nℹ 部署已从本脚本移除（与发版解耦）。需要上线前端/接口时单独执行：');
  console.log('    npm run deploy');
}

main().catch((e) => {
  console.error(e?.message ? `\n✖ ${e.message}` : e);
  process.exit(1);
});
