// 健康检查：与 Worker 版同源同实现（Hono app 的 GET /health）。
// 便于部署后直接 curl https://<project>.pages.dev/health 验证。
export { onRequest } from '../../worker/src/pages.js';
