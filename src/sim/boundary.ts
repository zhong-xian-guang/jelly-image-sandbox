/**
 * Boundary（邊界，issue #9 / T8）——求解器所對的可替換碰撞環境。
 *
 * `resolveBoundary` 在 substep 迴圈的 Grab/Pin 約束之後、回推速度之前呼叫：就地把
 * `pos` clamp 進邊界，並調整 `prev` 讓「`v = (pos − prev) / dt`」回推出來的速度不再
 * 指向界外（可選 restitution 反彈），並對貼著面滑動的切線速度套摩擦（issue #93）。
 * 因為速度是由位置差回推的，所有邊界效果都收在這一步——不動求解器其他部分。
 *
 * 三個實作：`WalledBoundary`（有限 AABB）、`InfiniteBoundary`（無邊界、no-op）與
 * `FloorBoundary`（僅地板：一條水平地板，左右與上方無限延伸；issue #92 / ADR-0012）。
 * 執行期可用 `SimCore.setBoundary` 直接替換，不需重建求解器（見
 * `docs/design/simulation-and-mesh.md` 模組邊界）。
 */

import type { Bbox } from './types';

export interface Boundary {
  /**
   * 就地解邊界。`pos` / `prev` 是攤平的 `[x0,y0,x1,y1,...]`，`count` = Particle 數，
   * `dt` = 當前 substep 的時間步（Walled / Floor / Infinite 用不到，但屬於介面契約）。
   */
  resolveBoundary(pos: Float64Array, prev: Float64Array, count: number, dt: number): void;
}

/** 三種 `Boundary` 實作的名字——控制面板（issue #14）用它記錄／切換目前模式；片段檔（issue #57）用它驗值。 */
export const BOUNDARY_MODES = ['walled', 'infinite', 'floor'] as const;
export type BoundaryMode = (typeof BOUNDARY_MODES)[number];

/** 無邊界、無限延伸。no-op——Jelly 可被甩到任意遠。 */
export class InfiniteBoundary implements Boundary {
  resolveBoundary(): void {
    // 什麼都不做。
  }
}

/** Walled / Floor 共用的接觸反應係數。 */
export interface ContactOptions {
  /**
   * 碰壁反彈係數，`0`（預設）= 純 clamp、向外速度分量歸零；`1` = 完全彈性反彈。
   * 逐軸獨立套用。
   */
  restitution?: number;
  /**
   * 切線摩擦（issue #93 / V3 T2-3；ADR-0012），`0`（預設）= 無摩擦（現況、位元不變）；
   * `1` = 貼著面時切線速度歸零。這個 substep 被某個面 clamp 的 Particle，回推的
   * **切線**速度乘 `(1 − friction)`；法線方向維持 restitution 規則。「接觸」= 這個
   * substep 被 clamp，所以靜置在地板上的 Jelly 每步都在接觸、摩擦持續作用；沒重力時
   * 只有真的撞上才作用。
   */
  friction?: number;
}

/** `WalledBoundary` 的建構選項：AABB 範圍 + 可選反彈／摩擦係數。 */
export interface WalledBoundaryOptions extends Bbox, ContactOptions {}

/**
 * 有限 AABB 邊界：每個 Particle 逐軸 clamp 進 `box`。撞到界的軸把 `prev` 設成
 * `界 + e·(界 − prev)`，於是回推速度該分量變成 `−e · 入射速度`
 * （`e = 0` → 歸零；`e = 1` → 等速反向）。摩擦逐面：撞到 x 面就衰減 y 分量、撞到
 * y 面就衰減 x 分量、角落兩軸都衰（先套完兩軸的法線規則再套摩擦，所以角落有
 * restitution 時反彈出去的速度也被乘 `(1 − friction)`）。
 */
export class WalledBoundary implements Boundary {
  /** AABB 範圍。公開唯讀，供相機 / 算繪畫界。 */
  readonly box: Bbox;
  /** 逐軸反彈係數，`0`–`1`。 */
  readonly restitution: number;
  /** 切線摩擦，`0`–`1`。 */
  readonly friction: number;

  constructor(options: WalledBoundaryOptions) {
    this.box = {
      minX: options.minX,
      minY: options.minY,
      maxX: options.maxX,
      maxY: options.maxY,
    };
    this.restitution = options.restitution ?? 0;
    this.friction = options.friction ?? 0;
  }

  resolveBoundary(pos: Float64Array, prev: Float64Array, count: number): void {
    const { minX, minY, maxX, maxY } = this.box;
    const e = this.restitution;
    const f = this.friction;
    const rough = f > 0;
    for (let i = 0; i < count; i++) {
      const ix = 2 * i;
      const iy = ix + 1;
      const hitX = clampAxis(pos, prev, ix, minX, maxX, e);
      const hitY = clampAxis(pos, prev, iy, minY, maxY, e);
      if (rough && hitX) applyFriction(pos, prev, iy, f);
      if (rough && hitY) applyFriction(pos, prev, ix, f);
    }
  }
}

/** `FloorBoundary` 的建構選項：地板高度 + 可選反彈／摩擦係數。 */
export interface FloorBoundaryOptions extends ContactOptions {
  /** 地板的世界 y（世界 y 向下 → 地板在 Jelly **下方**，Particle 的 `y` 不得大於它）。 */
  floorY: number;
}

/**
 * 僅地板（issue #92 / V3 T2-2；ADR-0012）：一條水平地板 `y = floorY`，左右與上方
 * 無限延伸。`pos.y > floorY` 的 Particle clamp 到 `floorY`，`prev.y` 比照
 * `WalledBoundary`（`e = 0` → 回推 y 速度歸零），貼地那步 x 速度乘 `(1 − friction)`；
 * x 方向與上方完全不管——Jelly 可以往左右甩到任意遠、往上拋任意高。
 */
export class FloorBoundary implements Boundary {
  /** 地板的世界 y。公開唯讀，供算繪畫地板線。 */
  readonly floorY: number;
  /** 反彈係數，`0`–`1`。 */
  readonly restitution: number;
  /** 切線摩擦，`0`–`1`。 */
  readonly friction: number;

  constructor(options: FloorBoundaryOptions) {
    this.floorY = options.floorY;
    this.restitution = options.restitution ?? 0;
    this.friction = options.friction ?? 0;
  }

  resolveBoundary(pos: Float64Array, prev: Float64Array, count: number): void {
    const floorY = this.floorY;
    const e = this.restitution;
    const f = this.friction;
    const rough = f > 0;
    for (let i = 0; i < count; i++) {
      const ix = 2 * i;
      const hit = clampAxis(pos, prev, ix + 1, -Infinity, floorY, e);
      if (rough && hit) applyFriction(pos, prev, ix, f);
    }
  }
}

/**
 * 把 `pos[idx]` clamp 進 `[lo, hi]`（`lo` 可為 `-Infinity` → 只有上界，`FloorBoundary` 用）。越界時把 `prev[idx]` 設成 `界 + e·(界 − prev)`，
 * 其中 `界 − prev` 用 **clamp 前** 的位置差 → 回推速度 = `−e · 入射速度`
 * （含 overshoot 那一段，`e = 1` 才是真彈性）。回傳這一軸有沒有被 clamp（= 接觸到面）。
 */
function clampAxis(
  pos: Float64Array,
  prev: Float64Array,
  idx: number,
  lo: number,
  hi: number,
  e: number,
): boolean {
  const v = pos[idx]!;
  if (v < lo) {
    pos[idx] = lo;
    prev[idx] = lo + e * (v - prev[idx]!);
    return true;
  }
  if (v > hi) {
    pos[idx] = hi;
    prev[idx] = hi + e * (v - prev[idx]!);
    return true;
  }
  return false;
}

/**
 * 切線摩擦：`prev[idx] = pos − (pos − prev) × (1 − f)`，回推速度該分量乘 `(1 − f)`。
 * 呼叫端在 `f > 0` 才呼叫——`f = 0` 時 `pos − (pos − prev)` 不保證位元等於 `prev`，
 * 跳過才能守住既有無摩擦行為位元不變。
 */
function applyFriction(pos: Float64Array, prev: Float64Array, idx: number, f: number): void {
  const p = pos[idx]!;
  prev[idx] = p - (p - prev[idx]!) * (1 - f);
}
