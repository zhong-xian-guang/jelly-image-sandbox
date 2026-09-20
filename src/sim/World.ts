/**
 * `World`（issue #95 / V3 T3-2；spec #87、ADR-0013）——多塊 Jelly 的容器。對外契約與
 * `SimCore` 同形（`applyInput`／`step`／`pick`／`bbox`／`listPins`／`fanState`／
 * `restAttachPoint`／`grabCount`／`pinCount`／`clearPins`／`setBoundary`／`reset`），沙盒
 * 只對它說話；每塊仍是一個獨立的 `SimCore`（內部 Region／XPBD／約束不變，既有求解器
 * 測試全數保留）。無 DOM、決定性：塊的迭代一律依 `jellyId` 排序（`compareJellyIds`），
 * 不靠 `Map` 的插入順序。
 *
 * **網格由注入的 `meshProvider(sourceId, meshParams, importSize) → SimMesh` 給**（沙盒用
 * `buildSimMesh` + `scaleMeshToLongestEdge`，以參數 key memo）——`World` 不認得影像
 * 位元組，`spawn` 事件才能同步、在 Track 重播裡直接生成（spec #87 US65）。`spawn`
 * 時把網格座標加上 `offset` 成為那塊的 rest。
 *
 * **事件路由**：
 * - `grab`／帶座標的 `pin`／`tap`：依 `pick` 命中的塊派送——picking 依 **id 倒序**（後
 *   生成在上、先命中先贏）；都沒命中時退回「跨塊最近 Particle」——Grab／Pin 要求在
 *   該塊自己的吸附半徑內（`SimCore.grabRadius`），Tap 只挑最近的那塊、是否在 Tap 半徑
 *   內交給該塊自己判定（跟單塊時「Tap 不 pick、只看半徑」的行為一致）。
 * - `moveGrab`／`release`／不帶座標的 `pin`／`unpin`／`movePin`：依「約束 id → jellyId」
 *   路由表轉送；約束消失（放開、解 Pin、清 Pin、整塊移除）時從表上拿掉。
 * - `setFan`／`clearFan`／`clearPins`：廣播到每塊。風扇另存一份在 `World`，之後 `spawn`
 *   的新塊也吃到同一個風扇（風扇是場景效果，ADR-0013）。
 * - `spawn`／`remove`：見 `InputEvent` 說明。
 *
 * **Scene**（`setScene`／`sceneSnapshot`／`reset`）：`reset()` 讓場上與 Scene 一致——移除不
 * 在 Scene 的塊、補回缺的（或參數對不上的：整塊重建）、每塊回 rest、清掉所有約束與
 * 風扇。沙盒在不錄製時的匯入／生成／移除／重建之後呼叫 `setScene(sceneSnapshot())`。
 *
 * **`step(dt)`**：切 substep；每個 substep 對每塊 `predict` → 每塊 `solveInternal` →
 * （V3 T3-3 在這裡插跨塊碰撞）→ 每塊 `finishSubstep`。沒有碰撞時逐塊的浮點運算跟各自
 * `SimCore.step(dt)` 完全一樣。`params` 是全域手感參數（Softness／Tap／重力／substeps
 * …）：`applyParams` 套到每塊、之後 `spawn` 的新塊也從它起家。
 */

import type { SimMesh } from '../mesh';

import { type Boundary, InfiniteBoundary } from './boundary';
import { SimCore } from './SimCore';
import {
  type Bbox,
  DEFAULT_SIM_PARAMS,
  type FanState,
  type InputEvent,
  type PinInfo,
  type Point,
  type PointerId,
  type SceneEntry,
  type SimParams,
  substepCount,
  type SurfacePoint,
} from './types';

export type { SceneEntry };

/** `World` 建構時注入：給一塊 Jelly 生網格。必須是純函式（同參數 → 深度相等的網格），決定性重播才成立。 */
export type MeshProvider = (
  sourceId: string,
  meshParams: SceneEntry['meshParams'],
  importSize: number | null,
) => SimMesh;

/** `jellies()` 的一筆：算繪端拿 `mesh`（拓撲＋UV）建幾何、每幀讀 `positions`（零複製，**不要改動**）。 */
export interface JellyView {
  readonly id: string;
  readonly sourceId: string;
  /** 含 `offset` 的 rest 網格（`positions` 已加 offset；`indices`／`uv` 與 provider 給的同一份）。 */
  readonly mesh: SimMesh;
  readonly positions: Float64Array;
}

/** `World.listPins()` 的一筆：多帶這顆 Pin 在哪一塊上。 */
export interface WorldPinInfo extends PinInfo {
  jellyId: string;
}

/** `World.pick()` 的回傳：命中的塊 + 該塊上的表面點。 */
export interface WorldSurfacePoint extends SurfacePoint {
  jellyId: string;
}

interface Jelly {
  entry: SceneEntry;
  mesh: SimMesh;
  core: SimCore;
}

/**
 * Jelly id 的排序（決定性迭代、算繪疊放順序都用它）：同前綴時依尾端數字比大小
 * （`jelly/2` < `jelly/10`），否則退回字串比較。沙盒的 id 是 `jelly/<N>` 流水號，
 * 這樣「id 順序」= 生成順序。
 */
export function compareJellyIds(a: string, b: string): number {
  const ma = /^(.*?)(\d+)$/.exec(a);
  const mb = /^(.*?)(\d+)$/.exec(b);
  if (ma && mb && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 兩筆 Scene 條目是否描述同一塊（同圖、同網格參數、同尺寸、同擺放）——`reset()` 用它決定要不要重建。 */
function sameEntry(a: SceneEntry, b: SceneEntry): boolean {
  if (a.jellyId !== b.jellyId || a.sourceId !== b.sourceId || a.importSize !== b.importSize) {
    return false;
  }
  if (a.offset.x !== b.offset.x || a.offset.y !== b.offset.y) return false;
  const ka = Object.keys(a.meshParams) as (keyof SceneEntry['meshParams'])[];
  const kb = Object.keys(b.meshParams);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a.meshParams[k] === b.meshParams[k]);
}

function cloneEntry(e: SceneEntry): SceneEntry {
  return {
    jellyId: e.jellyId,
    sourceId: e.sourceId,
    meshParams: { ...e.meshParams },
    importSize: e.importSize,
    offset: { x: e.offset.x, y: e.offset.y },
  };
}

export class World {
  /** 全域手感參數（每塊共用）。改欄位請走 `applyParams`，才會同步到場上每塊。 */
  readonly params: SimParams;

  private readonly jellyMap = new Map<string, Jelly>();
  /** `jellyMap` 依 id 排序後的快取；`spawn`／`remove`／`reset` 時重算。 */
  private sorted: Jelly[] = [];
  /** 約束 id → 所在的塊。Grab 與 Pin 共用 id 命名空間（同 `SimCore`）。 */
  private readonly route = new Map<PointerId, string>();
  private scene: SceneEntry[] = [];
  private fan: FanState | null = null;
  private boundary: Boundary = new InfiniteBoundary();

  constructor(
    private readonly meshProvider: MeshProvider,
    params: Partial<SimParams> = {},
  ) {
    this.params = { ...DEFAULT_SIM_PARAMS, ...params };
  }

  // ---- scene ---------------------------------------------------------------

  /** 記住佈景（深拷貝）。不動場上的塊——要讓場上跟它一致請接著呼叫 `reset()`。 */
  setScene(entries: readonly SceneEntry[]): void {
    this.scene = entries.map(cloneEntry);
  }

  /** 目前場上每塊當初 `spawn` 的參數（依 id 排序、深拷貝）。 */
  sceneSnapshot(): SceneEntry[] {
    return this.sorted.map((j) => cloneEntry(j.entry));
  }

  /**
   * 場上回到 Scene：不在 Scene 的塊移除、缺的補回、參數對不上的整塊重建、其餘每塊
   * `SimCore.reset()`（回 rest、速度歸零、清約束、清風扇、陣風 PRNG 重播種）。路由表
   * 與 `World` 自己記的風扇也一併清掉。
   */
  reset(): void {
    const keep = new Set(this.scene.map((e) => e.jellyId));
    for (const id of [...this.jellyMap.keys()]) {
      if (!keep.has(id)) this.jellyMap.delete(id);
    }
    this.route.clear();
    this.fan = null;
    for (const entry of this.scene) {
      const existing = this.jellyMap.get(entry.jellyId);
      if (existing && sameEntry(existing.entry, entry)) {
        existing.core.reset();
      } else {
        this.jellyMap.set(entry.jellyId, this.buildJelly(entry));
      }
    }
    this.resort();
  }

  private buildJelly(entry: SceneEntry): Jelly {
    const raw = this.meshProvider(entry.sourceId, entry.meshParams, entry.importSize);
    const positions = new Float32Array(raw.positions.length);
    for (let i = 0; i < positions.length; i += 2) {
      positions[i] = raw.positions[i]! + entry.offset.x;
      positions[i + 1] = raw.positions[i + 1]! + entry.offset.y;
    }
    const mesh: SimMesh = { ...raw, positions };
    const core = new SimCore(mesh, this.params);
    core.setBoundary(this.boundary);
    if (this.fan) core.applyInput({ type: 'setFan', ...this.fan });
    return { entry: cloneEntry(entry), mesh, core };
  }

  private resort(): void {
    this.sorted = [...this.jellyMap.values()].sort((a, b) =>
      compareJellyIds(a.entry.jellyId, b.entry.jellyId),
    );
  }

  // ---- readouts ---------------------------------------------------------------

  /** 場上每塊（依 id 排序）。 */
  jellies(): JellyView[] {
    return this.sorted.map((j) => ({
      id: j.entry.jellyId,
      sourceId: j.entry.sourceId,
      mesh: j.mesh,
      positions: j.core.positions,
    }));
  }

  /** 所有塊 bbox 的聯集；空場回 `null`（相機／邊界幾何的呼叫端據此「不動」）。 */
  bbox(): Bbox | null {
    if (this.sorted.length === 0) return null;
    const out: Bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const j of this.sorted) {
      const b = j.core.bbox();
      if (b.minX < out.minX) out.minX = b.minX;
      if (b.minY < out.minY) out.minY = b.minY;
      if (b.maxX > out.maxX) out.maxX = b.maxX;
      if (b.maxY > out.maxY) out.maxY = b.maxY;
    }
    return out;
  }

  /** 嚴格 picking，id 倒序（後生成在上）先命中先贏；都沒中回 `null`。 */
  pick(x: number, y: number): WorldSurfacePoint | null {
    for (let i = this.sorted.length - 1; i >= 0; i--) {
      const j = this.sorted[i]!;
      const hit = j.core.pick(x, y);
      if (hit) return { jellyId: j.entry.jellyId, tri: hit.tri, w: hit.w };
    }
    return null;
  }

  listPins(): WorldPinInfo[] {
    const pins: WorldPinInfo[] = [];
    for (const j of this.sorted) {
      for (const pin of j.core.listPins()) pins.push({ ...pin, jellyId: j.entry.jellyId });
    }
    return pins;
  }

  fanState(): FanState | null {
    return this.fan;
  }

  restAttachPoint(id: PointerId): Point | null {
    return this.coreFor(id)?.restAttachPoint(id) ?? null;
  }

  get grabCount(): number {
    let n = 0;
    for (const j of this.sorted) n += j.core.grabCount;
    return n;
  }

  get pinCount(): number {
    let n = 0;
    for (const j of this.sorted) n += j.core.pinCount;
    return n;
  }

  // ---- params / boundary ------------------------------------------------------

  /**
   * 把全域參數的變更套到場上每塊（之後 `spawn` 的新塊也會吃到）。`cellFrac` 有變時
   * 各塊 `rebuildRegions()`。
   */
  applyParams(patch: Partial<SimParams>): void {
    Object.assign(this.params, patch);
    const rebuild = 'cellFrac' in patch;
    for (const j of this.sorted) {
      Object.assign(j.core.params, patch);
      if (rebuild) j.core.rebuildRegions();
    }
  }

  /** 替換碰撞環境——套到每塊、之後 `spawn` 的新塊也用它。 */
  setBoundary(boundary: Boundary): void {
    this.boundary = boundary;
    for (const j of this.sorted) j.core.setBoundary(boundary);
  }

  /** 一次移除所有塊上的所有 Pin（保留 Grab）。等同 `applyInput({ type: 'clearPins' })`。 */
  clearPins(): void {
    for (const j of this.sorted) j.core.clearPins();
    this.pruneRoutes();
  }

  // ---- input --------------------------------------------------------------------

  applyInput(event: InputEvent): void {
    switch (event.type) {
      case 'spawn':
        this.spawn(event);
        break;
      case 'remove':
        this.remove(event.jellyId);
        break;
      case 'grab': {
        const target = this.targetForGrab(event.x, event.y, event.radius);
        if (target) this.forward(target, event.id, event);
        break;
      }
      case 'pin': {
        if (event.x !== undefined && event.y !== undefined) {
          const target = this.targetForGrab(event.x, event.y, event.radius);
          if (target) this.forward(target, event.id, event);
        } else {
          this.coreFor(event.id)?.applyInput(event);
        }
        break;
      }
      case 'tap': {
        const target = this.pick(event.x, event.y)?.jellyId ?? this.nearestJelly(event.x, event.y);
        if (target) this.jellyMap.get(target)!.core.applyInput(event);
        break;
      }
      case 'moveGrab':
      case 'movePin':
        this.coreFor(event.id)?.applyInput(event);
        break;
      case 'release':
      case 'unpin': {
        const core = this.coreFor(event.id);
        if (!core) break;
        core.applyInput(event);
        if (core.attachPoint(event.id) === null) this.route.delete(event.id);
        break;
      }
      case 'clearPins':
        this.clearPins();
        break;
      case 'setFan': {
        const { type: _type, ...fan } = event;
        this.fan = fan;
        for (const j of this.sorted) j.core.applyInput(event);
        break;
      }
      case 'clearFan':
        this.fan = null;
        for (const j of this.sorted) j.core.applyInput(event);
        break;
    }
  }

  private spawn(entry: SceneEntry): void {
    if (this.jellyMap.has(entry.jellyId)) return;
    this.jellyMap.set(entry.jellyId, this.buildJelly(entry));
    this.resort();
  }

  private remove(jellyId: string): void {
    if (!this.jellyMap.delete(jellyId)) return;
    for (const [id, owner] of this.route) if (owner === jellyId) this.route.delete(id);
    this.resort();
  }

  private coreFor(id: PointerId): SimCore | undefined {
    const owner = this.route.get(id);
    return owner === undefined ? undefined : this.jellyMap.get(owner)?.core;
  }

  /** 把帶 `id` 的建立事件送給某塊，成功建立約束才登記路由。 */
  private forward(jellyId: string, id: PointerId, event: InputEvent): void {
    const core = this.jellyMap.get(jellyId)!.core;
    core.applyInput(event);
    if (core.attachPoint(id) !== null) this.route.set(id, jellyId);
  }

  /**
   * Grab／Pin 的目標塊：先 `pick`（id 倒序）；都沒中就在每塊「最近 Particle 在該塊
   * 吸附半徑內」的候選裡挑距離最短的（跨塊吸附，ADR-0013）。
   */
  private targetForGrab(x: number, y: number, radius: number | undefined): string | null {
    const hit = this.pick(x, y);
    if (hit) return hit.jellyId;
    let best: string | null = null;
    let bestD = Infinity;
    for (const j of this.sorted) {
      const { distance } = j.core.nearestParticle(x, y);
      if (distance < j.core.grabRadius(radius) && distance < bestD) {
        bestD = distance;
        best = j.entry.jellyId;
      }
    }
    return best;
  }

  /** 最近 Particle 所在的塊（不限半徑）；空場 `null`。Tap 的退路用。 */
  private nearestJelly(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const j of this.sorted) {
      const { distance } = j.core.nearestParticle(x, y);
      if (distance < bestD) {
        bestD = distance;
        best = j.entry.jellyId;
      }
    }
    return best;
  }

  /** 把路由表上已經沒有約束的 id 拿掉（`clearPins` 之後）。 */
  private pruneRoutes(): void {
    for (const [id, owner] of this.route) {
      const core = this.jellyMap.get(owner)?.core;
      if (!core || core.attachPoint(id) === null) this.route.delete(id);
    }
  }

  // ---- step -----------------------------------------------------------------------

  /**
   * 推進 `dt` 秒。`dt <= 0` 或空場為 no-op。substep 切法與 `SimCore.step` 同一條規則
   * （`params.substeps` 取整、至少 1）。
   */
  step(dt: number): void {
    if (!(dt > 0) || this.sorted.length === 0) return;
    const subs = substepCount(this.params);
    const h = dt / subs;
    for (let s = 0; s < subs; s++) {
      for (const j of this.sorted) j.core.predict(h);
      for (const j of this.sorted) j.core.solveInternal(h);
      // V3 T3-3：跨塊碰撞插在這裡（就地改各塊的 `positions`／`prevPositions`）。
      for (const j of this.sorted) j.core.finishSubstep(h);
    }
  }
}
