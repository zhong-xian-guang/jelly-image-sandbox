# 模擬與網格：管線與參數

非 ADR。記錄「怎麼做」與初始參數，供實作接手。決策脈絡見 [ADR-0001](../adr/0001-2d-hand-written-deformable-mesh-soft-body.md)、[ADR-0002](../adr/0002-triangulation-via-cdt2d-and-hand-rolled-ruppert.md)、[ADR-0003](../adr/0003-grab-attaches-at-a-barycentric-surface-point.md) 與 [研究筆記](../research/soft-body-2d-jelly.md)。詞彙見 [CONTEXT.md](../../CONTEXT.md)。

## 情境前提

- **俯視、無重力。** Jelly 靜置即靜止；Fling 給初速，靠阻尼收斂。
- 桌上永遠一塊 Jelly。Multi-grab 是同一塊上的多個 Grab。
- 目標裝置：2020 後中階手機 60fps；更弱裝置降 substep。

## 匯入 → 網格管線

1. **解碼**：v1 只接 PNG。WebP／APNG 之後再加，解碼路徑相同。
2. **Alpha mask**：取 alpha 通道二值化（threshold 0.5）。**降採樣到最長邊 ≤ 1024px** 再往下，把網格成本與來源圖解析度脫鉤。貼圖本身維持全解析度上 GPU。
3. **最大連通元件**：v1 只保留最大的不透明連通元件，其餘丟棄。連通元件內的洞（甜甜圈）保留，作為三角化的 hole。
4. **描 Contour**：手刻 marching squares，alpha 當 scalar field。輸出封閉多邊形路徑（外環 + 洞環）。
5. **簡化**：`simplify-js`（MIT）Douglas–Peucker。初始容差：mask 像素座標下 `1.5`px，之後調。
6. **三角化**：`cdt2d`（MIT）做 constrained Delaunay，約束邊 = 簡化後的 Contour 邊。
7. **內部點**：在 Contour 內撒 jittered grid（或 blue-noise）當 Steiner points 一併餵入。初始間距：讓整塊 Jelly 約 200–500 個 Particle。**抖動用有種子的 PRNG**（種子 = hash(降採樣後 alpha mask 位元組 + 所有網格參數)），同一張圖 + 同參數永遠得到同一個 Sim mesh（見 [ADR-0005](../adr/0005-v1-keeps-sim-deterministic-and-input-recordable.md)）。整個管線不得用 `Math.random` 或 wall-clock。
8. **Ruppert 品質細化**（自寫，見 ADR-0002）：最小角下界初始 `25°`、最大面積上界對應上一步的目標間距；circumcenter 插點；constrained／boundary segment 遇 encroachment 改分裂中點。
9. **Sliver 清理**：細化後仍面積 `< ε_area` 或最小角 `< 15°` 的三角形，丟棄或與鄰邊合併（保護 signed-area 約束的梯度）。
10. **指定 UV**：每個頂點 UV = 它在原圖的正規化座標。
11. **凍結拓撲**：之後模擬只更新頂點位置，`indices` 與 `uv` 不變。

v1 Sim mesh 與 Texture mesh 為同一張。若貼圖出現明顯折面感，升級為「粗 Sim mesh + 細 Texture mesh，重心座標 skin」。

## 求解器

### 迴圈

- 固定 **60 Hz** 顯示幀。accumulator 累積實際經過時間，上限 clamp（如 `250ms`）防 spiral of death。
- 每幀 **4 個物理 substep**（等效 240 Hz），每 substep **1 次約束迭代**（Small Steps：多 substep × 1 迭代優於 1 步 × 多迭代）。
- **substep 數是主要降級旋鈕**：弱裝置降到 2。

### 每個 substep

1. 套用外力（v1 只有無）與既有速度，symplectic Euler 預測新位置。**所有 Particle 一視同仁**——被抓的 Particle 不設 `invMass = 0`，也不直接搬位置（見 [ADR-0003](../adr/0003-grab-attaches-at-a-barycentric-surface-point.md)）。
2. **shape-matching 脊椎**（骨幹）：
   - Region = 在 Sim mesh bounding box 上鋪的**重疊方格 lattice**。cell 邊長初始 = Jelly 對角線 × `0.15`（prototype 實測；越大越硬），是 **Softness** 的主旋鈕。
   - 每個含 ≥ `4` 個 Particle 的 cell 是一個 Region。
   - 每 substep 每 Region：算目前質心與 rest 質心 → 最佳線性變換 → 對旋轉部分做 **2×2 polar decomposition** 取 `R` → 每個成員 Particle 的 goal `g = R(x0 − c0) + c`。
   - Particle 的最終 goal = 所屬各 Region goal 的加權平均。
   - 位置朝 goal 拉：`x += α_sm (g − x)`。`α_sm` 初始 `0.7`，與 cell 邊長一起構成 Softness。
3. **XPBD 細節層**（疊加，補局部 Q 彈 + 第二道防翻面）：
   - **distance 約束**：每條 Sim mesh 邊一條。compliance 初始偏軟。
   - **signed-area 約束**：每個三角形一條，`C = signedArea(x1,x2,x3) − restArea`。**用有號面積**——翻面時 `C` 變號、梯度把元素翻正。這是關鍵，不可取絕對值。
   - 各做 1 次投影。
4. **Grab / Pin / Multi-grab 位置約束**（見 [ADR-0003](../adr/0003-grab-attaches-at-a-barycentric-surface-point.md)、[ADR-0004](../adr/0004-pin-is-a-lockable-multi-point-grab.md)）：
   - 每個 Grab／Pin 存 `{三角形 (i0,i1,i2), 重心座標 (w0,w1,w2), 目標點, locked}`。按下當下目標點 = 附著點 → 誤差為 0 → 不會一按就動。
   - 附著點目前位置 `p = Σ wₖ·xₖ`；誤差 `e = 目標 − p`；位置修正按權重分回三頂點：`xₖ += β·wₖ·e / Σwⱼ²`。放在 shape-matching / XPBD 之後，讓把手直追游標、身體靠下一 substep 的 shape matching 跟上。
   - **Grab**：`locked = false`，目標點每幀跟指標更新，`β` 是手感旋鈕（`1` = 精準貼游標，`< 1` = 彈性把手）。
   - **Pin**：`locked = true`，目標點凍結在鎖定當下的位置，`β = 1`（絕對硬鎖）。用力甩、Tap 都拔不掉。可轉回 Grab（重新定位）後再鎖。
   - **Multi-grab** = 多個這種約束依序解；Grab 與 Pin 混用天然共存。**沒有**「鎖定質心」的獨立步驟——要固定中心就放幾個 Pin。
5. **Boundary**：呼叫 `resolveBoundary(particles, dt)`。
   - **Walled**：每個 Particle clamp 進半平面組（或 AABB），歸零向外的速度分量，可選 restitution。
   - **Infinite**：no-op。
   - 執行期可切換。
6. **回推速度**：`v = (x − x_prev) / dt_substep`。**被抓的三頂點也照推** → 它們帶著拖曳速度，放開時直接就是 Fling，不需另外賦速。
7. **阻尼**：全域速度阻尼 `v *= (1 − k_damp)`。`k_damp` 調到放手後約 **1–2 秒**靜止。

### 模組邊界

- **求解器與算繪無關**：求解器只吃／吐 Particle 位置陣列。
- **Boundary 是介面**：`resolveBoundary(particles, dt)`，Walled / Infinite 是兩個實作。
- **Sim mesh 生成是一個模組**：`(Contour, 內部點參數) → (positions, indices, uv, restAreas)`。換掉三角化實作（如日後改 spade→wasm）只動這裡。
- **Grab／Pin 是 `(世界座標點) → {三角形, 重心座標}` 的 picking + 一條位置約束**。輸入層負責 picking（點擊命中哪個三角形），求解器只認 `{三角形, 重心座標, 目標點, locked}`。
- **輸入走 `applyInput(event)` 單一介面**（見上「輸入介面」）。即時輸入層、Demo、v2 錄製器都經由它，不繞過。
- **Camera 與求解器無關**：Camera 吃 Jelly 的質心／bbox + `cameraMove` event，吐世界→螢幕變換；求解器不知道 Camera 存在。

## 輸入介面

所有會影響模擬或相機的輸入都走單一窄介面 **`applyInput(event)`**（見 [ADR-0005](../adr/0005-v1-keeps-sim-deterministic-and-input-recordable.md)）。即時輸入層把指標／觸控事件翻成這些 event 呼叫它；內建 Demo 以程式碼產生同樣的 event 序列；v2 的錄製器包在外層。**不得**讓輸入層繞過介面直接操作求解器。

`event` 種類：`grab` / `moveGrab` / `release` / `pin` / `unpin` / `movePin` / `tap` / `cameraMove`。

## 輸入手勢

每個指標／觸點各自判定為 Grab 或 Tap（多點觸控 = 各指獨立）。

- **Grab（拖曳）**：`pointerdown` 在 Jelly 上 → picking（命中三角形 + 重心座標）→ `grab` event → 位置約束（見「每個 substep」步驟 4）。`pointermove` → `moveGrab`；`pointerup` → `release`，Fling 由被抓頂點自身速度帶出。
- **Pin（釘選）**（見 [ADR-0004](../adr/0004-pin-is-a-lockable-multi-point-grab.md)）：兩種放置——(a) 拖曳中按鍵／按鈕 → `pin` event 把當前 Grab 就地鎖定並放開指標；(b) pin 模式下 `pointerdown` 在 Jelly 上 → 直接 `pin`。點一個 Pin → `unpin`。抓住 Pin 拖曳 → `movePin`（放開重新鎖定）。「清除所有 Pin」= 對每個 Pin 送 `unpin`。
- **Tap（輕拍）**：`pointerdown` 後在 **≤ 250ms**、世界座標位移 **< 6px** 內 `pointerup` → `tap` event。在按下點施加**一次性徑向脈衝**：半徑 `R = Jelly bbox 對角線 × 0.2` 內每個 Particle，`v += 正規化(拍擊點 − pos) · strength · (1 − d/R)²`（**向內**——凹陷後彈回）。`strength` 初始 `6000`。ring-down 交給 shape matching + 阻尼。落在所有三角形外、附近無 Particle 時 no-op。

## Camera

- **自動跟隨**：目標變換由 Jelly 質心（平移）+ bounding box（zoom-to-fit，帶邊距）驅動，對目標做指數平滑。跟隨鬆緊是參數。
- **手動平移／縮放**：滾輪／pinch 縮放、拖背景／雙指拖平移 → `cameraMove` event。手動輸入期間**暫停自動跟隨**；最後一次手動輸入後閒置 **~2s** 緩動回歸自動。
- **鎖定跟隨**開關：等於自動跟隨關——相機定住，手動仍可動。
- **框住果凍**按鈕：一次性緩動到當前 bounding box + 邊距，然後重新啟用自動跟隨。
- 所有繪製與 picking 都經過 Camera 變換。Camera 狀態不進求解器；`cameraMove` 只動 Camera。

## 算繪

- WebGL 每頂點 UV 三角網格：PixiJS `Mesh` / `MeshSimple`，或自寫 shader。
- 不用 Canvas 2D 逐三角 `drawImage`（慢、有接縫、只能仿射）。
- Camera 的世界→螢幕轉換套在繪製與 picking 兩端。

## 初始參數速查（全部待實測調整）

| 參數 | 初始值 |
|---|---|
| Alpha mask 最長邊 | 1024 px |
| Douglas–Peucker 容差 | 1.5 px（mask 座標） |
| 目標 Particle 數 | 200–500 |
| Ruppert 最小角 | 25° |
| Sliver 丟棄門檻 | 面積 < ε 或最小角 < 15° |
| 顯示幀 | 60 Hz |
| substep / 幀 | 4（弱裝置 2） |
| 約束迭代 / substep | 1 |
| Region cell 邊長 | Jelly 對角線 × 0.15（prototype 手感實測） |
| Region 最小成員數 | 4 |
| shape-matching α_sm | 0.7 |
| Grab 硬度 β | 1.0（精準貼游標；調低＝彈性把手） |
| Tap 脈衝 strength | 6000（向內；prototype 實測） |
| Tap 影響半徑 | Jelly bbox 對角線 × 0.2 |
| Tap 判定 | pointerdown→up ≤ 250ms 且位移 < 6px |
| Pin 硬度 β | 1.0（絕對硬鎖，不可調） |
| 相機手動→自動回歸閒置 | ~2 s |
| 相機跟隨平滑 | 指數平滑，鬆緊待調 |
| 全域速度阻尼 | 調到 1–2 秒靜止 |
| accumulator clamp | 250 ms |
