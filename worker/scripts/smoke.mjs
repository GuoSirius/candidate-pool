#!/usr/bin/env node
/**
 * Worker 部署冒烟验证（Node 18+ 内置 fetch，零依赖）。
 * 依次请求 /health、/api/runs、/api/stats、/api/groups，再做一次深度链路：
 * 最新批次 → 当日入选 → 取一只票查个股详情（验证 N 日 perf 计算）。
 * 每步校验 HTTP 200 + 业务码 200 + 关键字段。
 *
 * 用法：
 *   npm run smoke -- --api https://<你的-worker子域>.workers.dev
 *   WORKER_URL=https://... npm run smoke
 *
 * 代理：Node 的 fetch 默认不读 HTTP(S)_PROXY。若检测到代理环境变量，脚本会自动带
 * `--use-env-proxy` 重新执行自身（Node 22.22+ / 24 支持）；不支持时退回直连。
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HAS_PROXY = Boolean(
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy,
);
if (HAS_PROXY && !process.env.__SMOKE_PROXY_BOOTSTRAPPED) {
  const r = spawnSync(
    process.execPath,
    ['--use-env-proxy', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __SMOKE_PROXY_BOOTSTRAPPED: '1' } },
  );
  if (r.error || r.status === 9) {
    console.log('[smoke] 当前 Node 不支持 --use-env-proxy，忽略代理直连。');
  } else {
    process.exit(r.status ?? 1);
  }
}

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const base = String(flag('--api') || process.env.WORKER_URL || '').replace(/\/$/, '');
if (!base) {
  console.error('[smoke] ✗ 缺少 Worker 地址：npm run smoke -- --api https://xxx.workers.dev');
  process.exit(1);
}

let fail = 0;

async function get(path) {
  const res = await fetch(base + path);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function report(name, status, body, dataOk) {
  const bizOk = body && body.code === 200;
  const ok = status === 200 && bizOk && dataOk;
  if (!ok) fail++;
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${name.padEnd(26)} http=${status} code=${body?.code ?? '-'} msg=${body?.message ?? '-'}`);
  if (!ok) console.log('   ', JSON.stringify(body).slice(0, 300));
  return ok;
}

console.log(`[smoke] 目标：${base}\n`);

// —— 基础端点 ——
try {
  const r = await get('/health');
  report('GET /health', r.status, r.body, r.body?.data?.ok === true);
} catch (e) {
  fail++;
  console.log(`❌ GET /health            请求失败：${e.message}`);
}
try {
  const r = await get('/api/runs?limit=3');
  report('GET /api/runs?limit=3', r.status, r.body, Array.isArray(r.body?.data));
} catch (e) {
  fail++;
  console.log(`❌ GET /api/runs           请求失败：${e.message}`);
}
try {
  const r = await get('/api/stats');
  const d = r.body?.data;
  report('GET /api/stats', r.status, r.body, d && typeof d.total_picks === 'number' && Array.isArray(d.tiers));
} catch (e) {
  fail++;
  console.log(`❌ GET /api/stats          请求失败：${e.message}`);
}
try {
  const r = await get('/api/groups');
  report('GET /api/groups', r.status, r.body, Array.isArray(r.body?.data));
} catch (e) {
  fail++;
  console.log(`❌ GET /api/groups         请求失败：${e.message}`);
}

// —— 深度链路：最新批次 → 入选 → 个股详情（含 perf） ——
try {
  const runs = await get('/api/runs?limit=1');
  const anchor = runs.body?.data?.[0]?.anchor_date;
  if (!anchor) {
    console.log('⚠️  最新批次为空，跳过深度链路（可能尚未入库当日数据）');
  } else {
    const run = await get(`/api/runs/${anchor}`);
    report(`GET /api/runs/${anchor}`, run.status, run.body, run.body?.data?.run && Array.isArray(run.body?.data?.picks));
    const code = run.body?.data?.picks?.[0]?.code;
    if (code) {
      const s = await get(`/api/stocks/${code}`);
      const picks = s.body?.data?.picks;
      const hasPerf = Array.isArray(picks) && picks.length > 0 && 'perf' in picks[0];
      report(`GET /api/stocks/${code}`, s.status, s.body, hasPerf);
      if (hasPerf) console.log(`     ↳ perf 样例：${JSON.stringify(picks[0].perf)}`);
    } else {
      console.log('⚠️  该批次无入选记录，跳过个股详情');
    }
  }
} catch (e) {
  fail++;
  console.log(`❌ 深度链路                请求失败：${e.message}`);
}

console.log(fail ? `\n[smoke] ❌ ${fail} 项失败` : '\n[smoke] ✅ 全部通过');
process.exit(fail ? 1 : 0);
