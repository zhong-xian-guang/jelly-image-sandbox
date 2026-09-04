/**
 * Boundary（邊界，issue #9 / T8）——求解器所對的可替換碰撞環境。
 *
 * `resolveBoundary` 在 substep 迴圈的 Grab/Pin 約束之後、回推速度之前呼叫：就地把
 * `pos` clamp 進邊界，並調整 `prev` 讓「`v = (pos − prev) / dt`」回推出來的速度不再
 * 指向界外（可選 restitution 反彈）。因為速度是由位置差回推的，所有邊界效果都收在
 * 這一步——不動求解器其他部分。
 *
 * 兩個實作：`WalledBoundary`（AABB）與 `InfiniteBoundary`（no-op）。執行期可用
 * `SimCore.setBoundary` 直接替換，不需重建求解器（見 `docs/design/simulation-and-mesh.md`
 * 模組邊界）。
 */

export interface Boundary {
  /**
   * 就地解邊界。`pos` / `prev` 是攤平的 `[x0,y0,x1,y1,...]`，`count` = Particle 數，
   * `dt` = 當前 substep 的時間步（Walled / Infinite 用不到，但屬於介面契約）。
   */
  resolveBoundary(pos: Float64Array, prev: Float64Array, count: number, dt: number): void;
}

/** 無牆、無限延伸的桌面。no-op。 */
export class InfiniteBoundary implements Boundary {
  resolveBoundary(): void {
    // 什麼都不做——Jelly 可被甩到任意遠。
  }
}

/** 軸對齊的有限桌面 `[minX, maxX] × [minY, maxY]`。 */
export interface WalledBoundaryOptions {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /**
   * 碰牆反彈係數，`0`（預設）= 純 clamp、向外速度分量歸零；`1` = 完全彈性反彈。
   * 逐軸獨立套用。
   */
  restitution?: number;
}

/**
 * 有牆桌面：每個 Particle 逐軸 clamp 進 AABB。撞牆的軸把 `prev` 設成
 * `wall + e·(wall − prev)`，於是回推速度該分量變成 `−e · 入射速度`
 * （`e = 0` → 歸零；`e > 0` → 反彈）。`box` 公開唯讀，供相機 / 算繪畫牆。
 */
export class WalledBoundary implements Boundary {
  constructor(readonly box: WalledBoundaryOptions) {}

  resolveBoundary(pos: Float64Array, prev: Float64Array, count: number): void {
    const { minX, minY, maxX, maxY } = this.box;
    const e = this.box.restitution ?? 0;
    for (let i = 0; i < count; i++) {
      const xi = 2 * i;
      const yi = 2 * i + 1;
      const x = pos[xi]!;
      const y = pos[yi]!;
      if (x < minX) {
        pos[xi] = minX;
        prev[xi] = minX + e * (minX - prev[xi]!);
      } else if (x > maxX) {
        pos[xi] = maxX;
        prev[xi] = maxX + e * (maxX - prev[xi]!);
      }
      if (y < minY) {
        pos[yi] = minY;
        prev[yi] = minY + e * (minY - prev[yi]!);
      } else if (y > maxY) {
        pos[yi] = maxY;
        prev[yi] = maxY + e * (maxY - prev[yi]!);
      }
    }
  }
}
