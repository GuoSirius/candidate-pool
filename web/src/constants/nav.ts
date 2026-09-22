/*
 * 全站导航的唯一事实来源。
 *
 * 为什么要有这个文件：
 *   此前导航写死在 App.vue 里，是「一行扁平链接」。每加一个页面就要改顶栏，
 *   且桌面 / 移动 / 抽屉三处呈现方式不同却只能共用同一行，导致手机上折行、挤成一团。
 *   现在把「有哪些页面、怎么分组、进不进底栏、上没上线」集中成数据，
 *   三处渲染（桌面左栏 / 移动底栏 / 移动端更多抽屉）都读这一份。
 *
 * 新增一个页面 = 在下面的 NAV_GROUPS 里加一条，不需要动任何组件。
 *   - inTabbar: true  → 同时出现在手机底栏（底栏最多 3 个，其余走「更多」抽屉）
 *   - soon: true      → 尚未上线，渲染成不可点击 + 「待上线」标记，先把位置占住
 */

import type { IconName } from '../components/NavIcon.vue';

export interface NavItem {
  /** 稳定标识，用于 key 与状态记忆 */
  key: string;
  /** 完整名称（桌面左栏 / 抽屉用） */
  label: string;
  /** 底栏短名（手机底栏空间小，≤4 字） */
  tabLabel?: string;
  /** 路由路径 */
  to: string;
  icon: IconName;
  /** 是否出现在手机底栏 */
  inTabbar?: boolean;
  /** 尚未上线：不可点击，仅占位并提示 */
  soon?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'eod',
    label: '盘后选股',
    items: [
      { key: 'runs', label: '候选列表', tabLabel: '候选', to: '/', icon: 'list', inTabbar: true },
      { key: 'stocks', label: '全部标的', tabLabel: '标的', to: '/stocks', icon: 'grid', inTabbar: true },
      { key: 'stats', label: '复盘统计', tabLabel: '统计', to: '/stats', icon: 'chart', inTabbar: true },
      { key: 'reports', label: '报告查看', to: '/reports', icon: 'doc' },
    ],
  },
  {
    key: 'tail',
    label: '盘中选股',
    items: [
      { key: 'tail', label: '尾盘候选', to: '/tail', icon: 'clock' },
      { key: 'tail-history', label: '尾盘记录', to: '/tail/history', icon: 'history' },
      { key: 'tail-review', label: '尾盘复盘', to: '/tail/review', icon: 'target' },
      { key: 'tail-reports', label: '报告查看', to: '/tail/reports', icon: 'doc' },
      { key: 'tail-diff', label: '口径对照', to: '/tail/diff', icon: 'diff' },
    ],
  },
  {
    key: 'mine',
    label: '我的',
    items: [
      { key: 'mine', label: '分组与备注', to: '/mine', icon: 'tag' },
    ],
  },
  {
    key: 'ref',
    label: '参考',
    items: [
      { key: 'rules', label: '规则释义', to: '/rules', icon: 'book' },
    ],
  },
];

/** 手机底栏项（固定为 inTabbar 的项，末尾由 AppShell 追加「更多」） */
export const TABBAR_ITEMS: NavItem[] = NAV_GROUPS
  .flatMap((g) => g.items)
  .filter((i) => i.inTabbar);

/** 所有已上线（可点击）的项，供返回文案等复用 */
export const LIVE_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items).filter((i) => !i.soon);

/**
 * 按路径找导航项。
 * 「个股详情」这类不在导航里的页面会返回 null，由调用方给出兜底文案。
 */
export function findNavItem(path: string): NavItem | null {
  const exact = LIVE_ITEMS.find((i) => i.to === path);
  if (exact) return exact;
  // 子路由（如 /tail/history）归到其前缀所属项
  const prefix = LIVE_ITEMS
    .filter((i) => i.to !== '/' && path.startsWith(i.to + '/'))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return prefix ?? null;
}

/** 当前参与高亮判定的路径：个股详情页回落到 `?from=` 的来源路径。 */
function navMatchPath(path: string, from: string): string {
  if (path.startsWith('/stock/') && from) return from.split('?')[0];
  return path;
}

/**
 * 当前**唯一**应当高亮的导航项（不在导航里的页面 → null）。
 *
 * 为什么必须收敛成「唯一」：NAV_GROUPS 里存在父子关系的项（如 `/tail` 与 `/tail/history`）。
 * 若按「path 以 item.to 开头即高亮」判断，站在 `/tail/history` 时 `/tail` 也会命中 →
 * **两个菜单项同时点亮**（2026-09-21 用户截图反馈「左侧菜单同时高亮了多个」）。
 * 这里复用 findNavItem 的「精确优先、其次最长前缀」规则先算出唯一归属项，
 * 再让各项与它比对 key —— 从结构上排除「多个同时高亮」，以后再加子路由也不会复发。
 */
export function activeNavItem(path: string, from: string): NavItem | null {
  return findNavItem(navMatchPath(path, from));
}

/**
 * 判断某个导航项当前是否高亮。
 *
 * 个股详情页 `/stock/:code` 不在导航里，但它一定是从某个列表点进来的，
 * 该来源路径挂在 `?from=` 上。因此详情页高亮「来路的那个列表项」——
 * 这样用户在详情页也不会失去「我在哪」的位置感（此前这里是完全无高亮的）。
 */
export function isNavActive(item: NavItem, path: string, from: string): boolean {
  const active = activeNavItem(path, from);
  return active !== null && active.key === item.key;
}
