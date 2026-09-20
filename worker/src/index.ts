// Cloudflare Workers 入口（Hono）。
// 环境通过 c.env 注入，不需要 dotenv：
//   - 本地开发：wrangler dev 自动加载 .dev.vars
//   - 生产：wrangler secret put 注入机密变量，[vars] 放非机密变量
// 读接口无需密钥；写接口需配置 WRITE_TOKEN（见 lib/auth.ts 与 lib/notes.ts）。
import { Hono } from 'hono';
import type { Context } from 'hono';
import { ok, fail, BizCode } from './lib/response.js';
import { guardWrite } from './lib/auth.js';
import { BizError, invalid } from './lib/errors.js';
import type { Bindings, NoteType } from './types.js';
import {
  listRuns,
  getRunByAnchor,
  getPicks,
  getStockHistory,
  searchStockBase,
  listGroups,
  getStats,
  rankStocks,
} from './lib/db.js';
import {
  getGroupDetail,
  createGroup,
  updateGroup,
  deleteGroup,
  addStockToGroup,
  removeStockFromGroup,
  createNote,
  updateNote,
  deleteNote,
} from './lib/notes.js';
import {
  DESC_MAX,
  REL_NOTE_MAX,
  optAnchorDate,
  optColor,
  optNoteType,
  optText,
  reqCode,
  reqContent,
  reqGroupName,
  reqId,
} from './lib/validate.js';

const app = new Hono<{ Bindings: Bindings }>();

type Ctx = Context<{ Bindings: Bindings }>;

// CORS：前端（Cloudflare Pages 等独立源）调用本 Worker 时需要。内部工具，放开为 *。
// 注意写方法（POST/PUT/DELETE）与自定义头 x-write-token 必须显式列出，否则浏览器预检不放行。
app.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, x-write-token');
});
app.options('*', (c) => c.body(null, 204));

/** 读取并校验 JSON 请求体：非对象一律按参数错误处理（不抛 500）。 */
async function readBody(c: Ctx): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw invalid('请求体必须是合法 JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('请求体必须是 JSON 对象');
  }
  return body as Record<string, unknown>;
}

/** 字段是否在请求体里显式出现（PUT 用它区分「改成 null」与「没传」）。 */
function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * 路由统一包装：
 *   - opts.write 为 true 时先过写令牌门禁（未配置 / 令牌错 → 10005）；
 *   - 把数据层抛出的 BizError 翻译成统一信封（10002 / 10003 / 10001）；
 *   - 其余异常继续冒泡到 app.onError（10004 + HTTP 500），便于监控真实故障。
 */
function handle(
  fn: (c: Ctx) => Promise<Response> | Response,
  opts: { write?: boolean } = {},
): (c: Ctx) => Promise<Response> {
  return async (c: Ctx): Promise<Response> => {
    if (opts.write) {
      const denied = guardWrite(c);
      if (denied) return denied;
    }
    try {
      return await fn(c);
    } catch (e) {
      if (e instanceof BizError) return fail(c, e.message, e.code);
      throw e;
    }
  };
}

app.get('/health', (c) => ok(c, { ok: true, ts: Date.now() }));

app.get('/', (c) =>
  ok(c, {
    name: 'candidate-pool-api',
    endpoints: [
      'GET /api/runs?limit=30',
      'GET /api/runs/:anchor?tier=high|secondary|conditional|excluded',
      'GET /api/stocks/:code',
      'GET /api/stock-base?q=&group=',
      'GET /api/stats?from=&to=',
      'GET /api/stock-rank?sort=recent|first|picks|high|secondary|conditional|excluded|n1|n2|n3|ln1|ln2|ln3|code&order=desc|asc&limit=',
      'GET /api/groups',
      'GET /api/groups/:id',
      'POST /api/groups',
      'PUT /api/groups/:id',
      'DELETE /api/groups/:id',
      'POST /api/groups/:id/stocks',
      'DELETE /api/groups/:id/stocks/:code',
      'POST /api/notes',
      'PUT /api/notes/:id',
      'DELETE /api/notes/:id',
    ],
    writeAuth: '以 x-write-token 请求头携带 WRITE_TOKEN；未配置 WRITE_TOKEN 时写接口一律拒绝（10005）',
  }),
);

// 全部入选股票汇总：每只票的入选次数 + 各档数量 + 首次/最近入选日 + N1/N2/N3（平均 / 最近一次两种口径）。
// sort 的 n1|n2|n3 = 历史平均口径，ln1|ln2|ln3 = 最近一次入选口径（last_n*）。
app.get('/api/stock-rank', async (c) => {
  const data = await rankStocks(c.env.DB, {
    sort: c.req.query('sort') ?? null,
    order: c.req.query('order') ?? null,
    limit: Number(c.req.query('limit')) || 1000,
  });
  return ok(c, data);
});

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
  if (!run) return fail(c, `未找到锚定日 ${anchor} 的运行批次`, BizCode.ERR_NOT_FOUND);
  const picks = await getPicks(c.env.DB, run.id, tier ?? undefined);
  return ok(c, { run, picks });
});

app.get('/api/stocks/:code', async (c) => {
  const code = c.req.param('code');
  const data = await getStockHistory(c.env.DB, code);
  if (!data) return fail(c, `未找到股票 ${code} 的入选记录`, BizCode.ERR_NOT_FOUND);
  return ok(c, data);
});

app.get('/api/stock-base', async (c) => {
  const q = c.req.query('q');
  const group = c.req.query('group');
  const data = await searchStockBase(c.env.DB, { q: q ?? null, group: group ?? null });
  return ok(c, data);
});

// 复盘统计：区间内全部入选记录的 N1/N3/N5/N10 命中率与均值（可选 from/to 过滤）。
app.get('/api/stats', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const data = await getStats(c.env.DB, { from: from ?? null, to: to ?? null });
  return ok(c, data);
});

// ---------------------------------------------------------------------------
// 分组（读）
// ---------------------------------------------------------------------------

app.get('/api/groups', async (c) => {
  const data = await listGroups(c.env.DB);
  return ok(c, data);
});

/** 分组详情：组信息 + 成员列表。 */
app.get(
  '/api/groups/:id',
  handle(async (c) => {
    const id = reqId(c.req.param('id'), '分组 id');
    return ok(c, await getGroupDetail(c.env.DB, id));
  }),
);

// ---------------------------------------------------------------------------
// 分组（写，需 x-write-token）
// ---------------------------------------------------------------------------

app.post(
  '/api/groups',
  handle(async (c) => {
    const body = await readBody(c);
    const group = await createGroup(c.env.DB, {
      name: reqGroupName(body.name),
      color: optColor(body.color),
      description: optText(body.description, 'description', DESC_MAX),
    });
    return ok(c, group, '分组已创建');
  }, { write: true }),
);

app.put(
  '/api/groups/:id',
  handle(async (c) => {
    const id = reqId(c.req.param('id'), '分组 id');
    const body = await readBody(c);
    // 只处理「显式出现」的字段：未传 = 保持原值，传 null = 清空
    const patch: { name?: string; color?: string | null; description?: string | null } = {};
    if (has(body, 'name')) patch.name = reqGroupName(body.name);
    if (has(body, 'color')) patch.color = optColor(body.color);
    if (has(body, 'description')) patch.description = optText(body.description, 'description', DESC_MAX);
    return ok(c, await updateGroup(c.env.DB, id, patch), '分组已更新');
  }, { write: true }),
);

app.delete(
  '/api/groups/:id',
  handle(async (c) => {
    const id = reqId(c.req.param('id'), '分组 id');
    const removed = await deleteGroup(c.env.DB, id);
    return ok(c, removed, `分组已删除，同时解除 ${removed.unlinked} 只票的关联`);
  }, { write: true }),
);

app.post(
  '/api/groups/:id/stocks',
  handle(async (c) => {
    const id = reqId(c.req.param('id'), '分组 id');
    const body = await readBody(c);
    const code = reqCode(body.code);
    const note = optText(body.note, 'note', REL_NOTE_MAX);
    return ok(c, await addStockToGroup(c.env.DB, id, code, note), '已加入分组');
  }, { write: true }),
);

app.delete(
  '/api/groups/:id/stocks/:code',
  handle(async (c) => {
    const id = reqId(c.req.param('id'), '分组 id');
    const code = reqCode(c.req.param('code'));
    return ok(c, await removeStockFromGroup(c.env.DB, id, code), '已移出分组');
  }, { write: true }),
);

// ---------------------------------------------------------------------------
// 评论 / 备忘（写，需 x-write-token）
// ---------------------------------------------------------------------------

app.post(
  '/api/notes',
  handle(async (c) => {
    const body = await readBody(c);
    const note = await createNote(c.env.DB, {
      code: reqCode(body.code),
      content: reqContent(body.content),
      type: optNoteType(body.type),
      anchorDate: optAnchorDate(body.anchor_date),
    });
    return ok(c, note, '备注已保存');
  }, { write: true }),
);

app.put(
  '/api/notes/:id',
  handle(async (c) => {
    const id = reqId(c.req.param('id'), '备注 id');
    const body = await readBody(c);
    const patch: { content?: string; type?: NoteType; anchorDate?: string | null } = {};
    if (has(body, 'content')) patch.content = reqContent(body.content);
    if (has(body, 'type')) patch.type = optNoteType(body.type);
    if (has(body, 'anchor_date')) patch.anchorDate = optAnchorDate(body.anchor_date);
    return ok(c, await updateNote(c.env.DB, id, patch), '备注已更新');
  }, { write: true }),
);

app.delete(
  '/api/notes/:id',
  handle(async (c) => {
    const id = reqId(c.req.param('id'), '备注 id');
    return ok(c, await deleteNote(c.env.DB, id), '备注已删除');
  }, { write: true }),
);

app.onError((err, c) => {
  console.error('[unhandled error]', err);
  return fail(c, 'internal error', BizCode.ERR_INTERNAL, null, 500);
});

app.notFound((c) => fail(c, 'not found', BizCode.ERR_NOT_FOUND));

export default app;
