// Cloudflare Pages Functions 入口。
//
// 为什么要这一层：前端 Pages 项目（candidate-pool-web）通过 functions/api/[[route]].ts
// 承载同一套 API，从而与静态资源**同源**部署（免 CORS、免跨域地址配置）。
// 本文件只做「Hono app → Pages onRequest 签名」的适配，业务逻辑仍然只有 worker/src 一份，
// 与 Worker 版（src/index.ts）完全共用，不存在两套实现。
import { handle } from 'hono/cloudflare-pages';
import app from './index.js';

export const onRequest = handle(app);
