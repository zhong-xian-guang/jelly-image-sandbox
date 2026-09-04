# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

（使用者偏好以中文溝通，回應與文件請使用繁體中文。）

## 目前狀態

截至 2026-09-04：技術棧與物理／網格架構已定案（見下方「技術棧」與 `docs/adr/`）。專案骨架（Vite + TypeScript + Vitest，Issue #2 / T1）已建立——`npm run dev` / `build` / `test` 可用，實際指令見下方「技術棧」節。**Mesh pipeline（Issue #3 / T2 + Issue #4 / T3）已完成**：`src/mesh/` 提供純函式、決定性的 `buildSimMesh(pngBytes, params) → SimMesh`（PNG 解碼 → alpha 降採樣二值化 → 最大連通元件 → 手刻 marching squares → `simplify-js` → 有種子 PRNG 撒內部點 → `cdt2d` constrained Delaunay → 自寫 Ruppert 品質細化（`refine.ts`：壞三角形補外心、encroach 到 constrained segment 改分裂中點、批次重跑 `cdt2d`）→ 粗 sliver 清理 → UV → 凍結拓撲）。模擬核心、算繪、App shell 等模組尚未動工（見 Issue #5 起）。本檔記錄產品構想與設計限制。

## 產品概念

一個物理模擬的網頁沙盒小遊戲，最終以靜態網站包（static bundle）形式發佈到 itch.io。

核心流程：

1. 使用者匯入一張帶 alpha 的 PNG。
2. 圖片不透明的區域被轉成一個柔體物件（下稱「果凍」），放在畫面中央，像是擺在一張虛擬桌子上。
3. 使用者抓住果凍上的某一點（通常是一角），可以進行**拖曳**、**甩動**、**放開**——果凍會被拉伸、晃動並回彈。快速按一下即放開（不拖曳）＝在該處**輕拍**，果凍凹一下再彈回。

手感目標：像是桌上一塊果凍，抓住一角拉扯、甩動、放手後看它慢慢穩定下來。

## 必備的沙盒功能

這四項是專案存在的理由，任何架構決策都必須讓它們容易實作：

- **釘選（Pin）** — 把果凍表面上任意一點絕對鎖定在原地，數量不限（見 `docs/adr/0004`）。用力甩、輕拍都拔不掉，可拖到新位置重新鎖定。在一角或幾處放 Pin、再拉另一角，就能觀察物體被拉到極限的穩定狀態。（沒有「鎖定質心」的獨立模式——要固定中心就在附近多放幾個 Pin。）
- **多重抓取模式** — 同時存在多個抓取點（多點觸控或多個指標），各自獨立拉動，讓使用者能扭曲、擰轉物體。Pin 與 Grab 天然共存。
- **邊界模式** — 兩種桌面：
  - *有牆*：有限大小的桌面，牆壁會擋住果凍。
  - *無限*：桌面無限延伸。
- **相機跟隨** — 視角動態平移／縮放，讓果凍持續留在畫面內，尤其是在無限模式下、以及甩動把果凍拋到離原點很遠時。使用者可手動平移／縮放（暫時覆蓋、閒置後回歸），或用「鎖定跟隨」開關完全關閉自動跟隨。

**規劃中（v2）**：素材工具——錄製多段獨立操作（各為一條 Track）+ 相機操作，各設起始時間、疊加播放，產生效果片段（見 `docs/adr/0005`）。v1 不做工具本身，但要先鋪好「決定性模擬 + 可攔截的輸入介面」。

## 技術棧

`/grill-with-docs`（2026-09-02）定案，`/prototype` 修正若干細節（2026-09-03），第二輪 `/grill-with-docs`（2026-09-04）釐清 Pin／相機／素材工具需求。脈絡見 `docs/adr/0001`–`0005`、`docs/research/soft-body-2d-jelly.md`；管線與參數見 `docs/design/simulation-and-mesh.md`；詞彙見 `CONTEXT.md`。

- **建置／語言** — Vite + TypeScript。輸出為靜態包，直接打包 itch.io zip。
- **柔體物理方法** — 完全手寫的 2D 求解器，**不用物理引擎**。骨幹 = region-based shape matching（重疊方格 lattice）；細節層 = XPBD 的 distance + signed-area 約束。俯視、無重力。固定 60 Hz 幀、每幀 4 substep。
- **網格生成** — PNG 解碼用 `fast-png`（MIT，純 JS、免 canvas，測試可決定性重現）→ 手刻 marching squares 描 Contour → `simplify-js`（BSD-2-Clause）→ `cdt2d`（MIT）CDT + 手刻 Ruppert 細化。**不可**用 Shewchuk Triangle／JIGSAW（禁付費商業散布）、CGAL Mesh_2（GPL）、`MarchingSquares.js`（AGPL）。
- **算繪** — WebGL 每頂點 UV 三角網格（PixiJS `Mesh` 或自寫 shader）。不用 Canvas 2D 逐三角 `drawImage`。

指令（骨架見 `package.json`）：

- `npm run dev` — Vite 開發伺服器（目前是空白掛載頁）。
- `npm run build` — 先 `tsc --noEmit`（strict）再 `vite build`，產出自包含的 `dist/index.html`（JS/CSS 全部內聯，可直接用 `file://` 開，避開瀏覽器對 module script 的 CORS 限制）。
- `npm run preview` — 本機預覽 `dist/`。
- `npm test` — Vitest 一次性跑；`npm run test:watch` 為 watch 模式。
- `npm run typecheck` — 只做 `tsc --noEmit`。
- `npm run format` / `npm run format:check` — Prettier。

沒有 lint 步驟（`tsc` strict + Prettier 已涵蓋）。發佈：把 `dist/` 打包成 zip 上傳 itch.io。

## 給第一位實作者的架構筆記

模組邊界與初始參數見 `docs/design/simulation-and-mesh.md`。以下模組會存在，值得從一開始就分開設計：

- **圖片 → 物件匯入**：解碼 PNG、取出 alpha 遮罩、產生模擬網格（頂點網格或裁切到不透明區域的三角化），並指定貼圖 UV，讓算繪端能把原圖貼到變形後的網格上。非矩形、甚至不連通的 alpha 區域是實際會遇到的情況。
- **模擬核心**：推進柔體。必須提供 (a) 在任意**表面點**（三角形 + 重心座標，見 `docs/adr/0003`）附加／移除抓取軟約束、(b) 對質心的全域釘選約束、(c) 可替換的邊界（有牆 vs. 無）。保持與算繪端無關，並採用固定時間步（fixed timestep），讓行為可重現、且在掉幀時仍穩定。
- **輸入層**：指標／觸控 → 世界座標挑選（picking，命中哪個三角形 + 重心座標）。每個指標判定為 **Grab**（拖曳 → 抓取軟約束）或 **Tap**（快速按放 → 對該處施加一次性向內徑向脈衝）。多重抓取代表這裡是一組作用中的抓取，而非單一。甩動不需另外算：被抓的頂點本身帶著拖曳速度，放開即是。細節見 `docs/design/simulation-and-mesh.md`「輸入手勢」。
- **相機**：由物體的邊界框／質心驅動的世界→螢幕轉換，帶平滑與 zoom-to-fit。所有繪製與挑選都要經過它。
- **邊界**：由模擬核心使用的可替換碰撞環境。

## 發佈

最終產物是一個自包含的靜態網站包（HTML/JS/CSS + 資源），打包成 zip 上傳 itch.io，從 `index.html` 直接執行、不需要伺服器。控制依賴數量與包體大小，避免任何需要後端的東西。

## Agent skills

### Issue tracker

Issue 與 spec 追蹤在 GitHub Issues（`zhong-xian-guang/jelly-image-sandbox`），透過 `gh` CLI 操作。詳見 `docs/agents/issue-tracker.md`。

### Triage labels

沿用五個標準分流角色，標籤字串等於名稱：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。詳見 `docs/agents/triage-labels.md`。

### Domain docs

單一 context：根目錄一份 `CONTEXT.md` + `docs/adr/`。詳見 `docs/agents/domain.md`。
