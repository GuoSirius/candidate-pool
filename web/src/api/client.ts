import type {
  ApiEnvelope,
  GroupDetail,
  GroupInput,
  GroupPatch,
  NoteInput,
  NoteListItem,
  NotePatch,
  RunBatch,
  PickRecord,
  StockHistory,
  StockBase,
  StockNote,
  WatchGroup,
  Tier,
  StatsResult,
  StockRankRow,
} from './types';
import { writeToken } from '../utils/writeToken';

// VITE_API_BASE 为空时退化为同源 /api（本地由 Vite 代理到 worker :8787）。
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

/** 业务码：200 成功；10001 通用；10002 资源不存在；10003 参数错误；10004 内部错误；10005 无写权限。 */
export const BizCode = {
  OK: 200,
  ERR_GENERIC: 10001,
  ERR_NOT_FOUND: 10002,
  ERR_INVALID_PARAM: 10003,
  ERR_INTERNAL: 10004,
  /** 无写权限：Worker 未配置 WRITE_TOKEN，或本地令牌不对 */
  ERR_FORBIDDEN: 10005,
} as const;

export class ApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

function url(path: string): string {
  return `${API_BASE}${path}`;
}

interface ReqOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** 请求体（自动 JSON 序列化） */
  body?: unknown;
  /** 是否为写接口：为 true 时带上 x-write-token 头 */
  write?: boolean;
}

async function request<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const { method = 'GET', body, write = false } = opts;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (write) headers['x-write-token'] = writeToken.value;

  let res: Response;
  try {
    res = await fetch(url(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(BizCode.ERR_INTERNAL, `网络请求失败：${(e as Error).message}`);
  }

  // 仅传输/网关层异常（如未捕获异常）才会返回非 200。
  if (res.status !== 200) {
    throw new ApiError(BizCode.ERR_INTERNAL, `服务异常（HTTP ${res.status}）`);
  }

  const payload = (await res.json()) as ApiEnvelope<T>;
  // 业务错误：HTTP 仍为 200，由 code 区分。
  if (payload.code !== BizCode.OK) {
    throw new ApiError(payload.code, payload.message || '请求失败');
  }
  return payload.data as T;
}

export const api = {
  /** 运行批次列表（按锚定日倒序）。 */
  listRuns(limit = 30): Promise<RunBatch[]> {
    return request<RunBatch[]>(`/api/runs?limit=${limit}`);
  },

  /** 单个锚定日的入选列表，可按档位过滤。 */
  getRun(anchor: string, tier?: Tier): Promise<{ run: RunBatch; picks: PickRecord[] }> {
    const q = tier ? `?tier=${tier}` : '';
    return request<{ run: RunBatch; picks: PickRecord[] }>(`/api/runs/${encodeURIComponent(anchor)}${q}`);
  },

  /** 单只股票的完整入选历史（含每期 N 日收益）。 */
  getStock(code: string): Promise<StockHistory> {
    return request<StockHistory>(`/api/stocks/${encodeURIComponent(code)}`);
  },

  /** 股票基础信息检索（按关键词 / 分组）。 */
  searchBase(q?: string, group?: string): Promise<Array<StockBase & { groups: string | null }>> {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (group) params.set('group', group);
    const qs = params.toString();
    return request(`/api/stock-base${qs ? `?${qs}` : ''}`);
  },

  /** 自选分组列表。 */
  listGroups(): Promise<WatchGroup[]> {
    return request<WatchGroup[]>('/api/groups');
  },

  /** 分组详情：组信息 + 成员列表。 */
  getGroup(id: number): Promise<GroupDetail> {
    return request<GroupDetail>(`/api/groups/${id}`);
  },

  /** 备注全量列表（按创建时间倒序，带股票名称/行业）。 */
  listNotes(limit = 300): Promise<NoteListItem[]> {
    return request<NoteListItem[]>(`/api/notes?limit=${limit}`);
  },

  /** 复盘统计：区间内 N1/N2/N3/N5/N7/N9/N10 命中率与均值 + 各档位 + 时间线。 */
  getStats(from?: string, to?: string): Promise<StatsResult> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request<StatsResult>(`/api/stats${qs ? `?${qs}` : ''}`);
  },

  /** 全部入选股票汇总（入选次数 + 各档数量 + 首次/最近入选日）。 */
  getStockRank(): Promise<StockRankRow[]> {
    return request<StockRankRow[]>('/api/stock-rank?limit=5000');
  },

  // -------------------------------------------------------------------------
  // 写接口：均需 Worker 侧配置 WRITE_TOKEN，并在本地存有同一令牌（见 utils/writeToken.ts）
  // -------------------------------------------------------------------------

  /** 新建分组。 */
  createGroup(input: GroupInput): Promise<WatchGroup> {
    return request<WatchGroup>('/api/groups', { method: 'POST', body: input, write: true });
  },

  /** 更新分组（局部字段）。 */
  updateGroup(id: number, patch: GroupPatch): Promise<WatchGroup> {
    return request<WatchGroup>(`/api/groups/${id}`, { method: 'PUT', body: patch, write: true });
  },

  /** 删除分组：同时解除票-组关联，不删票。 */
  deleteGroup(id: number): Promise<{ removed: boolean; unlinked: number }> {
    return request<{ removed: boolean; unlinked: number }>(`/api/groups/${id}`, {
      method: 'DELETE',
      write: true,
    });
  },

  /** 把票加入分组（已在组内则只更新组内备注）。 */
  addStockToGroup(id: number, code: string, note?: string | null): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/api/groups/${id}/stocks`, {
      method: 'POST',
      body: { code, note: note ?? null },
      write: true,
    });
  },

  /** 把票移出分组。 */
  removeStockFromGroup(id: number, code: string): Promise<{ removed: boolean }> {
    return request<{ removed: boolean }>(`/api/groups/${id}/stocks/${encodeURIComponent(code)}`, {
      method: 'DELETE',
      write: true,
    });
  },

  /** 新增评论 / 备忘。 */
  createNote(input: NoteInput): Promise<StockNote> {
    return request<StockNote>('/api/notes', { method: 'POST', body: input, write: true });
  },

  /** 更新评论 / 备忘。 */
  updateNote(id: number, patch: NotePatch): Promise<StockNote> {
    return request<StockNote>(`/api/notes/${id}`, { method: 'PUT', body: patch, write: true });
  },

  /** 删除评论 / 备忘。 */
  deleteNote(id: number): Promise<{ removed: boolean }> {
    return request<{ removed: boolean }>(`/api/notes/${id}`, { method: 'DELETE', write: true });
  },
};
