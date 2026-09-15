/**
 * 手勢判定（issue #11 / T10）——純邏輯，不碰 DOM。
 *
 * 指標事件序列翻成 `SimCore.applyInput` 吃的 `InputEvent`（ADR-0005 的單一窄介面）：
 *  - `down` → `grab`（附著在該世界座標；grab 不動不會位移，見 T4）
 *  - `move` → `moveGrab`
 *  - `up`   → 若 down→up ≤ `tapMaxMs` 且螢幕位移 ≤ `tapMaxDist` → `tap`（在按下點），
 *             接著 `release`；否則只 `release`（Fling 由被抓 Particle 自身速度帶出）
 *  - `cancel` → `release`
 *
 * 多指各自獨立（`id` = 指標 id）。DOM 事件的接線在 `PointerInput`。
 */

import type { InputEvent, Point, PointerId } from '../sim';

export interface GestureConfig {
  /** down→up 在此毫秒內（且位移夠小）→ 判為 Tap。預設 250。 */
  tapMaxMs: number;
  /**
   * Tap 允許的最大位移，量的是**螢幕 CSS px**（指標在畫面上幾乎沒動）。
   * 設計文件寫「世界座標位移 < 6px」——這裡刻意用螢幕空間，才不會因縮放倍率改變
   * Tap 的靈敏度。預設 6。
   */
  tapMaxDist: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = { tapMaxMs: 250, tapMaxDist: 6 };

/**
 * 把使用者可能只給一半的門檻補成完整的一組（issue #81 抽出）——`GestureTracker`
 * 與 `ToolRouter` 都得解析同一份 `opts.config`，各寫一次展開就會變成兩套預設值
 * 的來源，改了其中一個很難發現另一個沒跟上。
 */
export function resolveGestureConfig(config?: Partial<GestureConfig>): GestureConfig {
  return { ...DEFAULT_GESTURE_CONFIG, ...config };
}

/**
 * 一次手勢**按下當下**的定格：螢幕座標、時間、世界座標。`isTap` 拿前三者判定，
 * `startWorld` 則是「輕拍打在按下點、不是放開點」這條規則的依據。
 *
 * `GestureTracker`（一般操作）與 `ToolRouter` 的編隊抓取 session（issue #81）
 * 共用同一個形狀——兩邊的輕拍必須是同一回事，型別抄兩份遲早會各自漂移。
 */
export interface GestureStart {
  startX: number;
  startY: number;
  startT: number;
  startWorld: Point;
}

/**
 * 這次手勢算不算「快速按放」＝ 輕拍（issue #81 抽出成純函式共用）：按住夠短
 * **且**螢幕位移夠小。位移只比對 down／up 兩點，不累計路徑長度——拖遠再拖回
 * 仍算輕拍，這個取捨兩個模式一致，使用者不會覺得換個工具手感就變了。
 */
export function isTap(
  start: GestureStart,
  screenX: number,
  screenY: number,
  timeMs: number,
  config: GestureConfig,
): boolean {
  const heldMs = timeMs - start.startT;
  const movedPx = Math.hypot(screenX - start.startX, screenY - start.startY);
  return heldMs <= config.tapMaxMs && movedPx <= config.tapMaxDist;
}

export interface GestureTrackerOptions {
  /** 畫布局部座標（左上為原點）→ 世界座標。 */
  screenToWorld: (screenX: number, screenY: number) => Point;
  /** 判定結果往這裡送——接 `sim.applyInput`。 */
  emit: (event: InputEvent) => void;
  /**
   * 該世界座標是否落在 Jelly 上（`sim.pick(...) != null`）。給了才判：`pointerdown`
   * 沒命中 Jelly → 不追這個指標、不 emit（那是背景拖曳，歸相機層處理）。不給則
   * 一律當成命中（T10 行為）。
   */
  hitTest?: (world: Point) => boolean;
  config?: Partial<GestureConfig>;
}

export class GestureTracker {
  private readonly screenToWorld: (x: number, y: number) => Point;
  private readonly emit: (event: InputEvent) => void;
  private readonly hitTest?: (world: Point) => boolean;
  private readonly config: GestureConfig;
  private readonly tracks = new Map<PointerId, GestureStart>();

  constructor(opts: GestureTrackerOptions) {
    this.screenToWorld = opts.screenToWorld;
    this.emit = opts.emit;
    this.hitTest = opts.hitTest;
    this.config = resolveGestureConfig(opts.config);
  }

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    const startWorld = this.screenToWorld(screenX, screenY);
    if (this.hitTest && !this.hitTest(startWorld)) return; // 背景拖曳 → 不歸求解器
    this.tracks.set(id, { startX: screenX, startY: screenY, startT: timeMs, startWorld });
    this.emit({ type: 'grab', id, x: startWorld.x, y: startWorld.y });
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    if (!this.tracks.has(id)) return;
    const w = this.screenToWorld(screenX, screenY);
    this.emit({ type: 'moveGrab', id, x: w.x, y: w.y });
  }

  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    const t = this.tracks.get(id);
    if (!t) return;
    this.tracks.delete(id);
    if (isTap(t, screenX, screenY, timeMs, this.config)) {
      this.emit({ type: 'tap', x: t.startWorld.x, y: t.startWorld.y });
    }
    this.emit({ type: 'release', id });
  }

  cancel(id: PointerId): void {
    if (this.tracks.delete(id)) this.emit({ type: 'release', id });
  }

  /** 目前追蹤中的指標數（= 作用中的 Grab 數）。 */
  get activeCount(): number {
    return this.tracks.size;
  }
}
