# 2D 果凍柔體模擬：技術調查（primary-source）

> **檔案位置說明**：本專案先前沒有研究筆記的慣例。`docs/agents/` 已被用來放 agent 設定文件，因此把研究筆記放在 `docs/research/` 是合理的歸屬。本檔是第一份，之後同類文件也放這裡。
>
> **調查方法**：盡量回到第一手來源（原始論文 PDF、函式庫原始碼與官方文件、技術原作者的 dev blog）。凡是只能從二手來源（教學、部落格轉述）確認的，文中明確標記為「未經一手驗證」。每一項主張都附行內引用 URL。調查時間：2026-09。
>
> **一手 PDF 取得方式**：Position Based Dynamics (2006)、XPBD (2016)、Meshless Shape Matching (2005)、Small Steps (2019)、Bender/Müller/Macklin PBD tutorial (2015)、Irving–Teran–Fedkiw (2004) 均以 `pdftotext` 從作者官方託管的 PDF 抽取內文後引用。Matyka 的壓力模型一手 PDF（`panoramx.ift.uni.wroc.pl`）在調查當下伺服器拒絕連線，相關細節標為未完全驗證。

---

## TL;DR（直接回答使用者的兩個問題）

**問題一：「3D 模擬 → 壓成 2D 顯示」是不是這類需求的既有做法？**
沒有找到任何一手來源顯示有遊戲或知名 WebGL demo「刻意為了迴避 2D 的自摺／inversion 問題，而在 3D 裡模擬果凍再壓平顯示」。這個領域的標竿案例——Walaber 的 JellyCar／JelloPhysics、Matyka 的壓力模型、Unity 的 Jelly Sprites——全部都留在 2D（point-mass + 邊彈簧 + 形狀匹配或內壓）。而且 3D 四面體網格有它**自己的** inversion 問題：Irving–Teran–Fedkiw 開宗明義說「standard finite element simulation algorithms fail as soon as a single tetrahedron inverts」，而且「large deformation and inversion can arise even when simulating incompressible material」（[ITF04, §1](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)）。換句話說，走 3D 不但沒有免費解掉 inversion，還把同一個問題以更貴的形式（3×3 SVD／polar decomposition、5–6 倍元素數、3-vector）搬回來。**這個假設沒有 prior-art 支持。**

**問題二：這兩個問題能不能乾淨地留在 2D 解掉？怎麼解？**
可以，而且有多條一手記載的路線：

- **自摺／element inversion**：根本原因是「distance/edge 彈簧對反射（reflection）不敏感」——翻過去的三角形邊長可以完全正確，所以彈簧看不出來，翻面態就成了另一個平衡點。三個一手記載的 2D 解法：(a) **signed-area 約束**（有號面積，翻面時 `C = area − restArea` 變號，約束主動把元素翻回來）——這正是 Müller「Ten Minute Physics」把 tutorial 標題叫做 *"Simple and unbreakable simulation of soft bodies"* 的原因（[10-softBodies.html 原始碼](https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/10-softBodies.html)）；(b) **altitude springs / pseudo-pressure springs**——Irving–Teran–Fedkiw 明說「For mass-spring systems, altitude springs work surprisingly well … not only is inversion not a problem, but the elements will work to un-invert」（[ITF04, §2](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)，引 Cooper–Maddock 1997 與 Molino et al. 2003）；(c) **shape matching**——每個粒子被拉向「剛體變換後的 rest shape」上的 goal position，論文明說「not exposed to problems such as ill-shaped or inverted elements」且「stable under all circumstances」（[Müller et al. 2005, §1](https://matthias-research.github.io/pages/publications/MeshlessDeformations_SIG05.pdf)）。
- **凹形尖角彈簧太少、軟趴趴**：兩個獨立面向。(i) **網格品質**：用有品質保證的 constrained Delaunay refinement（Shewchuk 的 Triangle：`-q` 最小角約束 + `-a` 最大面積約束，靠插入 Steiner points 消除 skinny 三角形，[Triangle 首頁](https://www.cs.cmu.edu/~quake/triangle.html)）取代 ear-clipping（earcut 明說 *"favoring raw speed and simplicity over triangulation quality"*，[earcut README](https://github.com/mapbox/earcut)）。有內部頂點 + 角度下界後，尖角區域自然得到足夠的元素與約束。(ii) **改用不靠局部連結性的力**：shape matching 的 goal position「regardless of local connectivity」——凹處尖角只要屬於某個 cluster，就一定被拉回原位；內壓模型（Matyka）用封閉輪廓的內部氣壓把凹處撐開，不依賴內部彈簧數量。

**這份調查的建議方向**：2D，主結構用 **XPBD 的 distance + signed-area 約束**（signed-area 直接處理 inversion），或 **shape matching / region-based shape matching**（對「釘住質心觀察拉到極限的穩定態」這個需求特別合適，因為 goal position 本身就是穩定吸引子）。網格用 Triangle 等級的品質三角化 + 內部頂點。細節與取捨見最後一節。

---

## 1. Position-Based Dynamics (PBD) / XPBD

### 1.1 PBD（Müller, Heidelberger, Hennix, Ratcliff 2006）

**是什麼**：跳過力與速度層，直接在位置上求解約束。演算法：用外力做 symplectic Euler 預測新位置 `p`，然後反覆把 `p` 投影到滿足一組約束 `C_j(p)=0`（或 `≥0`）的流形上，最後用 `(p − x)/Δt` 回推速度（[posBasedDyn.pdf, §3.1](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf)）。論文明說「the approach works equally well in two dimensions」（同上, §3.3）。

**約束種類（一手）**：
- **Distance/stretch 約束** `C(p1,p2) = |p1−p2| − l0`，投影量按 inverse mass 加權：`Δp_i = −s·w_i·∇_{p_i}C`，其中 `s = C / Σ w_j |∇C|²`（[同上, §3.3, Eq. 9–11](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf)）。
- **Bending 約束**：用相鄰兩三角形的 dihedral angle。
- **Overpressure（體積）約束**：只針對**封閉**三角網格，`C(p1..pN) = Σ_i (p_{t1i}×p_{t2i})·p_{t3i} − k_pressure·V0`，把實際體積跟 rest 體積乘以過壓係數比較（[同上, §3.3](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf)）。

**2006 版對 inversion 的處理**：這篇論文**沒有** triangle 的 area 約束，只有 3D 封閉網格的體積約束；它也沒有專門討論 element inversion。它的 self-collision 是用 `C(q,p1,p2,p3) = ±(q−p1)·[(p2−p1)×(p3−p1)]`「keeps the point q on the correct side of the triangle」——這是點對三角形的單側約束，不是元素反轉的通解。

**剛度（stiffness）與時間步相依性（PBD 的已知弱點）**：stiffness 參數 `k∈[0,1]`。直接乘 `k` 在多次迭代下非線性，論文改乘 `k' = 1 − (1−k)^{1/ns}` 讓誤差對迭代次數 `ns` 線性化。但論文自己承認：「the resulting material stiffness is still dependent on the time step of the simulation. Real time environments typically use fixed time steps in which case this dependency is not problematic」（[同上, §3.3](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf)）。這正是 XPBD 要修的。

### 1.2 XPBD（Macklin, Müller, Chentanez 2016）

**是什麼**：對 PBD 的小幅擴充，加入 **compliance**（`α` = inverse stiffness）與累積的 Lagrange multiplier `λ`，使其等價於一個 implicit 時間積分下的 compliant constrained dynamics，讓剛度「in a time step and iteration [count] independent manner」（[XPBD.pdf 摘要與 §1](https://matthias-research.github.io/pages/publications/XPBD.pdf)）。

**一手要點**：
- PBD 直接乘 `k` 的副作用：「the effective constraint stiffness is now dependent on both the time step and the number of constraint projections performed」，且「does not converge to a well-defined solution」（[XPBD.pdf, §3](https://matthias-research.github.io/pages/publications/XPBD.pdf)）。
- XPBD 的每次約束更新：`Δλ_j = (−C_j − α̃_j λ_j) / (∇C_j M⁻¹ ∇C_jᵀ + α̃_j)`，其中 `α̃ = α/Δt²`；`Δx = M⁻¹ ∇C_jᵀ Δλ_j`（[同上, §3, Eq. 17–18](https://matthias-research.github.io/pages/publications/XPBD.pdf)）。`α→0` 時退化回硬約束（原始 PBD）。
- `λ` 也給出**約束力估計**，可用於 haptic 或 force-dependent 效果（[同上, 摘要](https://matthias-research.github.io/pages/publications/XPBD.pdf)）。
- 論文的 **2D 結果**用「a CPU implementation with Gauss-Seidel style iteration」，測試對象包含 2D 三角 FEM 元素（St. Venant–Kirchhoff）、cantilever beam（[同上, §5 Results](https://matthias-research.github.io/pages/publications/XPBD.pdf)）。開銷相對 PBD 幾乎可忽略。

**area / volume 約束是否防止 triangle inversion**：XPBD 論文本身沒有把「防 inversion」當成賣點。但 Bender/Müller/Macklin 的 PBD tutorial 給了明確的 2D **area 約束**：`C(x1,x2,x3) = ½ |x2,1 × x3,1| − A0`（3D 四面體則 `C = (1/6)|x2,1·(x3,1×x4,1)| − V0`），並指出把它做成**單側**約束時 air-mesh 元素「do not invert with the unilateral constraints」（[2015 EG Tutorial, §5.5.1 及 §5.5.4](http://animation.rwth-aachen.de/media/papers/2015-EG-Tutorial.pdf)）。關鍵細節：**若用「有號」面積／體積**（不加絕對值），翻面時 `C` 變號、約束梯度指向把元素翻正的方向——這就是下一節 Ten Minute Physics 程式碼實際在做的事。若用「無號」`|·|`，翻面態與正常態對約束來說無法區分，就防不了。

FEM-in-PBD 對退化／反轉元素：tutorial 明說「common constitutive models are not designed to handle degenerate or inverted tetrahedral elements. However, this problem can be solved by using the inversion handling of Irving et al. [ITF04]」（[同上, §5.8.1](http://animation.rwth-aachen.de/media/papers/2015-EG-Tutorial.pdf)）——也就是說，走連續體 FEM 路線的話，inversion 不是免費解掉的，還是得接 §4 的 SVD 手術。

### 1.3 Substepping（Small Steps in Physics Simulation, Macklin et al. 2019）

**一手要點**：與其「一個大 Δt + 多次約束迭代」，不如「多個小 substep + 每個 substep 只做 1 次迭代」。相同的總約束投影次數下，substepping 的能量行為、收斂與剛度一致性都顯著更好；每個 substep 只多一次 symplectic Euler 更新，額外成本很小（[smallsteps.pdf](https://matthias-research.github.io/pages/publications/smallsteps.pdf)；此段以 pdftotext 內文與作者摘要為據）。對本專案的意義：web 上寧可跑 `n` 個 substep×1 iteration，也不要 1 步×`n` iteration。

### 1.4 計算成本（real-time web）

PBD/XPBD 的每步成本 ≈ `O(約束數 × substep 數)`，每個約束是幾個向量點積 + 一次除法，無矩陣解、無 SVD。這是本清單裡最便宜的連續體級方法，天生適合 JS/WASM。固定時間步 + 位置層求解 → 掉幀時仍穩定、行為可重現（符合 CLAUDE.md 對模擬核心的要求）。

### 1.5 可參考的一手／可信開源實作

- **Matthias Müller, "Ten Minute Physics" #10 "Simple and unbreakable simulation of soft bodies"** — 純 JS，XPBD，edge 約束 + **有號四面體體積**約束。程式碼：`solveEdges()` 用 `alpha = compliance/dt/dt`；`solveVolumes()` 計算 `C = getTetVolume(i) − restVol[i]`（`getTetVolume` 是 scalar triple product /6，**有號**），`s = −C/(w+alpha)`。`squash()` 把所有粒子壓到 `y=0.5` 然後放開，模擬會自己彈回——這就是「unbreakable」demo。抓取：把被抓粒子的 `invMass` 設 0，直接搬位置，放開時用位置差回推速度（[10-softBodies.html 原始碼](https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/10-softBodies.html)；教學索引 [tenMinutePhysics/index.html](https://matthias-research.github.io/pages/tenMinutePhysics/index.html)）。預設值 `edgeCompliance=100`, `volCompliance=0`（體積約束設成硬的）。
- **Ten Minute Physics #12 "100× speedup for soft body simulations"** — 低解析度四面體網格做物理，高解析度可視表面用 barycentric 權重「skin」上去，物理與算繪解耦（[12-softBodySkinning.html](https://matthias-research.github.io/pages/tenMinutePhysics/12-softBodySkinning.html)）。對本專案：模擬網格與貼圖網格可以是兩張網格。
- **InteractiveComputerGraphics/PositionBasedDynamics**（Bender 團隊，C++）— 官方參考實作，含 distance / area / volume / strain-based / shape-matching 約束（[GitHub](https://github.com/InteractiveComputerGraphics/PositionBasedDynamics)）。非 JS，但是演算法權威來源。

---

## 2. Shape Matching（Müller, Heidelberger, Teschner, Gross 2005，"Meshless Deformations Based on Shape Matching"）

**是什麼**：沒有內部約束、沒有彈簧。每一步：(1) 只用外力與碰撞回應把粒子推到 `x_i`；(2) 求一個把 rest 形狀 `x_i^0` 最佳匹配到目前形狀 `x_i` 的**剛體變換**（旋轉 `R` + 平移），得到每個粒子的 **goal position** `g_i`；(3) 把粒子拉向 goal：`Δx_i = α(g_i − x_i)`，`α∈[0,1]` 是勁度（[MeshlessDeformations_SIG05.pdf, §3–4](https://matthias-research.github.io/pages/publications/MeshlessDeformations_SIG05.pdf)）。

**數學**：最小化 `Σ w_i (R(x_i^0 − c^0) + c − x_i)²`。最佳平移就是兩個形狀的質心 `c^0, c`。最佳線性變換 `A = (Σ m_i r_i r_i^0ᵀ)(Σ m_i r_i^0 r_i^0ᵀ)⁻¹ = A_r A_s`；`A_s` 對稱不含旋轉，對 `A_r` 做 **polar decomposition** `A_r = RS` 取旋轉部分 `R`（[同上, §3.3；EG Tutorial §5.11.1](https://matthias-research.github.io/pages/publications/MeshlessDeformations_SIG05.pdf)）。

**為什麼每個粒子都有 goal position、與局部連結性無關**：goal position 由「整團的剛體最佳擬合」決定，`g_i = R(x_i^0 − c^0) + c`。粒子只要屬於這一團，不管它在網格裡連了幾條邊、在凹角尖端還是在肚子中央，都會被拉回它相對於剛體 rest 形狀的正確位置。**這直接命中使用者的「凹形尖角彈簧太少」問題**：尖角不需要靠鄰邊彈簧，它靠的是整體剛體擬合。

**對 inversion 的行為（一手，強）**：
- 摘要／貢獻列點：「The dynamic simulation is stable under all circumstances and for all deformed geometry configurations. The approach is not exposed to problems such as ill-shaped or inverted elements. Even non-manifold meshes with arbitrarily shaped triangles can be handled.」（[同上, §1 貢獻列點](https://matthias-research.github.io/pages/publications/MeshlessDeformations_SIG05.pdf)）
- 「the scheme is unconditionally stable and does not introduce [numerical] damping」；因為粒子被拉向**明確定義的 goal**，不會像顯式積分的彈簧那樣 overshoot 平衡點（[同上, §4](https://matthias-research.github.io/pages/publications/MeshlessDeformations_SIG05.pdf)）。
- Figure 11：擠壓一隻鴨子模型「demonstrates … the ability to recover from highly deformed or inverted configurations」。
- EG Tutorial 覆述：「Shape matching is a meshless approach … easy to implement, very efficient and unconditionally stable」（[EG Tutorial §5.11](http://animation.rwth-aachen.de/media/papers/2015-EG-Tutorial.pdf)）。

**大變形 → cluster / region-based shape matching**：單一 cluster 只允許對 rest 形狀「small deviations」。把物體切成**重疊**的 region，每個 region 各自 shape-match，粒子的最終 goal 是它所屬各 region goal 的加權平均——這樣每個 region 只小幅偏離、整體卻能大幅變形（[MeshlessDeformations §4.4；EG Tutorial §5.11.2](https://matthias-research.github.io/pages/publications/MeshlessDeformations_SIG05.pdf)）。Region 越大越硬。EG Tutorial §5.11.3 給了 lattice 上的 O(n) fast summation（Rivers & James FastLSM）。Tutorial §5.11 也描述了 **2D shape matching**（每三角形一個 region，用投影矩陣把問題壓到三角形平面，做 2D polar decomposition，[EG Tutorial §5.11 末段](http://animation.rwth-aachen.de/media/papers/2015-EG-Tutorial.pdf)）。

**勁度／穩定度／成本**：
- 勁度由 `α` 與 region 大小控制；`α=1` 時每步直接把粒子放到 goal（最硬），仍穩定、仍不引入阻尼（[MeshlessDeformations §4](https://matthias-research.github.io/pages/publications/MeshlessDeformations_SIG05.pdf)）。
- 成本：對粒子數線性；每個 cluster 每步一次 polar decomposition（2D 是 2×2，極便宜）。2005 年 Pentium 4 3.2GHz 上「384 objects, 2,448 clusters, 55,200 points」即時；quadratic shape matching 每 cluster 0.12 ms（[同上, §5 Results](https://matthias-research.github.io/pages/publications/MeshlessDeformations_SIG05.pdf)）。單顆果凍 + 幾十個 region 在現代手機瀏覽器上綽綽有餘。

**對本專案四大功能的契合度**：
- **釘住質心**：shape matching 已經在算質心 `c`；把 `c` 每步強制設回原點（或不更新平移分量）即可，質心鎖定是這個方法最自然的操作。抓一角拉到極限時，其餘粒子朝各自 goal 收斂到穩定態——正是使用者想觀察的「完全拉伸的穩定狀態」。
- **多重抓取**：抓取點就是把某些粒子的位置直接覆寫（或 `invMass=0`），shape matching 每步照常擬合剩下的；多個抓取點天然共存。
- 缺點：shape matching 對「局部細節保持」較弱（整體剛體傾向），要靠 region 數量調；純 shape matching 沒有內建碰撞／邊界，要另外加。

**可信開源實作**：`InteractiveComputerGraphics/PositionBasedDynamics`（C++，有 shape matching 約束）；`kwanchangnim/Jello-Physics`（Unity C#，Walaber JelloPhysics 的 port，核心就是「找最能匹配目前點位的剛體形狀」＝ shape matching，[GitHub](https://github.com/kwanchangnim/Jello-Physics)，二手 port）。JS 原生的成熟 shape-matching 函式庫沒有找到權威者——通常自己實作（數學很短）。

---

## 3. 加壓柔體（Pressure Model，Matyka & Ollila 2003；Walaber JellyCar）

### 3.1 Matyka 壓力模型

**是什麼**：2D 封閉輪廓，頂點放 point mass、輪廓邊放彈簧，**再加一個內部氣壓力**。氣壓由理想氣體定律 `P·V = n·R·T` → `P = n·R·T / V`（Matyka & Ollila 用 Clausius–Clapeyron 狀態方程表述，[SIGRAD 2003 條目摘要](https://ep.liu.se/en/conference-article.aspx?series=&issue=10&Article_No=7)）。每條邊受到一個沿**外法線**、大小正比於 `P × 邊長`的力，累加進該邊兩端點的力累加器。`V` 用多邊形面積（2D）或近似包絡（3D）計算。

**為什麼氣壓能撐住凹形不塌**：當輪廓被壓扁、面積 `V` 變小，`P = nRT/V` 上升，沿法線的外推力增大，把輪廓推回接近 rest 面積；凹處會被內壓「吹」出來，不依賴內部彈簧的數量或分佈。這對使用者「凹形尖角軟趴趴」問題是一條解法，但代價是**物體傾向變圓／膨脹**（見 3.2 Walaber 的評語）。

**限制（一手層級較弱）**：需要一個**封閉迴圈**輪廓才有「體積」可言；不連通（disconnected）的 alpha 區域要拆成多個各自封閉的迴圈分別加壓；純輪廓模型沒有內部質量分佈，難以模擬非均勻軟硬。

> ⚠️ **驗證程度**：Matyka 的一手 PDF「How To Implement a Pressure Soft Body Model」（`panoramx.ift.uni.wroc.pl/~maq/soft2d/howtosoftbody.pdf`）在調查當下伺服器 `ECONNREFUSED`，ResearchGate 鏡像回 403。上述「力沿法線、正比邊長、`P=nRT/V`、需封閉迴圈」是多個二手轉述一致的說法，並與 SIGRAD 2003 官方條目摘要（[ep.liu.se](https://ep.liu.se/en/conference-article.aspx?series=&issue=10&Article_No=7)）相符，但精確公式與面積算法細節**未經一手 PDF 核對**。

### 3.2 Walaber / JellyCar（Tim FitzRandolph，一手 dev deep-dive）

發表於 gamedeveloper.com 的作者本人深度剖析（[Deep Dive: The soft body physics of JellyCar](https://www.gamedeveloper.com/programming/deep-dive-the-soft-body-physics-of-jelly-car-explained)）。要點（作者原話）：

- 基礎是 **point masses**：「A spring is really just a force that acts on two Point Masses, trying to keep them a specific distance apart.」
- 防止塌陷／反轉的關鍵是 **shape matching**（作者稱之為虛擬的「rigid metal frame」）：「what if we could have some spring forces that know the shape of the object, and always tried to pull on the points to get them back to the original shape?」——由點位推出物體的中心與旋轉角，再施加把點拉回正確相對位置的力。作者說這讓劇烈變形（例如完全壓扁）也不會結構崩壞。
- **壓力模型是替代方案，但有取捨**：氣體內壓「will always sort of push objects to become round/inflated」，可能扭曲想要的形狀。
- shape matching 的注意事項：過度擠壓細長物體會產生「unrealistically big forces」，要監看力的大小。

**對本專案**：JellyCar 是最接近使用者需求的量產案例（2D、抓取、甩動、彈回、貼圖），它的答案是 **point mass + 邊彈簧 + shape matching**，而且它是在 2D 做的。JelloPhysics 原始碼為公開（C#；[Emanuele Feronato 對 Flash port 的介紹](https://emanueleferonato.com/2010/11/04/jellyphysics-soft-body-engine-for-flash/) 為二手）。

### 3.3 成本

壓力模型：每步一次多邊形面積（O(輪廓頂點數)）+ 每邊一個法線力，非常便宜；但通常搭配顯式彈簧積分，會有 overshoot／需要小步長或阻尼。整體比 shape matching 稍不穩，比 FEM 便宜得多。

---

## 4. FEM / co-rotational 彈性 + inversion handling（Irving, Teran, Fedkiw 2004，"Invertible Finite Elements For Robust Simulation of Large Deformation"）

**是什麼**：連續體有限元素模擬，核心貢獻是**讓本構模型在元素退化／反轉時仍給出合理的力**。做法：對變形梯度 `F = D_s D_m⁻¹` 做 SVD `F = U F̂ Vᵀ`（`U, V` 為純旋轉，`det=1`），在對角空間裡計算第一 Piola–Kirchhoff 應力 `P̂`，再轉回 `G = U P̂ B̂_m`（[ITF04, §3–6](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)）。

**「handles inversion」具體是什麼意思**：
- 當 `det F < 0`（元素翻面），標準 SVD 取全非負奇異值的慣例失效。ITF04 的做法：把「最小絕對值」那個奇異值取成負的（幾何直覺：翻正一個反轉四面體，最有效率是把離對面最近的那個頂點推過去），使 `det U = det V = 1` 維持純旋轉。「the signs of the entries must be chosen carefully in order to guarantee that the forces act to uninvert the tetrahedron」（[ITF04, §5](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)）。
- 本構模型在 flat state（`F̂` 有 0）附近做 C⁰／C¹ 延拓，並延伸進反轉區，使「The resulting forces always act to restore the tetrahedron to its original shape, allowing objects to recover cleanly from flat or inverted configurations」（[ITF04, §1](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)）。
- 對比：St. Venant–Kirchhoff 材料壓過頭會越壓越軟、翻面後力還把它「keep the element inverted」（[ITF04, §6](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)）；neo-Hookean 原點有奇異點（壓平需無限能量）能「防止」inversion，但代價是力任意大、系統任意硬、難積分，而且「preventing inversion also prevents the handling of situations where inversion is the desired, correct response」（[同上](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)）。

**與本專案高度相關的一段（mass-spring 的便宜替代）**：
> 「For mass-spring systems, altitude springs work surprisingly well [MBTF03]. … [CM97] introduced altitude springs to prevent triangles from collapsing. [MBTF03] later improved this model … If altitude springs are used correctly, not only is inversion not a problem, but the elements will work to un-invert. Unfortunately, spring systems do not allow the modeling of arbitrary constitutive models.」（[ITF04, §2](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)）

也就是說，如果你**不**需要精確的連續體本構模型（果凍玩具不需要），那麼在 mass-spring 上加 **altitude springs**（三角形每個頂點對其對邊的垂線加一條彈簧，把三角形「頂高」）或 **pseudo-pressure 項**（Palmerio 1994、Picinbono et al. 2001）就是一個 2D 原生、成本近乎為零、且會**主動翻正**的解法。相關一手來源：Cooper & Maddock 1997「Preventing collapse within mass-spring-damper models of deformable objects」；Molino, Bridson, Teran, Fedkiw 2003「A crystalline, red green strategy for meshing highly deformable objects with tetrahedra」（皆為 ITF04 引用文獻 [CM97]/[MBTF03]）。

**成本 vs PBD（web）**：
- ITF04 每個元素每步一次 3×3 SVD/eigen-solve（2D 為 2×2，便宜很多）。論文把 SVD 成本形容為相對 implicit velocity solve「negligible」——但那是 offline 語境（「computation times were generally under 20 minutes per frame for the largest meshes」，最大網格 357K 四面體；11K 元素的 torus 是 0.5–1 s/frame，[ITF04, §10](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)）。
- 完整 ITF04 用 Newmark + implicit damping + CG solve，對即時 web 而言重。**輕量化路線**是把「SVD 診斷反轉 + 對角空間本構」接到 XPBD 的 strain-based 約束上（EG Tutorial §5.8.1 明講可以這樣組合）。但那已經比「XPBD distance + signed-area」複雜不少。

**結論**：對果凍玩具，完整 invertible FEM 是殺雞用牛刀。真正該從這篇拿走的是：(a) inversion 的本質是「本構力對反射不敏感」，(b) signed-volume/area 或 altitude spring 或對角空間延拓都能讓力「主動翻正」，(c) 過度防 inversion（neo-Hookean 硬牆）會讓系統難積分——這對 web 效能是負面的。

---

## 5. 網格生成品質（欠彈尖角問題的另一半）

使用者的「凹形尖角軟趴趴」很大一部分是**三角化品質**問題，不是物理方法問題。

### 5.1 從 alpha 遮罩取輪廓（pipeline 前端）

- **Marching squares**：`RaumZeit/MarchingSquares.js` 對 2D scalar field 算 iso-lines / iso-bands，回傳封閉路徑陣列，「suitable for further processing like triangulation」（[GitHub](https://github.com/RaumZeit/MarchingSquares.js)）。AGPL-3.0，最後實質開發約 2018，穩定但非活躍維護。可把 alpha 當 scalar field、threshold 取 0.5。
- **OpenCV `findContours`**（若已用 opencv.js）：從二值遮罩抽輪廓階層，能處理有洞、不連通的區域。一手：[OpenCV 官方教學 "Contours: Getting Started"](https://docs.opencv.org/4.x/d4/d73/tutorial_py_contours_begin.html)。
- 之後通常再做多邊形簡化（Douglas–Peucker）降低輪廓頂點數。

### 5.2 三角化：品質保證 vs 純填充

- **earcut**（Mapbox）：ear-slicing，README 自述「favoring raw speed and simplicity over triangulation quality」，「doesn't guarantee correctness」，輸入不佳時「can be noticeably wrong — overlapping triangles, gaps, or triangles outside the polygon」（[earcut README](https://github.com/mapbox/earcut)）。它不插內部點、不設角度下界——**細長凹角會被切成 sliver 三角形**，這些 sliver 剛度病態、彈簧分佈稀疏，正是使用者觀察到的「尖角欠彈」。earcut 現在有一個獨立的 `refine()` 函式可做 Delaunay 品質後處理（同 README），但仍非 Steiner-point refinement。
- **poly2tri**（`r3m​i/poly2tri.js`）：基於 Domiter & Žalik「Sweep-line algorithm for constrained Delaunay triangulation」，支援輪廓、洞、Steiner points；但**只做 CDT，不做角度／面積品質細化**，且「only simple polygons are supported」、不容許 epsilon 內重複點（[GitHub](https://github.com/r3mi/poly2tri.js/)）。
- **cdt2d**（`mikolalysenko/cdt2d`）：PSLG 的 constrained Delaunay，可選 `interior`/`exterior`，README 自稱「the only non-broken triangulation library in JavaScript」（[GitHub](https://github.com/mikolalysenko/cdt2d)）。同樣是 CDT 本體，品質細化要自己補。
- **Triangle**（Shewchuk，C；JS 有 emscripten port 如 `triangle-wasm`）：這是「品質保證」的黃金標準。`-q` 施加**最小角約束**（Ruppert Delaunay refinement，理論保證最小角可到 20.7°，實務常達 33.8°，[Shewchuk quality meshing 頁](https://www.cs.cmu.edu/~quake/tripaper/triangle3.html)），`-a` 施加**最大面積約束**，靠在內部與邊界插入 Steiner points 消除 skinny 三角形：「A bad triangle is split by inserting a vertex at its circumcenter … the Delaunay property guarantees that the triangle is eliminated」（[同上](https://www.cs.cmu.edu/~quake/tripaper/triangle3.html)）。Triangle 產生「conforming … triangular meshes … with no small or large angles … suited for finite element analysis」（[Triangle 首頁](https://www.cs.cmu.edu/~quake/triangle.html)）。一手論文：Shewchuk, "Triangle: Engineering a 2D Quality Mesh Generator and Delaunay Triangulator"（1996）與 "Delaunay Refinement Algorithms for Triangular Mesh Generation"。

### 5.3 為什麼品質三角化 + 內部頂點就解掉欠彈尖角

- 純輪廓三角化（無內部點）在凹形細長處只能拉出扇形 sliver，那裡的模擬自由度與約束數都不足 → 尖角「軟」。
- 加最小角約束後，尖角區被 Steiner points 填成接近正三角形的元素，每個頂點有多條方向分佈良好的邊約束 → 尖角剛度與本體一致。
- 加內部頂點（`-a` 最大面積）讓整個 alpha 區域是一張二維實心網格而非一圈殼，配合 signed-area 約束或 shape matching，凹處不再是薄殼。
- **代價**：Steiner points 會改變網格拓撲，貼圖 UV 必須在三角化**之後**指定（每個頂點一組 UV = 該頂點在原圖的座標）。這對算繪端沒問題（見 §8），但表示「匯入 → 三角化 → UV → 模擬網格」要一次定案，不能中途改網格。

---

## 6. 現有 JS / web 物理引擎的柔體支援（回到原始碼與官方文件）

| 引擎 | 柔體支援（實際是什麼） | 一手來源 |
|---|---|---|
| **Matter.js** | `Composites.softBody` = 用 `Composites.stack` 排一個**圓形剛體網格**，再用 `Composites.mesh` 以 `Constraint`（可選對角 cross-brace）連起來，預設 `stiffness=0.2`。官方已標記 **deprecated**，導向 `examples/softBody.js`。本質是「一堆小圓 + 硬約束」的格子，**不是**連續體、無面積/體積約束、無 inversion 處理。 | [Composites.js 原始碼](https://github.com/liabru/matter-js/blob/master/src/factory/Composites.js) |
| **Rapier (dimforge, `rapier2d` wasm)** | **無內建柔體**。只有 rigid bodies + colliders + joints（fixed/revolute/prismatic/rope/spring 等）。官方文件無 soft body / deformable / FEM / particle 字樣。要做柔體須自行在 Rapier 之上疊 spring lattice（用 joint 或自寫約束），等於自己實作 mass-spring，Rapier 只幫你做碰撞與積分。Rapier 是 WASM 模組、有 determinism 頁。 | [Rapier JS getting started](https://rapier.rs/docs/user_guides/javascript/getting_started_js) |
| **planck.js / Box2D** | **無柔體 primitive**。官方 Box2D 文件：「a 2D rigid body simulation library for games」，body 型別只有 static/kinematic/dynamic 剛體；joint 有 revolute/prismatic/distance…，可帶 limit/motor/**spring**。社群做法「blob」＝一圈剛體 + 帶 frequency/damping 的 distance joint（軟彈簧），是二手技巧非官方功能。 | [Box2D 官方文件](https://box2d.org/documentation/)；[planck.js docs](https://piqnt.github.io/planck.js/docs/)；blob 技巧見 [Feronato（二手）](https://emanueleferonato.com/2012/09/21/step-by-step-creation-of-a-box2d-soft-body-blob/) |
| **LiquidFun (Google)** | 粒子式，有 **elastic particles / spring particles**（彈性粒子群 + 三角形彈性連結）、surface-tension、viscous 等 particle flag。可寫 C++/Java/**JavaScript**（emscripten testbed 在瀏覽器跑）。**維護狀態**：Google 官方倉庫多年未更新（實質停止維護），社群有 fork。粒子式柔體對「貼圖跟著變形的單一果凍」不是好底：形狀是湧現的、沒有穩定的 UV 網格。 | [LiquidFun 官網](https://google.github.io/liquidfun/) |
| **cannon-es** | **無柔體**。純剛體（pmndrs 維護的 cannon.js fork）。 | [cannon-es docs](https://pmndrs.github.io/cannon-es/docs/index.html)；引擎比較（二手）[mysimulator.uk](https://www.mysimulator.uk/content/references/physics-engines-comparison.html) |
| **ammo.js (Bullet, emscripten)** | 有 **`btSoftBody`**：cloth、rope、以及四面體網格的**體積柔體**；position-based 約束求解 + cluster 動力學；`setPose()` 保形、壓力係數 `kPR`、體積守恆 `kVC`。透過 `btSoftRigidDynamicsWorld` + `btSoftBodyHelpers`（`CreateRope`/`CreatePatch`/`CreateEllipsoid`）。這是使用者「3D→2D」假設最自然的底層——但見 §7，代價與 tet inversion 都要一起吞。 | [btSoftBody 類參考](https://pybullet.org/Bullet/BulletFull/classbtSoftBody.html)；[ammo.js btSoftBody.h](https://github.com/kripken/ammo.js/blob/main/bullet/src/BulletSoftBody/btSoftBody.h) |
| **Jolt (`jolt-physics` / JoltPhysics.js wasm)** | **有柔體**：`SoftBodySharedSettings` 定義 vertices + edge 約束（彈簧）+ **volume 約束**（保持四面體體積）+ bend/skin 約束，迭代求解（XPBD 風格）。`addVertex/addEdgeConstraint/addVolumeConstraint`，`createSoftBody()`。JoltPhysics.js「almost the entire Jolt interface has been exposed」，含 `SoftBodySharedSettings`；活躍維護。仍是 **3D** 四面體柔體（同樣有 tet inversion 顧慮）。 | [Jolt SoftBodySharedSettings](https://jrouwe.github.io/JoltPhysicsDocs/5.0.0/class_soft_body_shared_settings.html)；[JoltPhysics.js](https://github.com/jrouwe/JoltPhysics.js/) |
| **PhysX-js** | PhysX 5 有 FEM soft body / deformable volume，但 JS/WASM 綁定（如 `physx-js-webidl`）對 soft body 的暴露不完整且不穩定；未找到權威的「JS 端 soft body 可用」一手聲明。視為**現況不可靠**。 | （未找到可靠一手來源——標為 unverified）|
| **verlet-js (`subprotocol/verlet-js`)** | Verlet 積分 + 約束（DistanceConstraint / PinConstraint / AngleConstraint），內建 cloth、tire 等 composite。MIT。**維護狀態**：多年未實質更新（~2013–2015 後停滯），程式碼小、教學價值高，可直接讀來當 2D 約束物理骨架，但不建議當長期依賴。 | [verlet-js GitHub](https://github.com/subprotocol/verlet-js) |
| **專用 JS 果凍/blob 函式庫** | 未找到活躍維護、適合「貼圖果凍 + 釘質心 + 多抓取」的權威 JS 函式庫。`blob.js`、各種 `soft-body` npm 多為玩具/停更。最接近的參考是自寫（Ten Minute Physics 風格）或 port JelloPhysics。 | — |

**小結**：現成 JS 引擎裡，沒有一個能「開箱」滿足「2D、貼圖跟隨、釘質心、多抓取、可換邊界」。Rapier/planck/cannon-es 只給你剛體 + 碰撞 + 積分，柔體要自寫。ammo.js/Jolt 給你 3D 柔體（連 tet inversion 一起）。**最務實的是：自寫一個小的 2D XPBD 或 shape-matching 核心**（數學都很短），碰撞與邊界自己做（果凍玩具的邊界很簡單：牆是 AABB／半平面，無限就是不加牆 + 相機跟隨）。

---

## 7. 「3D 模擬 → 2D 顯示」與 2.5D 果凍的 prior art

### 7.1 有沒有人刻意這樣做？

**沒有找到一手來源**顯示有遊戲／知名 WebGL demo「為了迴避 2D 的 inversion／自摺，故意在 3D 模擬果凍再壓平顯示」。實際的 2.5D 變形 sprite 案例都是**幾何驅動、不是為了迴避 inversion**：

- **Unity「Jelly Sprites」**（資產商店外掛）：「generates a set of rigid bodies linked by spring joints whose movement is used to influence the mesh of the sprite」，可用 Unity 的 3D 或 2D 物理系統（[Unity 論壇官方 showcase 貼文](https://forum.unity.com/threads/jelly-sprites-soft-body-sprite-physics-system.215305/)，二手）。它「可以」用 3D 剛體，但那些剛體是共平面的，本質仍是 2D 佈局；用 3D physics 只是圖方便，不是為了 inversion。
- **JellyCar / JelloPhysics**：明確 2D（§3.2）。
- cloth/shell 模擬雖是「3D 曲面」，但那是因為布本來就在 3D 飄；沒有人把「桌上一塊 2D 果凍」抬到 3D 曲面去算。

### 7.2 3D 四面體網格有它自己的 inversion 問題（明確一手來源）

- Irving–Teran–Fedkiw：「standard finite element simulation algorithms fail as soon as a single tetrahedron inverts」；「element inversion can occur even if the vertex positions of the mesh are identical to their true continuum values」；「Even if an object as a whole deforms by only a small amount, say 10%, an individual tetrahedron may undergo severe deformation due to errors in the discrete representation」；「large deformation and inversion can arise even when simulating incompressible material, since one typically cannot conserve volume for each individual tetrahedron」（[ITF04, §1](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)）。一個典型 Buddha 模擬幀有 ~8% 的四面體是反轉的（[ITF04, §10](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)）。
- Bender/Müller/Macklin：「common constitutive models are not designed to handle degenerate or inverted tetrahedral elements」，要靠 ITF04 的手術（[EG Tutorial §5.8.1](http://animation.rwth-aachen.de/media/papers/2015-EG-Tutorial.pdf)）。
- 反面對照：在 3D 裡自由飄動的**布（三角形，2-manifold in 3-space）** 不會 inversion，因為「an inverted triangle is indistinguishable from a triangle that has been rotated 180° out of plane」（[ITF04, §8](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)）。**但這個豁免只適用薄殼**——一塊有厚度、要保持朝向桌面的果凍，如果用四面體實心網格，就回到「tet 會反轉」。而如果用薄殼三角網格擺在 3D 裡，你其實只是換個座標系做 2D 模擬（多了一個用不到的維度）。

### 7.3 走 3D 的效能倍數

- 元素數：把一塊 2D 區域三角化成 `T` 個三角形，vs 把同樣輪廓 + 厚度 extrude 後四面體化，通常每個「格子」要 5–6 個四面體，再加內部層 → 元素數是同解析度 2D 的數倍。
- 每元素運算：2D 的 shape matching / co-rotational 是 2×2 polar decomposition；3D 是 3×3 SVD（更貴，且要小心 `det<0` 的號位處理）。向量從 2 分量變 3 分量。
- 碰撞／邊界：桌面在 2D 是幾條線；在 3D 變成平面 + 果凍底面自碰撞的顧慮。
- 沒有找到量化「N 倍」的一手數字，但方向明確：3D 是純增本，且把使用者想避開的 inversion 以更難處理的形式帶回來。

### 7.4 結論：假設不被 prior art 支持

「3D → 2D 顯示」不是這個 use case 的標準答案，也沒有一手案例是為了解 inversion 而這樣做。**標準答案是留在 2D**，用 signed-area PBD/XPBD 約束、shape matching、altitude springs 或內壓其中之一（或組合）處理 inversion 與凹角欠彈；對 web 效能也是留在 2D 划算。

---

## 8. 貼圖網格變形（簡述）

匯入的圖要跟著變形後的模擬網格扭曲，兩條路：

- **WebGL 每頂點 UV 三角網格（建議）**：一張 `MeshGeometry`＝`vertices`（每步從模擬更新）＋`uvs`（三角化後一次指定，= 頂點在原圖的正規化座標）＋`indices`（三角化拓撲，固定）。PixiJS 把這做成一等公民：`Mesh` +「`MeshGeometry` … stores vertex positions, UV coordinates, and face indices」，「per-vertex texture-mapped mesh deformation a native capability」（[PixiJS Mesh 文件](https://pixijs.download/release/docs/scene.Mesh.html)）。也有 `MeshSimple`（直接給 vertices/uvs/indices）、`MeshPlane`、`PerspectiveMesh`。一次 draw call、GPU 內插、無接縫。
- **Canvas 2D 逐三角形 `drawImage` + clip（不建議）**：對每個三角形設 clip path、套仿射變換近似貼該三角形的貼圖。慢（每三角一次 save/clip/transform/restore）、三角形邊界有接縫與抖動、只能仿射（不能透視校正）。僅在完全不能用 WebGL 時的退路。

**對模擬網格的約束**：算繪端要的是「拓撲穩定 + 有 UV」的三角網格。這代表：三角化（含 Steiner points）與 UV 指定必須在匯入時一次定案，之後模擬只動頂點位置、不動 `indices`／`uvs`。模擬網格與貼圖網格可以是同一張（簡單），也可以分離（模擬用粗網格、貼圖用細網格 + barycentric skin，見 §1.5 的 Ten Minute Physics #12）。

---

## 9. 比較表

| 技術 | 解決 inversion？ | 解決凹形尖角欠彈？ | Web 效能 | 可作起點的開源實作 |
|---|---|---|---|---|
| 純 mass-spring（使用者現況） | ❌ 翻面態是另一個平衡點，彈簧看不出反射 | ❌ 尖角靠鄰邊彈簧，數量不足就軟 | ⭐⭐⭐ 最便宜 | verlet-js（[GitHub](https://github.com/subprotocol/verlet-js)，停更） |
| mass-spring + **altitude / pseudo-pressure springs** | ✅ ITF04：「elements will work to un-invert」（[§2](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)） | ⚠️ 部分：三角形不再塌，但尖角剛度仍受三角化品質影響 | ⭐⭐⭐ 幾乎零額外成本 | 自寫；一手依據 Cooper–Maddock 1997、Molino et al. 2003（ITF04 引用） |
| **PBD/XPBD，只有 distance 約束** | ❌ 同純彈簧 | ❌ | ⭐⭐⭐ 便宜、無矩陣解 | Ten Minute Physics #5/#9（[索引](https://matthias-research.github.io/pages/tenMinutePhysics/index.html)） |
| **PBD/XPBD + 有號 area/volume 約束** | ✅ `C=area−restArea` 翻面變號，梯度把元素翻正；Müller 稱「unbreakable」 | ⚠️ 面積約束讓實心網格不塌陷；尖角剛度仍需好三角化 | ⭐⭐⭐ 每元素幾個點積 + 一次除法 | Ten Minute Physics #10（[原始碼](https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/10-softBodies.html)）；PositionBasedDynamics（[C++](https://github.com/InteractiveComputerGraphics/PositionBasedDynamics)） |
| **Shape matching（單 cluster）** | ✅ 「not exposed to … inverted elements」「recover from … inverted configurations」（[§1, Fig.11](https://matthias-research.github.io/pages/publications/MeshlessDeformations_SIG05.pdf)） | ✅ goal position「regardless of local connectivity」，尖角被剛體擬合拉回 | ⭐⭐⭐ 每 cluster 一次 2×2 polar decomp | PositionBasedDynamics；Jello-Physics（[port](https://github.com/kwanchangnim/Jello-Physics)） |
| **Region/lattice shape matching** | ✅ 同上 | ✅ 同上，且可調局部剛度 | ⭐⭐ region 越多越貴；lattice 有 O(n) fast summation | PositionBasedDynamics；EG Tutorial §5.11（[PDF](http://animation.rwth-aachen.de/media/papers/2015-EG-Tutorial.pdf)） |
| **內壓模型（Matyka / JellyCar 的替代方案）** | ⚠️ 內壓抵抗塌陷，但不「翻正」已反轉的元素；JellyCar 用 shape matching 才真正防反轉 | ✅ 氣壓把凹處撐開，不靠內部彈簧數 | ⭐⭐⭐ 每步一次多邊形面積 + 每邊法線力 | JelloPhysics（C#）；一手 PDF 未能取得（§3.1 警告） |
| **Co-rotational FEM + ITF04 invertible** | ✅✅ 這就是它的定義：SVD 對角空間延拓，力「always act to restore … original shape」 | ✅（連續體，尖角有正確應力）但仍需品質網格 | ⭐ 每元素每步 SVD + implicit solve；完整版對即時 web 偏重 | sofa-framework/InvertibleFVM（[GitHub](https://github.com/sofa-framework/InvertibleFVM)，SOFA 內，C++） |
| **Air mesh（單側 area 約束填充空隙）** | ✅ 「air meshes have a memory. Even if a scene is completely flattened … objects pop up in the correct order」（[EG Tutorial §5.5.4](http://animation.rwth-aachen.de/media/papers/2015-EG-Tutorial.pdf)） | ➖ 主要解碰撞／糾纏，不直接針對單體尖角 | ⭐⭐ 需維護外圍空氣三角化 | Müller et al. 2015「Air Meshes for Robust Collision Handling」 |
| **3D tet PBD/FEM → 壓成 2D 顯示（使用者假設）** | ❌ 反而引入 tet 自身 inversion（[ITF04 §1](https://math.ucdavis.edu/~jteran/papers/ITF04.pdf)），還是得接 ITF04 手術 | ➖ 與 2D 同樣看三角/四面體化品質 | ⭐ 元素數數倍、3×3 SVD、3-vector、底面自碰撞 | ammo.js `btSoftBody`、JoltPhysics.js soft body（皆 3D） |

⭐⭐⭐ = 適合低階手機瀏覽器即時；⭐ = 偏重，需謹慎預算。

---

## 10. 對本專案的建議方向

1. **留在 2D。** 沒有 prior art 支持「3D→2D」，而且它把 inversion 以更貴、更難的形式帶回來（§7）。web 效能與 itch.io 靜態包的限制都指向 2D。
2. **主結構選一：**
   - **XPBD：distance 約束 + 有號（signed）area 約束**，多 substep×1 iteration（§1.3）。signed-area 直接讓翻面元素自我翻正（§1.2、§1.5），面積約束讓實心網格不塌，compliance 讓「軟硬」對時間步/迭代數穩定。這是 Ten Minute Physics #10 的路線，程式碼量小、每元素成本 = 幾個點積。
   - **或 region-based shape matching**：對「**釘住質心、抓一角拉到極限、觀察穩定態**」這個核心需求特別契合——質心 `c` 是方法內建量，鎖定它只是「每步把 `c` 設回原點」；goal position 是穩定吸引子，拉到極限後其餘粒子乾淨收斂、不 overshoot、不 inversion（§2）。多抓取 = 覆寫若干粒子位置後照常擬合。
   - 兩者可並用：shape-matching 作全域「回原形」傾向 + 少量 distance/area 約束保局部細節。JellyCar 的量產配方就是「point mass + 邊彈簧 + shape matching」（§3.2）。
3. **網格：** 用品質保證的 constrained Delaunay refinement（Triangle `-q -a`，或其 wasm port）取代 earcut，帶最小角約束 + 內部頂點（§5）。前端用 marching squares / `findContours` 從 alpha 取輪廓 + Douglas–Peucker 簡化。不連通 alpha → 多個獨立元件各自三角化。三角化 + UV 在匯入時一次定案，之後只動頂點位置。
4. **邊界可換：** 把碰撞環境做成介面（`resolveBoundary(particles)`）。有牆 = AABB／半平面約束；無限 = 空實作 + 相機跟隨。這與 CLAUDE.md 的「可替換邊界」筆記一致，PBD/shape-matching 都不在乎邊界怎麼實作。
5. **相機：** 由質心 + bounding box 驅動的 world→screen 變換，平滑 + zoom-to-fit；所有繪製與 picking 都過它。
6. **算繪：** WebGL 每頂點 UV 三角網格（PixiJS `Mesh`/`MeshSimple` 或自寫 shader），不要 Canvas 2D 逐三角 `drawImage`（§8）。可選：模擬粗網格 + 貼圖細網格 barycentric skin（Ten Minute Physics #12）。

### 給後續 `/grill-with-docs` 的未決問題（不要單方面拍板）

- **XPBD-signed-area vs shape-matching 作為主結構**：前者局部細節較好、需要好三角網格；後者「拉到極限穩定態」與「釘質心」最乾淨，但整體剛體傾向強、局部保形弱。要用哪個當骨幹？還是並用、比例多少？
- **使用者過去 mass-spring 失敗的細節**：當時是顯式積分嗎？有沒有 area/altitude 約束？三角化是 ear-clipping 嗎？——先確認失敗根因是「方法」還是「積分器 + 三角化品質」，可能不需要換方法論，只需換三角化 + 加 signed-area。
- **不連通 alpha 的語意**：多個元件是各自獨立的果凍（各自釘質心？）還是視為一個物件的多個部分？影響「釘住質心」與多抓取的定義。
- **Triangle 的授權**：Shewchuk Triangle 非商業授權有限制；`poly2tri` + 自寫品質細化、或 `cdt2d`、或找 MIT 的 refinement 實作，需要確認 itch.io 發佈可用的授權組合。
- **substep 預算**：低階手機上每幀能負擔幾個 substep？決定 compliance 調校範圍與可達剛度。

---

## 11. 來源清單

### 一手來源（primary）

**論文（作者官方託管 PDF，已用 pdftotext 核對內文）**
- Müller, Heidelberger, Hennix, Ratcliff — *Position Based Dynamics*, VRIPhys 2006 — <https://matthias-research.github.io/pages/publications/posBasedDyn.pdf>
- Macklin, Müller, Chentanez — *XPBD: Position-Based Simulation of Compliant Constrained Dynamics*, MIG 2016 — <https://matthias-research.github.io/pages/publications/XPBD.pdf>
- Müller, Heidelberger, Teschner, Gross — *Meshless Deformations Based on Shape Matching*, SIGGRAPH 2005 — <https://matthias-research.github.io/pages/publications/MeshlessDeformations_SIG05.pdf>
- Macklin, Storey, Lu, Terdiman, Chentanez, Jeschke, Müller — *Small Steps in Physics Simulation*, SCA 2019 — <https://matthias-research.github.io/pages/publications/smallsteps.pdf>
- Bender, Müller, Macklin — *Position-Based Simulation Methods in Computer Graphics* (EG 2015/2017 tutorial；內容對應 Bender et al., *A Survey on Position-Based Simulation Methods in Computer Graphics*, CGF 33(6), 2014) — <http://animation.rwth-aachen.de/media/papers/2015-EG-Tutorial.pdf> ；期刊版 <https://onlinelibrary.wiley.com/doi/10.1111/cgf.12346> ；<https://diglib.eg.org/items/95340e92-e676-4455-a5c2-6d59fe0667d0>
- Irving, Teran, Fedkiw — *Invertible Finite Elements For Robust Simulation of Large Deformation*, SCA 2004 — <https://math.ucdavis.edu/~jteran/papers/ITF04.pdf> ；鏡像 <http://physbam.stanford.edu/papers/stanford2004-08.pdf>
- Matyka, Ollila — *A Pressure Model for Soft Body Simulation*, SIGRAD 2003（官方條目；一手全文 PDF 於調查時無法連線）— <https://ep.liu.se/en/conference-article.aspx?series=&issue=10&Article_No=7>
- Shewchuk — *Triangle: A Two-Dimensional Quality Mesh Generator and Delaunay Triangulator*（首頁與 quality-meshing 說明）— <https://www.cs.cmu.edu/~quake/triangle.html> ；<https://www.cs.cmu.edu/~quake/tripaper/triangle3.html>
- Cooper & Maddock 1997 *Preventing collapse within mass-spring-damper models of deformable objects*；Molino, Bridson, Teran, Fedkiw 2003 *A crystalline, red green strategy for meshing highly deformable objects with tetrahedra* — 皆為 ITF04 §2 引用文獻（altitude springs 的一手依據），未單獨取得 PDF

**原始碼 / 官方文件**
- Matthias Müller — *Ten Minute Physics*（教學索引、#10 soft bodies「unbreakable」、#12 skinning）— <https://matthias-research.github.io/pages/tenMinutePhysics/index.html> ；<https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/10-softBodies.html> ；<https://matthias-research.github.io/pages/tenMinutePhysics/12-softBodySkinning.html>
- InteractiveComputerGraphics/PositionBasedDynamics（Bender 團隊參考實作）— <https://github.com/InteractiveComputerGraphics/PositionBasedDynamics>
- Tim FitzRandolph (Walaber) — *Deep Dive: The soft body physics of JellyCar, explained*（開發者本人一手剖析）— <https://www.gamedeveloper.com/programming/deep-dive-the-soft-body-physics-of-jelly-car-explained>
- Matter.js `Composites.js`（`softBody` 原始碼，已標 deprecated）— <https://github.com/liabru/matter-js/blob/master/src/factory/Composites.js>
- Rapier JS 使用指南（無 soft body）— <https://rapier.rs/docs/user_guides/javascript/getting_started_js>
- Box2D 官方文件（rigid body only）— <https://box2d.org/documentation/> ；planck.js 文件 — <https://piqnt.github.io/planck.js/docs/>
- LiquidFun 官方頁（elastic/spring particles；維護停滯）— <https://google.github.io/liquidfun/>
- Bullet `btSoftBody` 類參考 — <https://pybullet.org/Bullet/BulletFull/classbtSoftBody.html> ；ammo.js `btSoftBody.h` — <https://github.com/kripken/ammo.js/blob/main/bullet/src/BulletSoftBody/btSoftBody.h>
- cannon-es 文件（rigid only）— <https://pmndrs.github.io/cannon-es/docs/index.html>
- Jolt `SoftBodySharedSettings` 類參考 — <https://jrouwe.github.io/JoltPhysicsDocs/5.0.0/class_soft_body_shared_settings.html> ；JoltPhysics.js — <https://github.com/jrouwe/JoltPhysics.js/>
- earcut README（明說犧牲品質換速度）— <https://github.com/mapbox/earcut>
- poly2tri.js — <https://github.com/r3mi/poly2tri.js/> ；cdt2d — <https://github.com/mikolalysenko/cdt2d>
- MarchingSquares.js — <https://github.com/RaumZeit/MarchingSquares.js> ；OpenCV `findContours` 教學 — <https://docs.opencv.org/4.x/d4/d73/tutorial_py_contours_begin.html>
- verlet-js — <https://github.com/subprotocol/verlet-js>
- PixiJS `Mesh` / `MeshGeometry` 文件 — <https://pixijs.download/release/docs/scene.Mesh.html>
- sofa-framework/InvertibleFVM（ITF04 的開源實作，SOFA 內）— <https://github.com/sofa-framework/InvertibleFVM>

### 二手來源（secondary，僅作佐證或背景，未用於載重主張）

- physicsbasedanimation.com — XPBD 摘要 — <https://www.physicsbasedanimation.com/2016/09/13/xpbd-position-based-simulation-of-compliant-constrained-dynamics/>
- Emanuele Feronato — Box2D soft body blob 教學（distance joint + frequency/damping）— <https://emanueleferonato.com/2012/09/21/step-by-step-creation-of-a-box2d-soft-body-blob/> ；JellyPhysics for Flash — <https://emanueleferonato.com/2010/11/04/jellyphysics-soft-body-engine-for-flash/>
- Unity 論壇 — *Jelly Sprites* showcase 貼文（rigid bodies + spring joints 驅動 sprite mesh）— <https://forum.unity.com/threads/jelly-sprites-soft-body-sprite-physics-system.215305/>
- kwanchangnim/Jello-Physics — Walaber JelloPhysics 的 Unity C# port — <https://github.com/kwanchangnim/Jello-Physics>
- lisyarus blog — *Making a 2D soft-body physics engine*（個人開發者第一手經驗談，但非學術/官方）— <https://lisyarus.github.io/blog/posts/soft-body-physics.html>
- JavaScript 物理引擎比較 — <https://www.mysimulator.uk/content/references/physics-engines-comparison.html>
- Wikipedia — *JellyCar* — <https://en.wikipedia.org/wiki/JellyCar>

### 未能驗證 / 待補

- Matyka *How To Implement a Pressure Soft Body Model* 一手 PDF（`panoramx.ift.uni.wroc.pl/~maq/soft2d/howtosoftbody.pdf`）：伺服器於調查時拒絕連線；壓力力的精確分佈公式與面積算法細節**未經一手核對**，§3.1 內容以二手轉述 + SIGRAD 2003 官方摘要為據。
- PhysX-js soft body 在 JS/WASM 的可用性：未找到權威一手聲明，§6 標為 unverified。
- 「3D 走一趟的效能是 2D 的 N 倍」：無量化一手數字，§7.3 僅給定性方向。
