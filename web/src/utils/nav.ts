// 列表 ↔ 详情的导航约定（全站统一，避免各页各写一套）。
//
// 问题：详情页原先写死 `to="/"`，无论从哪个列表点进来都回「候选列表」。
// 做法：进入详情时把「来路完整路径」挂到 `?from=`（含查询串），返回时按原路回；
//       来源页自身再用 sessionStorage 记住筛选 / 页码 / 滚动位置，于是「从哪来、回哪去，状态不丢」。
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';

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

/** 返回按钮文案：让用户提前知道会回到哪一页（整串直接用，模板里不再补「返回」二字）。 */
export function backLabelOf(route: RouteLocationNormalizedLoaded): string {
  const from = typeof route.query.from === 'string' ? route.query.from : '';
  if (from === '/' || from.startsWith('/?')) return '返回候选列表';
  if (from.startsWith('/stocks')) return '返回全部标的';
  if (from.startsWith('/stats')) return '返回复盘统计';
  if (from.startsWith('/rules')) return '返回规则释义';
  return '返回上一页';
}
