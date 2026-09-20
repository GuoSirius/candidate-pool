// 表格「点列头排序」的共用状态与比较逻辑。
//
// 为什么抽出来：个股「入选记录」、全部标的汇总、复盘「锚定日明细」三张表需求完全一致，
// 各写一份很快就会在**空值处理**上分叉——而 N 周期恰恰是「大量单元格没有数据」的表格。
//
// 空值（null / undefined / 空串）恒排最后**且不随升降序翻转**，这是本项目统一约定：
// 若跟着方向翻转，升序时一整屏「暂无数据」的行会被顶到最前面，反而看不到有效样本。
import { ref, type Ref } from 'vue';

export type SortDir = 'asc' | 'desc';
/** 单元格参与比较的取值类型：数字列、字符串列、以及「没数据」的三种空表示。 */
export type SortValue = number | string | null | undefined;

interface ColumnSortOptions<K extends string> {
  /**
   * 初始排序列。传 `null` 表示「保持数据源给的默认顺序」——
   * 适用于后端已经排好序、且那个顺序有业务含义的场景（如候选池的「档位分组 + R01 涨幅降序」）。
   */
  initialKey: K | null;
  initialDir?: SortDir;
  /** 数值列：按大小比较，且「换到该列」时默认降序；未列出的按字符串比较、默认升序 */
  numericKeys?: readonly K[];
  /** 覆盖某列的默认方向，例如时间列希望「近 → 远」（降序） */
  dirFor?: (key: K) => SortDir | undefined;
}

export function useColumnSort<K extends string>(opts: ColumnSortOptions<K>) {
  const numeric = new Set<string>(opts.numericKeys ?? []);
  const sortKey = ref(opts.initialKey) as Ref<K | null>;
  const sortDir = ref<SortDir>(opts.initialDir ?? 'desc');

  /** 换到某列时的默认方向：显式指定 > 数值列降序 > 其余升序。 */
  function defaultDirFor(key: K): SortDir {
    return opts.dirFor?.(key) ?? (numeric.has(key) ? 'desc' : 'asc');
  }

  /** 点列头：同一列翻转方向；换列则按该列默认方向起步。 */
  function toggle(key: K): void {
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc';
      return;
    }
    sortKey.value = key;
    sortDir.value = defaultDirFor(key);
  }

  /** 回到数据源默认顺序（清空排序）。 */
  function clearSort(): void {
    sortKey.value = null;
  }

  /** 按当前列排序，返回新数组（不改动入参）。未选列时原样返回。取值方式由调用方通过 get 注入。 */
  function sortRows<T>(rows: readonly T[], get: (row: T, key: K) => SortValue): T[] {
    const key = sortKey.value;
    if (!key) return [...rows];
    const dir = sortDir.value === 'asc' ? 1 : -1;
    const isNumeric = numeric.has(key);
    return [...rows].sort((a, b) => {
      const av = get(a, key);
      const bv = get(b, key);
      const aEmpty = av === null || av === undefined || av === '';
      const bEmpty = bv === null || bv === undefined || bv === '';
      if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
      if (isNumeric) return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  return { sortKey, sortDir, toggle, clearSort, sortRows, defaultDirFor };
}
