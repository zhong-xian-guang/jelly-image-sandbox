/**
 * `PinMarkers`（issue #14 追加：Pin 位置的視覺提示）——把每個 Pin 目前的螢幕座標
 * 畫成一個小標記，疊在畫布上。
 *
 * 純 DOM 覆蓋層：不知道 `SimCore`／相機的存在，每幀由呼叫端（`JellySandbox`）
 * 把投影好的螢幕座標餵進來（`update`）。節點用 `id` 索引重用，不會每幀整批
 * 重建 DOM。`pointer-events: none`——標記本身不接手勢；「點掉特定 Pin」是靠
 * 世界座標鄰近判定（見 `../input/pinModeRouting`），不是靠點中這個 DOM 節點，
 * 這樣命中判定跟其餘輸入邏輯走同一條純函式路徑、不必另外處理 DOM 命中測試。
 */

export interface PinMarkerPoint {
  /** 穩定的 DOM key——呼叫端把 `PinInfo.id`（`PointerId`）字串化後傳進來。 */
  id: string;
  /** 畫布局部座標（左上為原點），即 `worldToScreen` 的輸出。 */
  x: number;
  y: number;
}

export class PinMarkers {
  readonly element: HTMLDivElement;
  private readonly nodes = new Map<string, HTMLDivElement>();

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'jelly-pin-markers';
  }

  /** 每幀呼叫：同步 DOM 節點集合到目前的 Pin 清單，並定位到各自的螢幕座標。 */
  update(points: readonly PinMarkerPoint[]): void {
    const seen = new Set<string>();
    for (const p of points) {
      seen.add(p.id);
      let node = this.nodes.get(p.id);
      if (!node) {
        node = document.createElement('div');
        node.className = 'jelly-pin-marker';
        this.nodes.set(p.id, node);
        this.element.appendChild(node);
      }
      node.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
    }
  }

  /** 「Pin 模式」開關時呼叫——切換標記「點一下可以移除它」的視覺提示。 */
  setRemovable(removable: boolean): void {
    this.element.classList.toggle('is-removable', removable);
  }

  destroy(): void {
    this.element.remove();
  }
}
