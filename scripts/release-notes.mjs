#!/usr/bin/env node
/**
 * scripts/release-notes.mjs —— 生成 GitHub Release 说明
 * ---------------------------------------------------------------------------
 * 取数顺序（与本仓库其它项目一致的两级策略）：
 *   1) CHANGELOG.md 里**本版本那一段**（changelogen 在 `npm run release` 时写好，
 *      按 commitlint 的 11 类 type 分组，含每条提交的短 sha 链接）—— 首选；
 *   2) 取不到（changelogen 没跑 / 段落被手改坏）时**回退到 git**：用
 *      `git log <prev>..<tag>` 现场按同样的 11 类分组生成，保证 Release 绝不空。
 *   3) 末尾固定追加「完整变更 compare 链接 + 提交数 + 安装命令」。
 *
 * 为什么不直接用 `gh release create --generate-notes`：
 *   自动 notes 只列**有 PR 的**变更，而本仓库直接推 main、不走 PR —— 结果会只剩一行
 *   compare 链接，看不到逐条提交。需求是「每个版本的所有提交变化都可见」。
 *
 * **支持「打 tag 前预览」**：tag 尚不存在时自动以 HEAD 代替（见 revOf），
 * 这样 `npm run release` 能在推 tag 之前先把说明打出来给人过目。
 *
 * 用法：
 *   node scripts/release-notes.mjs --tag v1.2.0 --out release-notes.md --install
 *   node scripts/release-notes.mjs                      # 取 HEAD 上的精确 tag，打到 stdout
 *   node scripts/release-notes.mjs --tag v1.2.0 --prev v1.1.0   # 手工指定上一版
 *   node scripts/release-notes.mjs --tag v1.2.0 --source git    # 强制走 git，便于比对
 *
 * 退出码：0 正常；1 参数 / git 出错（CI 里应直接失败，避免发出没有说明的 Release）。
 * ---------------------------------------------------------------------------
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const OPT = {
  tag: arg('--tag'),
  prev: arg('--prev'),
  out: arg('--out'),
  repo: arg('--repo'),
  source: arg('--source'), // changelog | git
  install: argv.includes('--install'),
};

// ---------- git ----------
// silent = true 吞掉 stderr：git 在「没有更早的 tag」这类**可预期失败**上会打脏日志，
// 而首次发布（无 prev）正是要正常处理的分支。
const git = (args, silent = false) => execFileSync('git', args, {
  encoding: 'utf8',
  stdio: silent ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'],
}).trim();

function resolveTag() {
  if (OPT.tag) return OPT.tag;
  try {
    return git(['describe', '--tags', '--exact-match', 'HEAD'], true);
  } catch {
    throw new Error('HEAD 上没有 tag，请显式传 --tag <tag>');
  }
}

/**
 * 把 tag 解析成一个**确实存在的** revision。
 * tag 还没创建时（`npm run release` 在推 tag 前预览说明）回退到 HEAD —— 否则
 * `git describe <tag>^` 会失败，脚注会误报「首次发布 / 0 个提交」。
 */
function revOf(tag) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], true);
    return tag;
  } catch {
    return 'HEAD';
  }
}

/** 上一版 tag：从 tag 的父提交往前找最近的 tag；没有更早的 tag 时返回 null（首个版本） */
function resolvePrev(tag) {
  if (OPT.prev) return OPT.prev;
  const pending = revOf(tag) === 'HEAD'; // 预览场景：tag 还没建，从 HEAD 起算
  try {
    return git(['describe', '--tags', '--abbrev=0', pending ? 'HEAD' : `${tag}^`], true);
  } catch {
    return null;
  }
}

function repoUrl() {
  if (OPT.repo) return `https://github.com/${OPT.repo}`;
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const raw = (pkg.repository && pkg.repository.url) || '';
    const m = raw.match(/github\.com[/:]([^/]+\/[^/.]+)/);
    if (m) return `https://github.com/${m[1]}`;
  } catch { /* 回退到环境变量 */ }
  if (process.env.GITHUB_REPOSITORY) return `https://github.com/${process.env.GITHUB_REPOSITORY}`;
  return null;
}

// ---------- 来源 1：CHANGELOG.md 的本版本段落 ----------
/**
 * 抓 `## vX.Y.Z` 那一节的正文。
 * 逐行扫描而非正则：既有项目曾踩过「正则加了 m 标志、`$` 变成多行匹配，导致非贪婪捕获
 * 提前截断」的坑；行扫描没有这个隐患，也顺手兼容 `## v1.1.0` 与 `## [1.1.0] - 日期`
 * 两种标题风格（changelogen / standard-version）。
 */
function extractChangelogSection(md, version) {
  const lines = md.split(/\r?\n/);
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    const ver = /v?(\d+\.\d+\.\d+)/.exec(m[2].replace(/^\[|\]$/g, '').trim());
    if (start < 0) {
      if (ver && ver[1] === version) { start = i + 1; level = m[1].length; }
      continue;
    }
    // 遇到同级或更高级的标题即结束（= 下一个版本段落）
    if (m[1].length <= level) return lines.slice(start, i).join('\n').trim();
  }
  return start < 0 ? '' : lines.slice(start).join('\n').trim();
}

// ---------- 来源 2：git 提交历史（按 11 类 type 分组）----------
const GROUPS = [
  ['feat', '🚀 新功能 (Features)'],
  ['fix', '🐛 缺陷修复 (Bug Fixes)'],
  ['perf', '⚡ 性能优化 (Performance)'],
  ['refactor', '♻️ 代码重构 (Refactors)'],
  ['docs', '📚 文档 (Documentation)'],
  ['test', '🧪 测试 (Tests)'],
  ['build', '🔧 构建 (Build)'],
  ['ci', '⚙️ 持续集成 (CI)'],
  ['chore', '📦 杂项维护 (Chores)'],
  ['style', '🎨 代码格式 (Style)'],
  ['revert', '⏪ 回滚 (Reverts)'],
];
const OTHER = '📎 其它提交 (Others)';
const SUBJECT_RE = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

function parseCommit(line) {
  // 0x1f 分隔 sha 与 subject，避免标题里带 tab/空格时切错
  const i = line.indexOf('\x1f');
  const sha = line.slice(0, i);
  const subject = line.slice(i + 1);
  const m = subject.match(SUBJECT_RE);
  if (!m) return { sha, group: OTHER, text: subject, breaking: false };
  const [, type, scope, bang, text] = m;
  const known = GROUPS.find(([t]) => t === type);
  return {
    sha,
    group: known ? known[1] : OTHER,
    text: scope ? `**${scope}:** ${text}` : text,
    breaking: Boolean(bang),
  };
}

function commitsInRange(prev, rev) {
  const raw = git(['log', prev ? `${prev}..${rev}` : rev, '--pretty=format:%H\x1f%s']);
  return raw ? raw.split('\n').filter(Boolean).map(parseCommit) : [];
}

function notesFromGit(commits, repo) {
  const link = (sha) => (repo ? `[\`${sha.slice(0, 8)}\`](${repo}/commit/${sha})` : `\`${sha.slice(0, 8)}\``);
  const L = [];
  for (const title of [...GROUPS.map(([, t]) => t), OTHER]) {
    const list = commits.filter((c) => c.group === title);
    if (!list.length) continue;
    L.push(`### ${title}`, '');
    for (const c of list) L.push(`- ${c.breaking ? '**⚠️ BREAKING** ' : ''}${c.text} ${link(c.sha)}`);
    L.push('');
  }
  if (!commits.length) L.push('_本版无新增提交（可能是空发布，或 tag 指向了已发布过的提交）。_', '');
  return L.join('\n').trim();
}

// ---------- 组装 ----------
function build() {
  const tag = resolveTag();
  const version = tag.replace(/^v/, '');
  const rev = revOf(tag);
  const prev = resolvePrev(tag);
  const repo = repoUrl();

  let body = '';
  let source = 'changelog';
  const changelogPath = join(process.cwd(), 'CHANGELOG.md');
  if (OPT.source !== 'git' && existsSync(changelogPath)) {
    body = extractChangelogSection(readFileSync(changelogPath, 'utf8'), version);
  }
  let commits = null;
  if (!body) {
    source = 'git';
    commits = commitsInRange(prev, rev);
    body = notesFromGit(commits, repo);
  }
  if (!body) body = '_本版无变更记录。_';

  if (!commits) {
    try { commits = commitsInRange(prev, rev); } catch { commits = []; }
  }
  const total = commits.length;

  const L = [body, '', '---', ''];
  if (prev && repo) L.push(`**完整变更**：[${prev}...${tag}](${repo}/compare/${prev}...${tag}) ｜ 共 **${total}** 个提交`);
  else if (prev) L.push(`**完整变更**：${prev}...${tag} ｜ 共 **${total}** 个提交`);
  else L.push(`**首次发布**：包含全部 **${total}** 个提交`);

  if (OPT.install) {
    L.push('', '### 安装 / 运行', '', '```bash',
      `npx candidate-pool@${version} --help        # 次日候选池初筛`,
      `npx tail-screener@${version} --help         # 尾盘选股（14:50 口径）`,
      '```');
  }
  if (repo) L.push('', `**CHANGELOG**：[完整变更日志](${repo}/blob/main/CHANGELOG.md)`);

  return { tag, prev, source, total, pending: rev === 'HEAD', body: L.join('\n').trim() + '\n' };
}

const { tag, prev, source, total, pending, body } = build();
const info = `[release-notes] ${tag}（上一版 ${prev || '—'}，来源 ${source}，${total} 个提交`
  + `${pending ? '，tag 尚未创建：按 HEAD 统计' : ''}，${body.split('\n').length} 行）`;
if (OPT.out) {
  writeFileSync(OPT.out, body);
  process.stderr.write(`${info} → ${OPT.out}\n`);
} else {
  process.stderr.write(`${info}\n`);
  process.stdout.write(body);
}
