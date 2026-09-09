import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // itch.io 靜態包：把 JS/CSS 全部內聯進單一 index.html，
  // 這樣直接用 file:// 開也不會踩到瀏覽器對 module script 的 CORS 限制。
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // Mesh pipeline 的測試（buildSimMesh / refine）跑真正的 CDT + Ruppert 細化，
    // 單一 case 可達 1–2 秒；在 CPU 吃緊的機器上，vitest 平行 worker 的競用會把
    // 預設 5 秒 timeout 逼到偶發誤判。放寬到 20 秒（實際跑完仍遠低於此）。
    testTimeout: 20000,
  },
});
