# 三角化用 cdt2d + 手刻 Ruppert 品質細化

Sim mesh 的三角化用 `cdt2d`（MIT）做 constrained Delaunay 底層，內部撒 jittered grid／blue-noise Steiner points，並**自己實作 Ruppert 式品質細化**（最小角 + 最大面積準則，插 circumcenter，對 constrained／boundary segment 的 encroachment 改分裂中點）。低於門檻的 sliver 三角形在細化後丟棄或合併。

## 為什麼

最終產物是要散布的靜態網站包，可能是**付費** itch.io 遊戲。品質網格生成的黃金標準 Shewchuk **Triangle** 授權明文禁止「收取報酬」與「作為商業系統散布（須與作者直接商議）」，其 Emscripten port 的 MIT 標籤不能解除底層限制；**JIGSAW** 授權字句相同；**CGAL Mesh_2** 是 GPL-3.0（會傳染整個遊戲）或需付費商業授權。唯一寬鬆授權又有真正 Steiner-point 品質細化的是 Rust 的 `spade`（MIT/Apache），但沒有現成 wasm build。純 JS 的 `cdt2d`／`poly2tri.js` 只做 CDT、不做自動品質細化。Ruppert 演算法文獻完整、約數百行，encroachment 處理是唯一磨人的地方。查證細節見 `../research/soft-body-2d-jelly.md` 第 5 節與授權調查。

## Considered Options

- **Shewchuk Triangle（或其 wasm port）／JIGSAW**：功能最合適，但授權不相容於付費散布。
- **CGAL Mesh_2 via wasm**：GPL 或付費，皆不採。
- **spade → wasm**：授權乾淨、有保證的細化，但多一套 Rust toolchain 與 wasm blob。**列為升級路徑**：若手刻細化實測不夠穩、或 XPBD signed-area 需要更嚴格的三角形品質，再切換。
- **poly2tri.js（BSD-3）當底**：與 cdt2d 同級，選 cdt2d 因 MIT 更單純且 `mikolalysenko/cdt2d` 的 PSLG 介面直接。

## Consequences

- 品質細化這段是我們自己的程式碼，要自己測收斂與終止。
- 若之後改用 spade，Sim mesh 生成是一個定義清楚的模組邊界（Contour + 內部點 → 三角形 + 拓撲），替換面積可控。
