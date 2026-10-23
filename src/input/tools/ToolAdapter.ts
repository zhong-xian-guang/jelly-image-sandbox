/**
 * ToolRouter 的 adapter interface 與共用 context（issue #161；spec #158「ToolRouter」）。
 *
 * 每個 Behavior（單點、大把、編隊、Pin 放、Pin 拔、電風扇、Jelly、背景圖）各是一個
 * adapter，自帶自己的 session、右鍵、滾輪——讀懂或修改一個工具只看它那一個檔。
 * `ToolRouter` 本體只留：目前工具與各工具模式、按下時選 adapter 並記住這次手勢的
 * Behavior、滾輪退路（adapter 沒處理 → 依 `activeValueKey` 增減 `ToolParams` → 都沒有則
 * 交還相機縮放）。
 *
 * adapter 不單獨測：一律經 `ToolRouter` 的公開 interface 測（`ToolRouter.test.ts`）。
 */

import type { FanState, InputEvent, PinInfo, Point, PointerId } from '../../sim';
import { movedFromStart, type GestureConfig, type GestureStart } from '../GestureTracker';
import type { ToolParams } from '../ToolParams';

/**
 * 一個 Behavior 的手勢處理。按下／移動／放開／取消必備——`move`／`up`／`cancel` 只會收到
 * 這個 adapter 自己 `down` 過的指標（`ToolRouter` 照按下當下定下的 Behavior 分派）。
 *
 * 選配的四個 hook 問的是**目前**工具＋模式對應的 adapter（一瞬間的事，沒有「按下當下定下」
 * 的問題）：
 */
export interface ToolAdapter {
  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void;
  move(id: PointerId, screenX: number, screenY: number): void;
  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void;
  cancel(id: PointerId): void;
  /** 畫布右鍵單擊（判定在 `CameraInput`），`world` 是放開位置的世界座標、`screen*` 是畫布局部座標。 */
  rightClick?(world: Point, screenX: number, screenY: number): void;
  /** 按住右鍵＋滾輪 `steps` 格；回 `true`＝已處理（`ToolRouter` 不再走退路）。 */
  wheel?(steps: number, screenX: number, screenY: number): boolean;
  /**
   * 這個世界座標上的按下歸不歸這個工具——歸工具的話觸控拖曳不平移相機（`CameraInput` 的
   * hitTest）。沒實作＝都不歸（只剩「有沒有落在 Jelly 上」那條判定）。
   */
  ownsPointerAt?(world: Point): boolean;
  /**
   * 游標標籤上的數值；`world` 是游標的世界座標（游標不在畫布上為 `null`）。沒實作＝顯示
   * 目前模式的工具參數值（`ToolRouter.activeValue`）。
   */
  cursorValue?(world: Point | null): number | string | null;
}

/** 拖曳門檻判斷用的 session：按下當下的定格 + 「已經拖過門檻」旗標（一旦設起來不再放下）。 */
export interface DragSession extends GestureStart {
  dragged: boolean;
}

/** 建構時組好、交給每個 adapter 的共用 context。 */
export interface ToolContext {
  /** 螢幕（畫布局部）→ 世界座標。 */
  readonly project: (screenX: number, screenY: number) => Point;
  /** 送出 `InputEvent`（呼叫端接 `applyInput` + 錄製）。 */
  readonly emit: (event: InputEvent) => void;
  /** 有沒有落在 Jelly 上；沒注入時一律算有（同既有「不給 hitTest」的語意）。 */
  readonly hitTest: (world: Point) => boolean;
  /** 工具參數（issue #160）——adapter 只在按下（與每一輪撒／擦）時讀值。 */
  readonly params: ToolParams;
  /** 亂數來源（撒 Pin），預設 `Math.random`。 */
  readonly random: () => number;
  /** 場上目前的 Pin 清單；沒注入＝場上沒有 Pin。 */
  readonly listPins: () => readonly PinInfo[];
  /** 場上目前的電風扇；沒注入＝場上永遠沒有風扇。 */
  readonly getFan: () => FanState | null;
  /** 解析後的手勢門檻（輕拍判定與拖曳門檻共用同一組，issue #81）。 */
  readonly config: GestureConfig;
  /** session 起始資料：按下當下的螢幕座標、時間與世界座標。 */
  gestureStart(screenX: number, screenY: number, timeMs: number): GestureStart;
  /**
   * 這一筆是否已經拖曳超過 Tap 的位移門檻（跟一般操作同一把尺）——一旦超過就記在
   * `session.dragged`、不再放下（拖出去又拖回原點仍算在拖）。
   */
  passedDragThreshold(session: DragSession, screenX: number, screenY: number): boolean;
}

/** `createToolContext` 的輸入：`ToolRouterOptions` 裡共用的那幾項（未注入的給預設）。 */
export interface ToolContextInit {
  project: (screenX: number, screenY: number) => Point;
  emit: (event: InputEvent) => void;
  hitTest?: (world: Point) => boolean;
  params: ToolParams;
  random?: () => number;
  listPins?: () => readonly PinInfo[];
  getFan?: () => FanState | null;
  config: GestureConfig;
}

export function createToolContext(init: ToolContextInit): ToolContext {
  const { project, config } = init;
  const hitTest = init.hitTest;
  const listPins = init.listPins;
  const getFan = init.getFan;
  return {
    project,
    emit: init.emit,
    hitTest: hitTest ? (world) => hitTest(world) : () => true,
    params: init.params,
    random: init.random ?? Math.random,
    listPins: listPins ? () => listPins() : () => [],
    getFan: getFan ? () => getFan() : () => null,
    config,
    gestureStart: (screenX, screenY, timeMs) => ({
      startX: screenX,
      startY: screenY,
      startT: timeMs,
      startWorld: project(screenX, screenY),
    }),
    passedDragThreshold: (session, screenX, screenY) => {
      if (!session.dragged && movedFromStart(session, screenX, screenY) > config.tapMaxDist) {
        session.dragged = true;
      }
      return session.dragged;
    },
  };
}
