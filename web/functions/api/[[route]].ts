// Pages Functions 文件路由：/api/* 的全部请求交给共享的 Hono 应用处理。
//
// Hono app 内部的路由本身就带 /api 前缀（见 worker/src/index.ts），
// 因此这里不需要再 basePath('/api')，直接转发即可。
//
// 注意：不要在此文件中 import hono —— web/ 未安装 hono，靠 worker/node_modules 解析；
// 跨目录引用统一收敛到 worker/src/pages.ts，避免 esbuild 从 web/ 侧解析不到依赖。
export { onRequest } from '../../../worker/src/pages.js';
