// 展示格式化工具。A股惯例：涨=红，跌=绿。

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 百分比：带正负号；空值显示占位符。 */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

/** 市值/成交额（假定入库单位为「元」）：>=1e8 显示亿，否则显示万。 */
export function fmtCap(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return fmtNum(v, 0);
}

/**
 * 尾盘口径标签：formal=正式 / observe=观察。
 * 未知值**原样显示**，不要再用 `else` 兜底成「观察」—— 2026-09-21 就是这么把
 * 库里遗留的 `cut` 全部显示成「观察」的，界面看着正常、其实是错的。
 */
export function tailModeLabel(m: string | null | undefined): string {
  if (m === 'formal') return '正式';
  if (m === 'observe') return '观察';
  if (m === 'intraday') return '盘中';
  return m ? String(m) : '—';
}

/** 收益率着色类：红涨绿跌。 */
export function perfClass(v: number | null | undefined): 'up' | 'down' | 'flat' | 'muted' {
  if (v === null || v === undefined || Number.isNaN(v)) return 'muted';
  if (v > 0) return 'up';
  if (v < 0) return 'down';
  return 'flat';
}
