# 模擬與網格：管線與參數

非 ADR。記錄「怎麼做」與初始參數，供實作接手。決策脈絡見 [ADR-0001](../adr/0001-2d-hand-written-deformable-mesh-soft-body.md)、[ADR-0002](../adr/0002-triangulation-via-cdt2d-and-hand-rolled-ruppert.md)、[ADR-0003](../adr/0003-grab-attaches-at-a-barycentric-surface-point.md) 與 [研究筆記](../research/soft-body-2d-jelly.md)。詞彙見 [CONTEXT.md](../../CONTEXT.md)。

## 情境前提

- **預設俯視、無重力；重力 > 0 視為側視**（[ADR-0012](../adr/0012-gravity-is-a-slider-not-a-mode.md)、issue #91）。重力 = 0 時 Jelly 靜置即靜止，Fling 給初速、靠阻尼收斂；重力 > 0 時所有 Particle 持續被往 +y（畫面下方）拉，落到邊界的地板上壓扁、回彈、靜止。
- 桌上可以同時有**多塊** Jelly（[ADR-0013](../adr/0013-multi-jelly-scene-is-setup-spawn-while-recording-is-an-event.md)、issue #95）：每次匯入在畫面中央新增一塊、既有的都留著；`停止／重設` 回到 Scene（片段第 0 步就存在的那組塊）。每塊是一個獨立的求解器（`SimCore`），Softness／Tap 力道／重力全域共用；Region 邊長、Tap 半徑、Grab 吸附半徑等「對角線 × 係數」的參數用**各塊自己**的對角線。Multi-grab 的多個 Grab 可以落在不同塊上。塊與塊之間會碰撞（issue #96）：推開、不穿透、貼著有摩擦、不黏著；一塊對折仍會穿過自己（沒有自碰撞）。深度重疊（例如沒平移相機就連續匯入兩塊，兩塊完全疊在同一位置）不保證能自己推開——拖開後才互撞。
- 目標裝置：2020 後中階手機 60fps；更弱裝置降 substep。

## 匯入 → 網格管線

1. **解碼**：v1 只接 PNG。WebP／APNG 之後再加，解碼路徑相同。
2. **Alpha mask**：取 alpha 通道二值化（threshold 0.5）。**降採樣到最長邊 ≤ 1024px** 再往下，把網格成本與來源圖解析度脫鉤。貼圖本身維持全解析度上 GPU。
3. **最大連通元件**：v1 只保留最大的不透明連通元件，其餘丟棄。連通元件內的洞（甜甜圈）保留，作為三角化的 hole。
4. **描 Contour**：手刻 marching squares，alpha 當 scalar field。輸出封閉多邊形路徑（外環 + 洞環）。
5. **簡化**：`simplify-js`（BSD-2-Clause）Douglas–Peucker。初始容差：mask 像素座標下 `1.5`px，之後調。
6. **三角化**：`cdt2d`（MIT）做 constrained Delaunay，約束邊 = 簡化後的 Contour 邊。
7. **內部點**：在 Contour 內撒 jittered grid（或 blue-noise）當 Steiner points 一併餵入。初始間距：讓整塊 Jelly 約 200–500 個 Particle——**目標 Particle 數由使用者調整**（「網格密度」拉霸 100–800，見 CONTEXT.md、issue #89；預設 350）。**抖動用有種子的 PRNG**（種子 = hash(降採樣後 alpha mask 位元組 + 所有網格參數)），同一張圖 + 同參數永遠得到同一個 Sim mesh（見 [ADR-0005](../adr/0005-v1-keeps-sim-deterministic-and-input-recordable.md)）。整個管線不得用 `Math.random` 或 wall-clock。
8. **Ruppert 品質細化**（自寫，`src/mesh/refine.ts`，見 ADR-0002）：最小角下界初始 `25°`、最大面積上界 = `2 × 目標間距²`；壞三角形補 circumcenter；constrained segment 被既有頂點或待插入 circumcenter encroach（落在直徑圓內）改分裂中點。每回合以固定點序重跑 `cdt2d`（批次細化）→ 決定性。批次插入時，同回合兩個相距小於「較小外接半徑的一半」的 circumcenter 只取一個，避免補點互相生 sliver 而發散。兩道終止保險：回合數上限 `30`、頂點數上限 = `目標 Particle 數 × 4`；尖銳凹形輸入角可能撞到上限，殘餘壞三角形交給下一步。
9. **Sliver 清理**：細化後仍面積 `< ε_area` 或最小角 `< 15°` 的三角形，丟棄或與鄰邊合併（保護 signed-area 約束的梯度）。
10. **指定 UV**：每個頂點 UV = 它在原圖的正規化座標。
11. **凍結拓撲**：之後模擬只更新頂點位置，`indices` 與 `uv` 不變。
12. **套用匯入尺寸**（`src/mesh/scaleMesh.ts`，issue #88）：管線**之外**的獨立純函式，把 `buildSimMesh` 輸出的 mask 像素座標網格等比放大／縮小到「bbox 最長邊 = 匯入尺寸拉霸值」（預設 512 世界單位）：`positions × s`、`restAreas × s²`，`indices`／`uv` 不動，以原點為錨不置中。刻意不進 `BuildSimMeshParams`——那些參數全部進種子雜湊（ADR-0005），加欄位會讓舊片段檔的網格不再重現。匯入層在這一步之後才建求解器；片段檔記下實際套用的值（`importSize`，`null` = 舊檔未縮放），載入時依檔案值縮放、不套目前拉霸。

**重建**（issue #90 / #95 / #98，見 CONTEXT.md）：拿**那一塊自己的**來源位元組（圖庫查 `sourceId`）＋當下「網格密度」／「匯入尺寸」拉霸，從第 1 步到第 12 步整條重跑，換掉那塊的網格——同 `jellyId`、同 `sourceId`、同 `offset` 的 `remove` + `spawn`，所以擺放位置（網格座標的平移量）不變、那塊回到 rest、附在它上面的 Pin／Grab 掉光。兩個入口共用同一條路徑（`JellySandbox.rebuildJellies`）：「匯入」區塊的「全部重建」鈕對場上每一塊套目前拉霸，「重建 Jelly」工具點哪塊重建哪塊。重建只改 Scene、不是 Track 事件（ADR-0013），錄製中／播放中兩個入口都 disabled；片段檔記下的就是重建後的實際值。

v1 Sim mesh 與 Texture mesh 為同一張。若貼圖出現明顯折面感，升級為「粗 Sim mesh + 細 Texture mesh，重心座標 skin」。

## 求解器

### 迴圈

- 固定 **60 Hz** 顯示幀。accumulator 累積實際經過時間，上限 clamp（如 `250ms`）防 spiral of death。
- 每幀 **4 個物理 substep**（等效 240 Hz），每 substep **1 次約束迭代**（Small Steps：多 substep × 1 迭代優於 1 步 × 多迭代）。
- **substep 數是主要降級旋鈕**：弱裝置降到 2。

### 每個 substep

1. 套用外力與既有速度，symplectic Euler 預測新位置。外力都在**預測之前**烤進 `vel`（預測之後改 `vel` 會在步驟 6 回推時被蓋掉）：電風扇陣風（issue #66／#67）與**重力** `vel.y += gravity × h`（issue #91；`gravity = 0` 時整段跳過，每個浮點運算跟沒有重力時完全一樣，舊片段重播不變）。**所有 Particle 一視同仁**——被抓／被 Pin 的 Particle 也照加重力、不設 `invMass = 0`，也不直接搬位置（見 [ADR-0003](../adr/0003-grab-attaches-at-a-barycentric-surface-point.md)）；約束在步驟 4 把它們拉回。
2. **shape-matching 脊椎**（骨幹）：
   - Region = 在 Sim mesh bounding box 上鋪的**重疊方格 lattice**。cell 邊長初始 = Jelly 對角線 × `0.15`（prototype 實測；越大越硬），是 **Softness** 的主旋鈕。
   - 每個 cell 內的 Particle 先依 Sim mesh 的邊切成**連通分量**（BFS 限制在該 cell 的成員內），每個含 ≥ `4` 個 Particle 的分量是一個 Region（issue #83）。不切的話，凹形物件上兩塊只隔著透明縫、網格上不相連的部位會被同一個方格當成一塊剛體擬合——拉一邊另一邊跟著走。
   - 每 substep 每 Region：算目前質心與 rest 質心 → 最佳線性變換 → 對旋轉部分做 **2×2 polar decomposition** 取 `R` → 每個成員 Particle 的 goal `g = R(x0 − c0) + c`。
   - Particle 的最終 goal = 所屬各 Region goal 的加權平均。
   - 位置朝 goal 拉：`x += α_sm (g − x)`。`α_sm` 初始 `0.7`，與 cell 邊長一起構成 Softness。
   - **動量守恆（只在 `gravity ≠ 0` 時開，issue #91）**：單一 Region 的 goal 位移總和為 0，但跨 Region 等權平均後不再守恆，每 substep 漏出一小段淨平移。無重力時只是 Fling 軌跡幾個百分點的差異；有重力、Jelly 靜置在無摩擦地板上時，這段每步被重力壓縮重新激發、x 方向無物可擋，會累積成一路走不停的滑動（實測 ~30 單位／秒）。開啟時把所有 Particle 的位移扣掉全體平均。`gravity = 0` 走原路徑，保住舊片段重播；要不要全域開啟見 issue #102。
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
   - **Walled**：每個 Particle clamp 進半平面組（或 AABB），歸零向外的速度分量，可選 restitution。切換當下 AABB 依 Jelly bbox 展開成正方形（`computeWalledBounds`）。撞到 x 面的 Particle 回推 y 速度乘 `(1 − friction)`、撞到 y 面衰減 x、角落兩軸都衰（摩擦見下）。
   - **Floor**（issue #92、[ADR-0012](../adr/0012-gravity-is-a-slider-not-a-mode.md)）：一條水平地板 `y = floorY`，左右與上方無限延伸。`pos.y > floorY` 的 Particle clamp 到 `floorY`，`prev.y` 比照 Walled（restitution 沿用 0）；x 方向與上方不管。切換當下 `floorY` 貼齊 Jelly bbox 底邊（世界 y 向下 → `maxY`，`computeFloorY`），切過去 Jelly 就已經站在地板上——不憑空掉一段、不半截埋進去。畫面上畫一條橫跨可視範圍的地板線（線寬顏色沿用牆框、跟著相機重畫），跟牆框一樣不是提示、不受「播放時隱藏提示」影響。貼地那步 x 速度乘 `(1 − friction)`。
   - **摩擦（issue #93、ADR-0012）**：Walled 與 Floor 共用 `friction`（0–1，app 層常數 `BOUNDARY_FRICTION`，不進面板、不進片段檔）。語意：這個 substep 被某個面 clamp 的 Particle，`prev` 沿該面切線往 `pos` 靠——`prev_t = pos_t − (pos_t − prev_t) × (1 − friction)`，回推的切線速度乘 `(1 − friction)`；法線維持 restitution 規則。「接觸」= 這個 substep 被 clamp，所以有重力靜置在地板上的 Jelly 每步都在接觸、摩擦持續作用；沒重力時只有真的撞上才作用，俯視手感不變。`friction = 0` 整段跳過（`pos − (pos − prev)` 不保證位元等於 `prev`），既有無摩擦行為位元不變。**既有片段的影響**：摩擦不進片段檔、也沒有 0 的退路，所以 #93 之前錄的片段若是 Walled／Floor 且有撞牆或貼地，重播結果會跟錄製當時不同（無重力、沒撞牆的片段不受影響）——ADR-0012 接受這點（固定手感值、不給拉霸），與 #91 守住阻尼不同。實測（真瀏覽器、400×200 平底果凍、g = 5000、抓右下角貼地快甩，放開後質心 x 位移）：friction 0 → 274 單位、0.7 s 停（靠阻尼）；0.3 → 160（58%）、0.4 s；0.6 → 93（34%）、0.3 s；1 → 68（25%）、0.3 s。太黏（≥ 0.6）拖著貼地的果凍走也會被明顯拖住，故定 0.3。抓上緣或中段甩出去 Jelly 會前傾翻滾、底邊離地，摩擦幾乎無從作用（0 vs 1 只差 ~15%）——圓形 Jelly 在有摩擦地板上被側甩會從滑變滾，是正確物理。
   - **Infinite**：no-op。
   - 執行期可切換；重新匯入／重建／載入片段換新求解器時依記住的模式重套（Walled／Floor 都依新 Jelly 的 bbox 重算）。
   - **跨塊碰撞插在這之後、回推速度之前**（issue #96，`World.step` 對每塊跑完 1–5 才做一次 `resolveCollisions`；單塊時不跑、位元不變）。演算法依 #94 prototype 定案（primary source：分支 `prototype/jelly-collision`、#87 留言），正式版在 `src/sim/collision.ts`。每個 bbox 相交的無序塊對 (A, B) 分三段：
     1. **偵測**（A→B、B→A 各一趟，不動位置）：只拿 A 的**輪廓** Particle 去測 B；內外判定用 B 輪廓的 even-odd 射線法，與最近輪廓邊查詢併成同一趟迴圈（不需要三角形 bbox 網格——prototype 實測那是 10 塊時 75% 的碰撞成本）。記下在裡面的 Particle、最近邊與「朝最近表面點」的方向，方向 × 深度累加成這對的接觸平均法線。
     2. **整體非彈性衝量**（每無序塊對一次）：沿接觸平均法線把兩塊質心的趨近速度（以 `pos − prev` 表示）扣掉 `impactAbsorb = 0.75`，依 Particle 數配重、動量守恆、只扣趨近不拉回。柔體的動量靠 shape matching 擴散太慢，沒有這步高處落下會把被撞那塊的表層壓翻、坍成一團。**撞擊級**（要扣的位移 ≥ `separationThreshold = 0.1` × 輪廓平均邊長）在推出**之前**平移全體 `pos`（剛體式先退開，表層只剩殘餘要吃——prototype「推出後平移 `prev`」的版本在降級到 2 substep 時撞速 ≈ 每 substep 一個邊長，10 塊堆疊會永久坍成一團）；**靜置級**在推出**之後**、以推出後的質心位移重算，平移全體 `prev`（只改速度，prototype 原序；靜置時趨近 ≤ 0 根本不啟動，KE 歸零。先平移 `prev` 再推出、或靜置也平移位置，疊放都會變成停不下來的微震）。
     3. **推出**：對每筆接觸重算目前深度（分離或前面的推出後已在外面 → 跳過），沿「朝最近表面點」的方向推到輪廓邊上——**不信任靜止繞向算的外法線**（高速撞擊時表層三角形被壓翻、法線反向）。修正量依 PBD 權重分：Particle `particleShare = 0.5`、邊兩端點 `(1 − share)(1 − t)`／`(1 − share) t`，分母 `share + (1 − share)((1 − t)² + t²)`（字面「一半一半」會留 25% 穿透）。接著 **Coulomb 位置式摩擦**：直接抵銷這個 substep A 點與邊上接觸點的**相對**切線位移，上限 `μ × depth`（Macklin 2019；`μ = BOUNDARY_FRICTION = 0.3`）——有靜摩擦，疊放不滑落；spec 原案的「切線速度衰減」砍不掉已發生的橫向位移。撞擊級沿偵測時記下的邊與方向推（剛體分離後「最近邊」可能翻到另一側，把深陷的 Particle 推向反方向互相卡住）；靜置級以目前位置重跑最近邊查詢（Gauss–Seidel，prototype 原案；用記下的邊在角落會沿舊方向推，某些落點疊放靜置會微震不停）。
   - 一個 substep 一輪、skin = 0（只推「在裡面」的）；Small Steps 靠多 substep 收斂。塊對依 id 順序走訪，決定性（同輸入重播位元相同）。
   - **實測與已知限制**（真瀏覽器、平底磚 ~470–510 Particle）：拖一塊撞另一塊 → 被撞的推走變形、放開 3 s 內兩塊 KE 歸零、穿透 0 顆；g = 5000 一塊從 3.5 個身高落到另一塊上 → 撞擊 stretch 峰 1.3、疊放靜置 KE 歸零、殘餘穿透 2–7 顆（浮點邊界，視覺無感）、上塊把軟的底塊壓出約 12% 身高的凹陷（柔體正常行為）；三顆 Pin 釘住的塊被硬 Grab 塞進來時**撞擊中**會短暫 stretch 到 7–8、三角形翻面，放開後完全復原、Pin 塊質心不動；10 塊（4700 Particle）同時從 1.3 個身高落進 Walled 箱：4 substep 時 g ≤ 8000 穿透 ≤ 21 顆，**g = 10000（拉霸上限）會有約 15% Particle 永久互相穿透**；降級到 2 substep 時 g ≤ 3000 可恢復（撞擊瞬間數十顆、靜止後 < 10 顆），**g = 4000 起會有一部分（數百顆）卡成互相穿透、g ≥ 6000 整堆坍成一團解不開**——深度穿透是「最近表面」類方法的固有限制，撞速 ≥ 每 substep 一個網格邊長就進入這個區間。碰撞成本 10 塊時 `World.step` 合計 ~5–8 ms／幀（headless；`PerfMonitor` 在 4 substep 下未降級，p95 幀時間 ~31 ms 是 headless 環境本身的上限），瓶頸仍是求解器本身；錄一段互撞 Track 重播兩次位置逐位元相同。
6. **回推速度**：`v = (x − x_prev) / dt_substep`。**被抓的三頂點也照推** → 它們帶著拖曳速度，放開時直接就是 Fling，不需另外賦速。
7. **阻尼**：全域速度阻尼 `v *= (1 − k_damp)`。`k_damp` 調到放手後約 **1–2 秒**靜止。有重力時它同時給落體一個終端速度 `≈ g·h/k_damp`（`k_damp = 0.02`、240 Hz → `g / 4.8`）；issue #91 實測決定**不動阻尼**（改它舊片段重播就變），改把重力拉霸上限拉高（見參數表）。
   - **側視拆內部／整體（issue #106）**：`gravity ≠ 0` 時空中沒有桌面摩擦，全域阻尼套在落體上等於終端速度 `g / 4.8`、0.2 s 就到，看起來沒有加速度。改把每個 Particle 的速度拆成「質心平移」（等權平均 `v̄`）與「相對質心的內部運動」（抖動、拉伸、自轉）：`v = v̄·(1 − k_air) + (v − v̄)·(1 − k_damp)`。內部運動維持 `k_damp = 0.02`（放手後仍 1–2 s 靜止），質心只吃很小的 `k_air`（`airDamping`，預設 0.001：終端速度 `g / 0.24`、63% 要 ~4 s），自由落體看得到先慢後快；停下來交給牆／地板摩擦（issue #93）與牆的 restitution。`gravity = 0` 走原路徑（每個浮點運算不變，舊片段重播不變），`airDamping` 完全不參與。副作用（接受）：側視 + Infinite 甩出去的 Jelly 不會自己減速；落地速度比 #91 時高 2–4 倍（不再被終端速度壓住），著地壓扁與回彈明顯變大。實測（真瀏覽器、512×256 平底果凍）：g = 5000 自由落體每 0.5 s 落差 686 → 1785 → 2762 → 3628（舊路徑全程 ~520 等速）；Floor + 摩擦 0.3 快甩放開後滑 607 單位、1.3 s 停（舊 185／0.6 s）；Walled 箱（4× 身長）g = 5000 落 ~768 單位著地 ~2800／秒、壓扁到 0.75、回彈約一個身高、~2.5 s 靜止（舊：終端速度 1040、壓扁 0.86、不回彈、2.3 s）；g = 10000 壓扁到 0.45、空中拉長 1.3。13×13 fixture 輕甩（離地 ~50）落地後 ~1.3 s 靜止、用力甩（飛 2 倍身高）翻滾＋回彈 ~3 s 才靜止。重力拉霸的手感範圍因此整體變重（同一 g 落地速度 2–4 倍），要不要調整拉霸預設／上限另議。

### 模組邊界

- **求解器與算繪無關**：求解器只吃／吐 Particle 位置陣列。
- **Boundary 是介面**：`resolveBoundary(particles, dt)`，Walled / Floor / Infinite 是三個實作。
- **Sim mesh 生成是一個模組**：`(Contour, 內部點參數) → (positions, indices, uv, restAreas)`。換掉三角化實作（如日後改 spade→wasm）只動這裡。
- **Grab／Pin 是 `(世界座標點) → {三角形, 重心座標}` 的 picking + 一條位置約束**。輸入層負責 picking（點擊命中哪個三角形），求解器只認 `{三角形, 重心座標, 目標點, locked}`。
- **輸入走 `applyInput(event)` 單一介面**（見上「輸入介面」）。即時輸入層、Demo、v2 錄製器都經由它，不繞過。
- **`World` 是多塊容器**（`src/sim/World.ts`，issue #95）：對外契約與 `SimCore` 同形（`applyInput`／`step`／`pick`／`bbox` 聯集／`listPins` 帶 `jellyId`／`reset` …），沙盒只對它說話。每塊一個 `SimCore`；網格由注入的 `meshProvider(sourceId, meshParams, importSize)` 給（`World` 不認得影像位元組，`spawn` 才能同步、在 Track 重播裡生成）。事件路由：`grab`／帶座標的 `pin`／`tap` 依 picking（id 倒序、先命中先贏；都沒中則跨塊最近 Particle 吸附）；`moveGrab`／`release`／`unpin`／`movePin` 依「約束 id → jellyId」表；`setFan`／`clearFan`／`clearPins` 廣播。`spawn`／`remove` 是 `World` 層級的事件（`jellyId` 而非 `id`，`mergeTracks` 不加前綴）。塊的迭代依 id 排序（決定性）。
- **`SimCore` 的 substep 拆成三段**（issue #95）：`predict(h)`（步驟 1–2）／`solveInternal(h)`（3–6）／`finishSubstep(h)`（7），`step(dt)` = 三者迴圈。`World.step(dt)` 每個 substep 對每塊各跑三段，跨塊碰撞插在第二與第三段之間；`SimCore` 另公開輪廓邊清單（`contour`，只屬於一個三角形的邊，含外法線正負號）、輪廓 Particle 索引（`surfaceParticles`）與 `prevPositions` 給碰撞讀寫。
- **跨塊碰撞是純函式**（`src/sim/collision.ts`，issue #96）：`resolveCollisions(jellies, params)` 吃 `CollisionBody[]`（`positions`／`prevPositions`／`particleCount`／`contour`／`surfaceParticles`——`SimCore` 結構上就滿足，`World` 直接把各塊的 core 依 id 順序傳進來）就地改 `positions`／`prevPositions`，回傳統計（塊對數、接觸數、最大深度）。不認得 `SimCore`、`World` 或邊界；參數 `CollisionParams`（`friction`／`impactAbsorb`／`particleShare`／`separationThreshold`）由 `World` 建構時注入，沙盒只覆寫 `friction = BOUNDARY_FRICTION`。固定手感值：不進面板、不進片段檔。
- **Camera 與求解器無關**：Camera 吃所有 Jelly 的聯集 bbox（`World.bbox()`，空場 `null` → 鏡頭不動）+ `cameraMove` event，吐世界→螢幕變換；求解器不知道 Camera 存在。

## 輸入介面

所有會影響模擬或相機的輸入都走單一窄介面 **`applyInput(event)`**（見 [ADR-0005](../adr/0005-v1-keeps-sim-deterministic-and-input-recordable.md)）。即時輸入層把指標／觸控事件翻成這些 event 呼叫它；內建 Demo 以程式碼產生同樣的 event 序列；v2 的錄製器包在外層。**不得**讓輸入層繞過介面直接操作求解器。

`event` 種類：`grab` / `moveGrab` / `release` / `pin` / `unpin` / `movePin` / `tap` / `cameraMove`。

## 輸入手勢

每個指標／觸點各自判定為 Grab 或 Tap（多點觸控 = 各指獨立）。

- **Grab（拖曳）**：`pointerdown` 在 Jelly 上 → picking（命中三角形 + 重心座標）→ `grab` event → 位置約束（見「每個 substep」步驟 4）。`pointermove` → `moveGrab`；`pointerup` → `release`，Fling 由被抓頂點自身速度帶出。
- **Pin（釘選）**（見 [ADR-0004](../adr/0004-pin-is-a-lockable-multi-point-grab.md)）：兩種放置——(a) 拖曳中按鍵／按鈕 → `pin` event 把當前 Grab 就地鎖定並放開指標；(b) 工具選擇器選著「Pin」工具時 `pointerdown` 在 Jelly 上 → 直接 `pin`，點在既有 Pin 附近 → `unpin`（[ADR-0015](../adr/0015-pin-joins-the-tool-selector.md)，取代原本的 Pin 模式勾選框）。抓住 Pin 拖曳 → `movePin`（放開重新鎖定）。「清除所有 Pin」= 對每個 Pin 送 `unpin`。
- **Tap（輕拍）**：`pointerdown` 後在 **≤ 250ms**、位移 **≤ 6px** 內 `pointerup` → `tap` event。（T10 實作把 6px 量在**螢幕空間**——指標在畫面上沒動——而非世界座標，才不會因相機縮放改變 Tap 靈敏度。）在按下點施加**一次性徑向脈衝**：半徑 `R = Jelly bbox 對角線 × 0.2` 內每個 Particle，`v += 正規化(拍擊點 − pos) · strength · (1 − d/R)²`（**向內**——凹陷後彈回）。`strength` 初始 `6000`。ring-down 交給 shape matching + 阻尼。落在所有三角形外、附近無 Particle 時 no-op。

## Camera

實作見 `src/camera/`：純函式 `updateCamera(state, target, canvasSize, commands, dt) → state'`
（決定性、無 DOM，同 ADR-0005）＋ `CameraGestures`/`CameraInput`（DOM 手勢 → 指令）。
`state.transform`（`{ x, y, scale }`）給算繪與 picking 用。

- **自動跟隨**：平移分量與縮放都對 Jelly bounding box 的 zoom-to-fit（帶邊距）——平移
  對準 bbox 中心、縮放塞進畫布——各做 frame-rate 無關的指數平滑（`α = 1 − e^(−λ·dt)`）。
  λ 是參數（`CameraFollowConfig`，有預設值 `DEFAULT_CAMERA_FOLLOW_CONFIG`，同求解器的
  `SimParams`）。錨點刻意跟「框住果凍」與匯入初始鏡位一致——靜置跟隨會收斂到跟按一次
  「框住果凍」相同的鏡位，不會因 Jelly 形狀不對稱（質心 ≠ bbox 中心）而偏掉。追不上時
  （用力甩遠、bbox 突然變大）有硬上限頂住：bbox 中心離畫面中心的距離（各軸獨立）不超過
  該軸畫布尺寸 × `keepInFrameFrac`、縮放需要「縮小才塞得下」時立即到位——保證 Jelly 不會
  跑出畫面／被裁掉。
- **手動平移／縮放**：滾輪／pinch → `zoomBy`（對準指標處）、拖背景／雙指拖 → `panBy`
  （螢幕像素）。手動輸入期間 `sinceManualSeconds` 歸零 → **暫停自動跟隨**；閒置 **~2s**
  （`resumeDelaySeconds`）後緩動回歸。「背景」＝ `pointerdown` 時 `sim.pick()` 沒命中。
- **鎖定跟隨**開關：`setFollow { enabled: false }`——自動跟隨關，相機定住，手動仍可動。
- **框住果凍**按鈕：`frame`——忽略暫停與鎖定，一次性緩動到當前 bbox + 邊距，到位後恢復跟隨。
- 所有繪製與 picking 都經過 `state.transform`。相機狀態不進求解器；相機指令是與
  `applyInput` 平行的另一條輸入流（`CameraCommand`），不共用求解器的窄介面。

## 算繪

- WebGL 每頂點 UV 三角網格：PixiJS `Mesh` / `MeshSimple`，或自寫 shader。多塊時每塊一個 `Mesh`（`JellyRenderer.addJelly`／`removeJelly`），繪製順序依 id（後生成在上）；沙盒每幀以 `World.jellies()` 與算繪端 id 集合 diff 同步。
- 不用 Canvas 2D 逐三角 `drawImage`（慢、有接縫、只能仿射）。
- Camera 的世界→螢幕轉換套在繪製與 picking 兩端。

## 初始參數速查（全部待實測調整）

| 參數 | 初始值 |
|---|---|
| Alpha mask 最長邊 | 1024 px |
| Douglas–Peucker 容差 | 1.5 px（mask 座標） |
| 目標 Particle 數 | **使用者可調**（「網格密度」拉霸 100–800、步進 10，預設 350；效能降級時自動砍半、可手動拉回，issue #89）；細化後實際 Particle 數約為目標的 1.2–1.35 倍 |
| Ruppert 最小角 | 25° |
| Ruppert 最大面積 | 2 × 目標間距² |
| Ruppert 終止保險 | 回合上限 30、頂點上限 目標數 × 4 |
| Sliver 丟棄門檻 | 面積 < ε 或最小角 < 15° |
| 顯示幀 | 60 Hz |
| substep / 幀 | 4（弱裝置 2；降級當幀同時把「網格密度」拉霸砍半） |
| 約束迭代 / substep | 1 |
| Region cell 邊長 | Jelly 對角線 × 0.15（prototype 手感實測） |
| Region 最小成員數 | 4（拆連通分量後的分量大小；issue #83 實測真實網格拆分後預設／最硬 cellFrac 下無頂點失去 Region，故不降） |
| shape-matching α_sm | 0.7 |
| Grab 硬度 β | 1.0（精準貼游標；調低＝彈性把手） |
| Tap 脈衝 strength | 6000（向內；prototype 實測） |
| 重力 `gravity` | **使用者可調**（「重力」拉霸 0–10000、步進 100，預設 0 = 俯視無重力；issue #91）。實測（阻尼 0.02、512 高的平底果凍落 ~830 單位到 Walled 箱底）：spec 初訂上限 2000 中段只有 ~200 單位／秒、4 秒才落地，像糖漿；5000 → 1.2 s 落地、終端速度 ≈ 1000（約 2 倍身高／秒）、著地壓扁到 0.83、靜置下陷 3%；10000 → 0.6 s、壓扁到 0.7、下陷 6%；任何值落地後 ≤ 2 s 靜止。圓形果凍（預設 Pac-Man）在無摩擦地板上會慢慢滾到重心最低的姿態，是正確物理、不是抖動 |
| 邊界摩擦 `friction` | **0.3**（`BOUNDARY_FRICTION`，Walled／Floor 共用；issue #93。0 = 冰面、1 = 貼地那步切線速度歸零；實測數據見上「邊界」節） |
| 跨塊碰撞摩擦 `μ` | **0.3**（沿用 `BOUNDARY_FRICTION`——沙盒建 `World` 時傳入；`DEFAULT_COLLISION_PARAMS.friction` 是同值的第二份字面值，只給測試，改值要同步；issue #96。Coulomb 位置式：一次接觸最多抵銷 `μ × depth` 的相對切線位移，撞擊級的 `depth` 取偵測時的深度（剛體分離後殘餘深度可能為 0，切向阻力不因此消失）；#94 實測 0.3 疊放即不滑） |
| 跨塊碰撞整體衝量 `impactAbsorb` | **0.75**（每無序塊對一次扣掉的質心趨近速度比例；#94 實測 0.5–1 都可） |
| 跨塊碰撞推出配比 `particleShare` | **0.5**（PBD 權重：被推 Particle 0.5、邊兩端點依重心權重分 0.5；0.8 會讓兩塊被推開滑走） |
| 跨塊碰撞位置分離門檻 `separationThreshold` | **0.1** × 輪廓平均邊長（要扣的趨近位移達此值 = 撞擊級 → 平移 `pos`；否則靜置級 → 平移 `prev`。靜置時趨近 ≈ `0.75·g·h²`，4 substep、g = 10000 也只有 0.13，遠低於門檻） |
| 跨塊碰撞輪數 / substep | 1（skin 0；只測輪廓 Particle） |
| Tap 影響半徑 | Jelly bbox 對角線 × 0.2 |
| Tap 判定 | pointerdown→up ≤ 250ms 且位移 < 6px |
| Pin 硬度 β | 1.0（絕對硬鎖，不可調） |
| 相機手動→自動回歸閒置 | ~2 s |
| 相機跟隨平滑 | 指數平滑，鬆緊待調 |
| 全域速度阻尼 `damping` | 0.02／substep（調到 1–2 秒靜止）。俯視套在完整速度上；側視只套在相對質心的內部運動（issue #106） |
| 側視質心空氣阻力 `airDamping` | **0.001**／substep（issue #106；`gravity = 0` 不參與、不進面板、不進片段檔；實測數據見上「阻尼」節） |
| accumulator clamp | 250 ms |
