'use strict';
/*
 * pulse/run.js —— 单次全流程：采集 → 分析 → 落盘 → 报告
 * 用法：node pulse/run.js（或 npm run pulse）
 */
const { collect, enrichLeaders } = require('./collect');
const { analyze } = require('./analyze');
const { buildReport } = require('./gen_report');
const store = require('./lib/store');

async function runOnce() {
  const snapshot = await collect();
  const analysis = analyze(snapshot);
  await enrichLeaders(analysis.hotBoards); // 热点板块补充 3-5 只领涨股
  const snapFile = store.saveSnapshot(snapshot);
  const html = buildReport(snapshot, analysis);
  const reportFile = store.saveReport(html, snapshot.runAt);
  return { snapshot, analysis, snapFile, reportFile };
}

if (require.main === module) {
  runOnce()
    .then(({ snapshot, analysis, snapFile, reportFile }) => {
      console.log(`[pulse] 完成 ${snapshot.runAtText}`);
      console.log(`[pulse] 信源: ${Object.entries(snapshot.sourcesStatus).map(([k, v]) => `${k}=${v}`).join(' | ')}`);
      const top = analysis.hotBoards.slice(0, 5)
        .map((b) => `${b.name}(分${b.score} ${b.verify}级)`).join(', ');
      console.log(`[pulse] 热点: ${top || '无'}`);
      console.log(`[pulse] 快照: ${snapFile}`);
      console.log(`[pulse] 报告: ${reportFile}`);
    })
    .catch((e) => { console.error('[pulse] 失败:', e); process.exitCode = 1; });
}

module.exports = { runOnce };
