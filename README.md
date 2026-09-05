# 果凍圖片沙盒（jelly-image-sandbox）

物理模擬的網頁沙盒小遊戲：匯入一張帶 alpha 的 PNG，不透明區域變成一塊桌上的「果凍」，可以抓住一角拖曳、甩動、輕拍、釘選。最終發佈為 itch.io 靜態包。

產品構想與設計限制見 [CLAUDE.md](./CLAUDE.md)；決策脈絡見 [`docs/adr/`](./docs/adr/)、[`docs/design/simulation-and-mesh.md`](./docs/design/simulation-and-mesh.md)；詞彙見 [CONTEXT.md](./CONTEXT.md)。

## 開發

需要 Node 20.19+ 或 22.12+（Vite 7 要求；本機用 Node 24）。

```sh
npm install       # 安裝依賴
npm run dev       # Vite 開發伺服器（目前是空白掛載頁）
npm run build     # 型別檢查 + 產出 dist/（自包含靜態包，可用 file:// 開）
npm run preview   # 本機預覽 dist/
npm test          # Vitest 一次性跑
npm run test:watch
npm run typecheck # tsc --noEmit（strict）
npm run format    # Prettier 寫回
```

## 發佈

`npm run build` 產出的 `dist/` 是自包含的：`index.html` 用相對路徑載入資源，直接以 `file://` 開啟即可執行，不需要伺服器。

用 [butler](https://itch.io/docs/butler/) 上架／更新 itch.io 頁面：

```sh
bash scripts/publish-itch.sh   # 第一次會帶你走完整流程；之後重跑會沿用 .env 裡存的設定
```

首次設定（專案 slug、butler channel）之後存在 `.env`（不進版控）；之後每次發新版本，重跑同一支腳本即可，或直接 `npm run build && butler push dist <ITCH_TARGET>`（`ITCH_TARGET` 見 `.env`）。
