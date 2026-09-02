# 果凍沙盒（Jelly Sandbox）

一個物理模擬的網頁沙盒小遊戲：使用者匯入一張帶 alpha 的 PNG，其不透明區域變成一塊可抓取、拖曳、甩動、回彈的柔體，最終以靜態網站包發佈到 itch.io。本檔是詞彙表，只定義專案特有的用語，不含實作細節。

## Language

**Jelly（果凍）**：
由匯入圖片的不透明區域生成、擺在桌面上的那一塊可變形柔體。任一時刻桌上只有一塊。
_Avoid_: soft body、blob、物件、toy

**Particle（質點）**：
Sim mesh 的一個頂點，帶有質量、位置、速度；是求解器推進的最小單位。
_Avoid_: node、point mass、頂點（指模擬時）

**Sim mesh（模擬網格）**：
Jelly 不透明區域的三角化，其頂點即 Particle。求解器在其上運作。
_Avoid_: physics mesh、collision mesh、碰撞網格

**Texture mesh（貼圖網格）**：
帶每頂點 UV、供原圖貼上去算繪的三角網格。v1 與 Sim mesh 是同一張。
_Avoid_: render mesh、display mesh、算繪網格

**Region**：
把鄰近 Particle 分組供 shape matching 使用的一個重疊 lattice cell。其邊長決定該處的 Softness。
_Avoid_: cluster、patch、群集

**Softness（軟硬度）**：
Jelly 對使用者呈現的軟硬程度，由 Region 邊長與 shape-matching 混合係數共同決定。
_Avoid_: stiffness、elasticity、彈性、Q 度

**Grab（抓取）**：
把單一 Particle 固定到某個指標位置的約束。
_Avoid_: pinch、hold、drag handle、拖曳點

**Multi-grab（多重抓取）**：
同時存在的一組彼此獨立的 Grab。
_Avoid_: 多點觸控抓取

**Fling（甩動）**：
放開 Grab 時，帶著近期指標移動推算出的速度離手。
_Avoid_: throw、toss、swipe、拋

**Pin（釘選）**：
一種模式，把 Jelly 的質心絕對錨定在原點；被錨定時抓取只拉動被抓的一角，質心不動。
_Avoid_: lock、fix、錨定（一般動詞）

**Boundary（邊界）**：
求解器所對的可替換碰撞環境。兩種：**Walled**（有限桌面，牆壁擋住 Jelly）與 **Infinite**（無牆、無限延伸）。
_Avoid_: wall、container、bounds、桌面

**Camera（相機）**：
讓 Jelly 持續留在畫面內的世界→螢幕轉換，帶平滑與 zoom-to-fit。所有繪製與 picking 都經過它。
_Avoid_: viewport、view、視角

**Alpha mask（Alpha 遮罩）**：
從匯入 PNG 的 alpha 通道取得的「不透明／透明」二值圖。
_Avoid_: silhouette、stencil、剪影

**Contour（輪廓）**：
從 Alpha mask 描出的多邊形外框，是三角化的輸入。
_Avoid_: outline、boundary（已被 Boundary 佔用）、edge loop、剪影
