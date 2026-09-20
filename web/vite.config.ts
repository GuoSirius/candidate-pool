import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// 前端（Pages 独立源）调用 Cloudflare Worker API：
//   - 本地开发：Vite 把 /api 代理到 wrangler dev（默认 :8787），无需跨域。
//   - 生产构建：通过 VITE_API_BASE 指定 Worker 地址（如 https://candidate-pool-api.<sub>.workers.dev）。
//     未设置时退化为同源 /api（适用于 Worker 同时托管前端静态资源的部署方式）。
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '次日候选池',
        short_name: '候选池',
        description: 'A股次日候选筛选与复盘',
        // 与 index.html 的 theme-color 一致：standalone 启动画面 / 状态栏跟随深色底，
        // 否则会出现白底闪一下再变深色的割裂感。
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
