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
同時存在的一組彼此獨立的 Grab。v1 由多指／多指標即時操作產生；v2 素材工具另外可用疊加播放多條各自單指標錄製的 Action Track 做出同樣效果，讓只有單一滑鼠的使用者也能做出多點同時抓取的演出。
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
Camera 由 Jelly 的 bounding box 自動平移縮放的行為（平移對準 bbox 中心、縮放 zoom-to-fit，與「框住果凍」同錨點）。使用者手動平移／縮放時暫停，閒置後緩動回歸；「鎖定跟隨」開關可完全關閉。
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
一段錄下的事件流，在共同時間軸上有起始時間、可修剪頭尾。分兩種：**Action Track** 與 **Camera Track**。多條 Track 疊加播放組成一段素材，供外部影片剪輯用（不是給 itch.io 頁面本身）。核心動機：使用者通常只有單一指標（一支滑鼠），疊加多條各自單指標錄下的 Action Track 是在單指標裝置上做出 Multi-grab 效果的手段（見 ADR-0005、ADR-0007）。
_Avoid_: recording、clip、layer、圖層

**Action Track（動作軌）**：
只含指標事件（Grab／Tap／Pin 等）的 Track。可多條，時間軸上可自由重疊——那正是疊出 Multi-grab 的用途。
_Avoid_: pointer track、input track、指標軌（口語可，正式用「動作軌」）

**Camera Track（相機軌）**：
只含相機操作（平移／縮放／框住果凍／鎖定跟隨）的 Track，並帶錄製當下的鏡頭快照。播放到其起始時間即硬切到該快照、再放相對位移量。相機軌之間在時間軸上**不得重疊**（同一時刻只有一個鏡頭；重疊時軟警告標紅，播放時只認先列那條）。重疊判定只看「開啟中群組聯集」裡的相機軌 ── 關掉某群組後只屬於它的相機軌不再參與（見 ADR-0008）。沒有相機軌在作用時，鏡頭停在框好果凍的靜止狀態。
_Avoid_: viewport track、運鏡軌（口語可）

**Recording target（錄製目標）**：
按下錄製前選定這次要錄哪一路：只錄動作／只錄運鏡／兩者同時。「兩者同時」一次產出一條 Action Track 加一條 Camera Track。單頻道錄製時，另一路的操作即時生效但不會被錄進去。
_Avoid_: mode、channel、頻道

**Trim（修剪）**：
一條 Track 播放時只取其本地時間 in／out 之間的片段（頭尾各切掉一段），讓使用者能錄鬆一點再收緊，不必重錄。修掉開頭後，剩餘內容仍從該 Track 的起始時間開始播。
_Avoid_: crop、cut、剪裁

**Overlay（疊加播放）**：
開啟中群組的成員 Track 各自依起始時間與修剪範圍，在同一條時間軸上一起播放，讓分開錄製的操作在時間上重疊生效。是 Track 之所以要「多條」而非「一條錄到底」的原因。（沒有群組被關掉時＝全部 Track 一起播。）
_Avoid_: merge、combine、合併

**群組（Group）**：
把已錄的 Track 分組的具名容器，用途是逐一比較各群組單獨播放的效果。多對多 ── 一條 Track 可屬多個群組，一個群組含多條 Track。每個群組帶開啟／關閉狀態；播放時取所有開啟中群組的成員 Track 聯集，照 Overlay 規則一起播（一條 Track 同時屬多個開啟中群組只算一次）。永遠有一個**預設群組**：新錄好的 Track 自動加入，也是 Track 被移出最後一個群組時的歸屬。分群是進階操作 ── 不手動分群時全部 Track 都在預設群組，行為等同「所有 Track 一起疊加」。隨片段保存（`停止／重設` 保留、重新匯入 PNG 清空）。見 ADR-0008。
_Avoid_: layer、圖層、variant、變體、tag、標籤、scene

**片段初始 Pin（Clip initial pins）**：
一份在片段開始前就該存在的 Pin 佈局快照，獨立於任何 Track。使用者擺好 Pin 後明確拍下；疊加播放在 `sim.reset()` 之後、跑合併時間軸之前，於 step 0 一次還原，之後照常播放。存的是附著點在 rest 形狀下的座標，不隨拍快照當下的變形而偏。與「錄進 Action Track 的 `pin` 事件」不同：後者是有時序的**效果**（某秒才出現），前者是從第 0 秒就在的**佈景**。隨片段保存（`停止／重設` 保留、重新匯入 PNG 清空，見 ADR-0007 追記）。
_Avoid_: setup pin、pre-pin、預釘

**清除 Pin 事件（Clear-pins event）**：
一個無指標 id 的輸入事件，錄進 Action Track（由「清除所有 Pin」按鈕在錄製中觸發）。重播到其排定的 step 時清掉**畫面上所有 Pin**——所有動作軌放的、以及片段初始 Pin，全部清掉。刻意跨軌：它是使用者明確錄下的動作，「把畫面清乾淨」就是意圖（見 ADR-0007 追記）。像 `Tap` 一樣受該軌起始時間與修剪支配、不能單獨編輯。
_Avoid_: unpin all、reset pins、clear all

**Demo（內建示範）**：
專案內建、以程式碼寫成的預設操作序列，透過與即時輸入相同的介面驅動 Jelly。用來教學或展示。
_Avoid_: tutorial、scenario、範例
