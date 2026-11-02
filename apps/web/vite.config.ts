import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// /api 代理到本地面板后端；SSE 与长轮询依赖 proxy 的默认行为即可
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@yatori/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 图表运行时单独成块：只在观测台加载，避免与主框架代码一起失效缓存
        manualChunks(id) {
          if (id.includes("node_modules/echarts") || id.includes("node_modules/zrender") || id.includes("node_modules/vue-echarts")) {
            return "charts";
          }
        },
      },
    },
  },
});
