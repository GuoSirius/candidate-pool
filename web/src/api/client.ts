import type {
  ApiEnvelope,
  RunBatch,
  PickRecord,
  StockHistory,
  StockBase,
  WatchGroup,
  Tier,
  StatsResult,
  StockRankRow,
} from './types';

// VITE_API_BASE 为空时退化为同源 /api（本地由 Vite 代理到 worker :8787）。
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

/** 业务码：200 成功；10001 通用；10002 资源不存在；10003 参数错误；10004 内部错误。 */
export const BizCode = {
  OK: 200,
  ERR_GENERIC: 10001,
  ERR_NOT_FOUND: 10002,
  ERR_INVALID_PARAM: 10003,
  ERR_INTERNAL: 10004,
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

async function request<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url(path), { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new ApiError(BizCode.ERR_INTERNAL, `网络请求失败：${(e as Error).message}`);
  }

  // 仅传输/网关层异常（如未捕获异常）才会返回非 200。
  if (res.status !== 200) {
    throw new ApiError(BizCode.ERR_INTERNAL, `服务异常（HTTP ${res.status}）`);
  }

  const body = (await res.json()) as ApiEnvelope<T>;
  // 业务错误：HTTP 仍为 200，由 code 区分。
  if (body.code !== BizCode.OK) {
    throw new ApiError(body.code, body.message || '请求失败');
  }
  return body.data as T;
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
};
