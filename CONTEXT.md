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
把 Jelly 表面某一點附著到指標位置的軟約束。附著點以「所屬三角形 + 重心座標」表示，不吸附到 Particle 頂點（見 ADR-0003）。
_Avoid_: pinch、hold、drag handle、拖曳點

**Attach point（附著點）**：
一個 Grab 抓住的表面點，隨網格變形而移動；由三角形三頂點的重心加權得出。
_Avoid_: 抓取點（易與指標位置混淆）、grabbed vertex

**Multi-grab（多重抓取）**：
同時存在的一組彼此獨立的 Grab。v1 由多指／多指標即時操作產生；v2 素材工具另外可用疊加播放多條各自單指標錄製的 Track 做出同樣效果（見 Track），讓只有單一滑鼠的使用者也能做出多點同時抓取的演出。
_Avoid_: 多點觸控抓取

**Fling（甩動）**：
放開 Grab 時，帶著近期指標移動推算出的速度離手。
_Avoid_: throw、toss、swipe、拋

**Tap（輕拍）**：
在 Jelly 表面某點快速按下即放開（不拖曳），對該處附近施加一次性向內徑向脈衝，讓 Jelly 凹一下再彈回。
_Avoid_: poke、click、戳

**Pin（釘選）**：
把 Jelly 表面某一點絕對鎖定在某個世界座標的約束——就是「目標點被凍結、不再跟指標」的 Grab。數量不限；用力甩、Tap 都拔不掉；可拖到新位置重新鎖定。沒有「鎖定質心」的獨立模式，要固定中心就在附近放幾個 Pin（見 ADR-0004）。
_Avoid_: lock、fix、錨定（一般動詞）、centroid lock

**Camera follow（相機跟隨）**：
Camera 由 Jelly 的質心／bounding box 自動平移縮放的行為。使用者手動平移／縮放時暫停，閒置後緩動回歸；「鎖定跟隨」開關可完全關閉。
_Avoid_: auto-cam、tracking

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

**Track（軌）**：
一段錄下的輸入事件流——通常是一次「按下到放開」的抓取（加可選的結尾 Pin），或一次 Tap，或一段相機操作。多條 Track 各設起始時間、疊加播放，組成一段素材。核心動機：使用者通常只有單一指標（一支滑鼠），疊加多條各自單指標錄下的 Track 是在單指標裝置上做出 Multi-grab 效果的手段，而非單純的多軌剪輯功能。素材供外部影片剪輯用，不是給 itch.io 頁面本身。屬 v2 素材工具（見 ADR-0005）。
_Avoid_: recording、clip、layer、圖層

**Overlay（疊加播放）**：
多條 Track 各自設定起始時間後同時播放，讓分開錄製的操作在時間軸上重疊生效。是 Track 之所以要「多條」而非「一條錄到底」的原因。
_Avoid_: merge、combine、合併

**Demo（內建示範）**：
專案內建、以程式碼寫成的預設操作序列，透過與即時輸入相同的介面驅動 Jelly。用來教學或展示。
_Avoid_: tutorial、scenario、範例
