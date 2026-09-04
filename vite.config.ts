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
  },
});
