// 列表 ↔ 详情的导航约定（全站统一，避免各页各写一套）。
//
// 问题：详情页原先写死 `to="/"`，无论从哪个列表点进来都回「候选列表」。
// 做法：进入详情时把「来路完整路径」挂到 `?from=`（含查询串），返回时按原路回；
//       来源页自身再用 sessionStorage 记住筛选 / 页码 / 滚动位置，于是「从哪来、回哪去，状态不丢」。
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';
import { findNavItem } from '../constants/nav';

/** 打开个股详情，并带上来源完整路径（如 `/` 或 `/stocks?sort=picks`）。 */
export function openStock(router: Router, route: RouteLocationNormalizedLoaded, code: string): void {
  router.push({ path: `/stock/${code}`, query: { from: route.fullPath } });
}

/** 详情页「返回」：优先回来源路径；无来源时退浏览器上一页；再不行回候选列表。 */
export function goBack(router: Router, route: RouteLocationNormalizedLoaded, fallback = '/'): void {
  const from = typeof route.query.from === 'string' ? route.query.from : '';
  // 只接受站内绝对路径，且排除 `//host` 协议相对写法，避免被构造成外站跳转
  if (from.startsWith('/') && !from.startsWith('//')) {
    router.push(from);
    return;
  }
  if (window.history.length > 1) {
    router.back();
    return;
  }
  router.push(fallback);
}

/**
 * 返回按钮文案：让用户提前知道会回到哪一页（整串直接用，模板里不再补「返回」二字）。
 * 由 constants/nav.ts 反查来源页名称 —— 此前是「写死 4 个路径的 if 链」，
 * 每加一个页面都要回来补一条；现在新增页面自动生效。
 */
export function backLabelOf(route: RouteLocationNormalizedLoaded): string {
  const from = typeof route.query.from === 'string' ? route.query.from : '';
  if (from) {
    const fromPath = from.split('?')[0];
    const item = findNavItem(fromPath);
    if (item) return `返回${item.label}`;
  }
  return '返回上一页';
}
