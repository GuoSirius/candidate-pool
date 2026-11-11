'use strict';
/*
 * 历史 Markdown 简报 → 单文件 HTML（版式等价重建）
 * ---------------------------------------------------------------------------
 * 为什么要有这个脚本：2026-11-09 的胜率周报 / 观察池回流是最早的 .md 存档，
 * 2026-11-11 起报告统一为 HTML。历史存档不能重新计算（会篡改当时口径），
 * 但版式必须跟当前 brief_report.js 保持一致，否则归档页里同一类报告样式漂移。
 * 之前手写一次性脚本改了两次 style，故固化成可重复执行的入口：
 *
 *   node eod/rebuild_history_briefs.js            # 从 .md 重生成同名 .html
 *   node eod/rebuild_history_briefs.js --check    # 只比对，不写；不一致退出码 1（挂进 npm run selftest）
 *
 * 契约：**只做版式转换，不重算任何数据 / 数值**；原始 .md 保留不删。
 * 结构与样式全部走 eod/lib/brief_report.js，改 CSS 后重跑本脚本即可，
 * 不需要再手工替换历史 HTML 里的 <style>。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const paths = require('../paths');
const { esc, table, note, page } = require('./lib/brief_report');

const HOME = paths.home();
const CHECK = process.argv.includes('--check');

const JOBS = [
  {
    src: 'eod/reports/weekly/winrate-2026-11-09.md',
    subtitle: '管道 / 分项 / 游资三维度 · 纯只读，不推送、不调权重',
    footer: '本报告由程序自动生成，仅用于观察评级，不构成任何投资建议。',
  },
  {
    src: 'eod/reports/pool_reflow/pool_reflow-2026-11-09.md',
    subtitle: '只读 dry-run diff 默认不写回；确认后加 --apply 才追加写回',
    footer: '本报告由程序自动生成，仅用于人工审核观察池变更，不构成任何投资建议。',
  },
];

const MD_TABLE_SEP = /^\|[\s:|-]+\|$/;

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** 按未转义的 | 切单元格；旧 Markdown 用 \| 转义过单元格内的竖线 */
function cells(line) {
  return line.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function convert(md, job) {
  const lines = md.split(/\r?\n/);
  let title = '';
  const meta = [];
  let body = '';
  let i = 0;
  while (i < lines.length) {
    const l = lines[i].trim();
    if (!l) { i++; continue; }
    if (l.startsWith('# ')) { title = l.slice(2); i++; continue; }
    if (l.startsWith('- ')) { meta.push(inline(l.slice(2))); i++; continue; }
    if (l.startsWith('## ')) { body += `<h2>${inline(l.slice(3))}</h2>`; i++; continue; }
    if (l.startsWith('> ')) { body += note(inline(l.slice(2))); i++; continue; }
    if (l.startsWith('_') && l.endsWith('_')) { body += `<p class="muted">${inline(l.slice(1, -1))}</p>`; i++; continue; }
    if (l.startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { block.push(lines[i].trim()); i++; }
      const rows = block.filter((b) => !MD_TABLE_SEP.test(b)).map(cells);
      const head = rows.shift() || [];
      // 票表（代码 + 名称）与当前 pool_reflow.js 的双列冻结口径一致
      const opts = head[0] === '代码' && head[1] === '名称' ? { freeze: 2 } : {};
      body += table(head, rows, opts);
      continue;
    }
    body += `<p>${inline(l)}</p>`;
    i++;
  }
  return page({
    title,
    subtitle: job.subtitle,
    meta,
    body: note('<b>历史存档版式转换</b>：本报告由 2026-11-09 的 Markdown 原始存档等价转换，数据口径与数值未重新计算、未作任何修改。原始 <code>.md</code> 文件仍保留在仓库中。') + body,
    footer: job.footer,
  });
}

let failed = 0;
for (const job of JOBS) {
  const src = path.join(HOME, job.src);
  const out = src.replace(/\.md$/, '.html');
  if (!fs.existsSync(src)) {
    console.error(`[rebuild] ✗ 缺源存档：${src}`);
    failed++;
    continue;
  }
  const html = convert(fs.readFileSync(src, 'utf8'), job);
  const frozen = (html.match(/class="[^"]*freeze2/g) || []).length;
  if (CHECK) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    const same = cur === html;
    if (!same) failed++;
    console.log(`  ${same ? 'OK  ' : 'FAIL'}  ${job.src} → .html ${same ? '与当前版式一致' : '已落后于 brief_report.js，请跑 npm run report:history-briefs'}`);
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html, 'utf8');
    console.log(`[rebuild] ${job.src} → ${path.relative(HOME, out)} | 双列冻结表 ${frozen} 张`);
  }
}

if (CHECK) {
  console.log(failed ? `\n❌ ${failed} 份历史存档版式落后` : '\n✅ 历史存档版式与当前 brief_report.js 一致');
  process.exitCode = failed ? 1 : 0;
}
