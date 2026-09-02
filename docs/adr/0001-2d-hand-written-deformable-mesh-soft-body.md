# 柔體是 2D 手寫可變形網格：shape-matching 脊椎 + XPBD 細節層

Jelly 以**一張連續三角網格、頂點即 Particle** 的方式模擬，求解器完全手寫、不依賴任何物理引擎。骨幹是 **region-based shape matching**（重疊方格 lattice），上面疊一層 **XPBD 的 distance + signed-area 約束** 補局部拉伸擠壓細節並作第二道防翻面。實作順序：先把 shape-matching 脊椎做起來，再疊 XPBD。視角為俯視、無重力。

## 為什麼

前一個專案（「拖曳匯入的圖片專案」）用「Voronoi 碎片各自是剛體、碎片間用釘在質心的可斷裂彈簧連著」試了三輪，記錄在 `../research/`（該專案）的復盤文件。失敗根因是**架構**而非參數：點對點彈簧接剛體質心導致**力矩恆為零**、管不住單片旋轉；力傳遞逐格導致大網格延遲塌陷；Matter.js `Body.setVertices` 強制把頂點置中到質心。連續網格 + shape matching 直接消掉前兩者，手寫求解器消掉第三者。研究筆記 `../research/soft-body-2d-jelly.md` 佐證：shape matching「不受 ill-shaped 或 inverted 元素影響」「無條件穩定」，且質心是方法內建量——正好對上「Pin 質心、抓一角拉到極限、觀察穩定態」這個核心需求。

## Considered Options

- **3D 模擬四面體網格再壓成 2D 顯示**：沒有 prior-art 支持；四面體有自身的 inversion 問題（Irving–Teran–Fedkiw），等於把要避開的問題以更貴形式帶回，還多出 3×3 SVD、數倍元素數、底面自碰撞。
- **沿用現成物理引擎的柔體支援**：Matter.js `Composites.softBody` 是「一堆小圓 + 硬約束」、已 deprecated 且 `setVertices` 置中是上個專案的根因之一；Rapier／planck／cannon 只有剛體，柔體仍得自寫；ammo／Jolt 給的是 3D 柔體連四面體 inversion 一起。沒有一個能開箱滿足「2D、貼圖跟隨、Pin 質心、Multi-grab、可換 Boundary」。
- **剛體碎片 + 質心彈簧**：上個專案已記錄的失敗路徑，不重走。

## Consequences

- 求解器、碰撞、Boundary 全部自己寫並自己維護（範圍不大：Boundary 是幾條半平面或無，求解器數學很短）。
- v1 若 hybrid 太磨，可先只出純 shape matching；XPBD 細節層是加法、之後補。
- 固定時間步、掉幀穩定、行為可重現這些要求由手寫求解器直接保證。
