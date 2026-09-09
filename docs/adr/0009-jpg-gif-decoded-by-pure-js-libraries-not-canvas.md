# jpg / gif 匯入用純 JS 解碼函式庫，不走瀏覽器 canvas

匯入接受 png / jpeg / gif（見 issue #53 / #55）。三種格式的 **alpha 平面**都由純 JS 函式庫在 mesh pipeline 內解碼：PNG → `fast-png`（MIT，既有）、JPEG → `jpeg-js`（BSD-3-Clause）、GIF → `omggif`（MIT）。（issue #55 內文誤記 `jpeg-js` 為 MIT，實際是 BSD-3-Clause——同屬寬鬆授權，可自由散布進 itch.io 靜態包，不在 CLAUDE.md 禁用清單所針對的 GPL／AGPL／付費商業散布之列。）`src/mesh/decodeImage.ts` 的新對外函式 `decodeImageAlpha(imageBytes)` 嗅探 magic bytes（`89 50 4E 47` / `FF D8 FF` / `47 49 46 38`）分派；未知 magic 丟既有的 `MeshPipelineError`，呼叫端沿用「`console.warn` 後安靜略過、不動現有果凍」。

**不**用瀏覽器 canvas（`createImageBitmap` / `<img>` + `drawImage` + `getImageData`）取 alpha。

貼圖（GPU 端）仍走瀏覽器原生 `<img>`，Blob 的 MIME 依實際格式給；動畫 GIF 由瀏覽器取第一幀當靜圖，與 mesh 端 `decodeGifAlpha` 只取第一幀一致。

## 為什麼

mesh pipeline 的核心性質是「純函式、決定性、可在 vitest 無頭重現」（ADR-0002 / ADR-0005：種子 = hash(降採樣 mask + 參數)）。canvas 解碼會把這條性質打破：

- **無頭不可測**：`OffscreenCanvas` / `createImageBitmap` 在 Node/vitest（jsdom）沒有實作，得引入 `canvas` 原生模組或 headless GPU，違反「控制依賴數量與包體大小」（發佈約束）且拖慢 CI。
- **決定性只同機成立**：canvas 的 JPEG 解碼、色彩管理、down-sampling 由瀏覽器實作決定，跨瀏覽器／跨 OS 逐位元不一致。ADR-0006 已聲明 v2 不追求跨機器 bit 一致，但「同一份輸入在 CI 與開發機得到同一個 mask」是現在測試就靠的東西，不想放掉。

純 JS 函式庫兩者都給：`jpeg-js` / `omggif` 是固定演算法，同輸入同輸出，Node 與瀏覽器一致，可在單元測試裡直接餵位元組斷言 alpha 平面。

## Considered Options

- **瀏覽器 canvas 取 alpha**：零新增解碼相依，且 `<img>` 順帶支援 webp/avif（未來想加其他格式免錢）。但無頭不可測、逐位元決定性只同機成立，且要嘛引入 `canvas` 原生模組、要嘛整條 pipeline 測試改成需要真瀏覽器 —— 否決。
- **只加 jpeg、gif 留待日後**：手邊素材 jpg 多、gif 也常見（issue #53 動機），一起做的邊際成本只是多一個小函式庫 + 一條分派分支。
- **動畫 GIF 逐幀 / 當動態貼圖**：超出「把圖變成一塊果凍」的範圍，只取第一幀（見 issue #55 Out of Scope）。

## Consequences

- `dependencies` 新增 `jpeg-js`（BSD-3-Clause）、`omggif`（MIT）——皆純 JS、體積小、無 canvas 相依。`omggif` 無自帶型別，最小簽章補在 `src/mesh/vendor.d.ts`；`jpeg-js` 自帶 `index.d.ts`。
- `MeshPipelineError` 從 `buildSimMesh.ts` 移到 `src/mesh/errors.ts`（`buildSimMesh` 仍 re-export，對外介面不變），避免 `buildSimMesh` ↔ `decodeImage` 互相 import。
- webp / avif / bmp / svg 等其他格式**仍不支援**：magic 不符 → `MeshPipelineError` → 沿用現有「警告後忽略」。日後要加，得評估對應的純 JS 解碼函式庫，或重新檢視本 ADR。
- JPEG 沒有 alpha → 整張矩形變一塊果凍；GIF 取第一幀（含透明索引 → 挖空透明區）。這是預期行為，不是缺陷。
