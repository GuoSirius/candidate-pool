// Cloudflare Workers 入口（Hono）。
// 环境通过 c.env 注入，不需要 dotenv：
//   - 本地开发：wrangler dev 自动加载 .dev.vars
//   - 生产：wrangler secret put 注入机密变量，[vars] 放非机密变量
// 本项目接口只读 D1，无需任何密钥。
import { Hono } from 'hono';
import { ok, fail } from './lib/response.js';
import type { Bindings } from './types.js';
import {
  listRuns,
  getRunByAnchor,
  getPicks,
  getStockHistory,
  searchStockBase,
  listGroups,
} from './lib/db.js';

const app = new Hono<{ Bindings: Bindings }>();

// CORS：前端（Cloudflare Pages 等独立源）调用本 Worker 时需要。内部工具，放开为 *。
app.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
});
app.options('*', (c) => c.body(null, 204));

app.get('/health', (c) => ok(c, { ok: true, ts: Date.now() }));

app.get('/', (c) =>
  ok(c, {
    name: 'candidate-pool-api',
    endpoints: [
      'GET /api/runs?limit=30',
      'GET /api/runs/:anchor?tier=high|secondary|conditional|excluded',
      'GET /api/stocks/:code',
      'GET /api/stock-base?q=&group=',
      'GET /api/groups',
    ],
  }),
);

app.get('/api/runs', async (c) => {
  const raw = Number(c.req.query('limit')) || 30;
  const limit = Math.min(Math.max(raw, 1), 100);
  const data = await listRuns(c.env.DB, limit);
  return ok(c, data);
});

app.get('/api/runs/:anchor', async (c) => {
  const anchor = c.req.param('anchor');
  const tier = c.req.query('tier');
  const run = await getRunByAnchor(c.env.DB, anchor);
  if (!run) return fail(c, 404, `未找到锚定日 ${anchor} 的运行批次`);
  const picks = await getPicks(c.env.DB, run.id, tier ?? undefined);
  return ok(c, { run, picks });
});

app.get('/api/stocks/:code', async (c) => {
  const code = c.req.param('code');
  const data = await getStockHistory(c.env.DB, code);
  if (!data) return fail(c, 404, `未找到股票 ${code} 的入选记录`);
  return ok(c, data);
});

app.get('/api/stock-base', async (c) => {
  const q = c.req.query('q');
  const group = c.req.query('group');
  const data = await searchStockBase(c.env.DB, { q: q ?? null, group: group ?? null });
  return ok(c, data);
});

app.get('/api/groups', async (c) => {
  const data = await listGroups(c.env.DB);
  return ok(c, data);
});

app.onError((err, c) => {
  console.error('[unhandled error]', err);
  return fail(c, 500, 'internal error');
});

app.notFound((c) => fail(c, 404, 'not found'));

export default app;
