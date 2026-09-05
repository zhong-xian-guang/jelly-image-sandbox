/**
 * Boundary（邊界，issue #9 / T8）——求解器所對的可替換碰撞環境。
 *
 * `resolveBoundary` 在 substep 迴圈的 Grab/Pin 約束之後、回推速度之前呼叫：就地把
 * `pos` clamp 進邊界，並調整 `prev` 讓「`v = (pos − prev) / dt`」回推出來的速度不再
 * 指向界外（可選 restitution 反彈）。因為速度是由位置差回推的，所有邊界效果都收在
 * 這一步——不動求解器其他部分。
 *
 * 兩個實作：`WalledBoundary`（有限 AABB）與 `InfiniteBoundary`（無邊界、no-op）。
 * 執行期可用 `SimCore.setBoundary` 直接替換，不需重建求解器（見
 * `docs/design/simulation-and-mesh.md` 模組邊界）。
 */

import type { Bbox } from './types';

export interface Boundary {
  /**
   * 就地解邊界。`pos` / `prev` 是攤平的 `[x0,y0,x1,y1,...]`，`count` = Particle 數，
   * `dt` = 當前 substep 的時間步（Walled / Infinite 用不到，但屬於介面契約）。
   */
  resolveBoundary(pos: Float64Array, prev: Float64Array, count: number, dt: number): void;
}

/** 兩種 `Boundary` 實作的名字——控制面板（issue #14）用它記錄／切換目前模式。 */
export type BoundaryMode = 'walled' | 'infinite';

/** 無邊界、無限延伸。no-op——Jelly 可被甩到任意遠。 */
export class InfiniteBoundary implements Boundary {
  resolveBoundary(): void {
    // 什麼都不做。
  }
}

/** `WalledBoundary` 的建構選項：AABB 範圍 + 可選反彈係數。 */
export interface WalledBoundaryOptions extends Bbox {
  /**
   * 碰壁反彈係數，`0`（預設）= 純 clamp、向外速度分量歸零；`1` = 完全彈性反彈。
   * 逐軸獨立套用。
   */
  restitution?: number;
}

/**
 * 有限 AABB 邊界：每個 Particle 逐軸 clamp 進 `box`。撞到界的軸把 `prev` 設成
 * `界 + e·(界 − prev)`，於是回推速度該分量變成 `−e · 入射速度`
 * （`e = 0` → 歸零；`e = 1` → 等速反向）。
 */
export class WalledBoundary implements Boundary {
  /** AABB 範圍。公開唯讀，供相機 / 算繪畫界。 */
  readonly box: Bbox;
  /** 逐軸反彈係數，`0`–`1`。 */
  readonly restitution: number;

  constructor(options: WalledBoundaryOptions) {
    this.box = {
      minX: options.minX,
      minY: options.minY,
      maxX: options.maxX,
      maxY: options.maxY,
    };
    this.restitution = options.restitution ?? 0;
  }

  resolveBoundary(pos: Float64Array, prev: Float64Array, count: number): void {
    const { minX, minY, maxX, maxY } = this.box;
    const e = this.restitution;
    for (let i = 0; i < count; i++) {
      clampAxis(pos, prev, 2 * i, minX, maxX, e);
      clampAxis(pos, prev, 2 * i + 1, minY, maxY, e);
    }
  }
}

/**
 * 把 `pos[idx]` clamp 進 `[lo, hi]`。越界時把 `prev[idx]` 設成 `界 + e·(界 − prev)`，
 * 其中 `界 − prev` 用 **clamp 前** 的位置差 → 回推速度 = `−e · 入射速度`
 * （含 overshoot 那一段，`e = 1` 才是真彈性）。
 */
function clampAxis(
  pos: Float64Array,
  prev: Float64Array,
  idx: number,
  lo: number,
  hi: number,
  e: number,
): void {
  const v = pos[idx]!;
  if (v < lo) {
    pos[idx] = lo;
    prev[idx] = lo + e * (v - prev[idx]!);
  } else if (v > hi) {
    pos[idx] = hi;
    prev[idx] = hi + e * (v - prev[idx]!);
  }
}
