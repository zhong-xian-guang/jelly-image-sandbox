import { encode } from 'fast-png';
import { describe, expect, it } from 'vitest';

import { buildSimMesh, MeshPipelineError } from './buildSimMesh';
import { triangleMinAngleDeg, triangleSignedArea, triVerts } from './geometry';
import type { SimMesh } from './types';

/** 用 predicate（不透明與否）畫一張 RGBA PNG。 */
function pngFrom(
  width: number,
  height: number,
  opaque: (x: number, y: number) => boolean,
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const on = opaque(x, y);
      data[i] = 200;
      data[i + 1] = 120;
      data[i + 2] = 60;
      data[i + 3] = on ? 255 : 0;
    }
  }
  return encode({ width, height, data, channels: 4, depth: 8 });
}

const disc =
  (cx: number, cy: number, r: number) =>
  (x: number, y: number): boolean =>
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

function vertexBBox(mesh: SimMesh) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 2) {
    const x = mesh.positions[i]!;
    const y = mesh.positions[i + 1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** 每個三角形的最小內角（度）。 */
function triangleAngles(mesh: SimMesh): number[] {
  const out: number[] = [];
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    out.push(triangleMinAngleDeg(...triVerts(mesh.positions, mesh.indices, t)));
  }
  return out;
}

/** 每個三角形的 |有號面積|。 */
function triangleAreas(mesh: SimMesh): number[] {
  const out: number[] = [];
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    out.push(Math.abs(triangleSignedArea(...triVerts(mesh.positions, mesh.indices, t))));
  }
  return out;
}

function triangleCentroids(mesh: SimMesh): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]!;
    const b = mesh.indices[t + 1]!;
    const c = mesh.indices[t + 2]!;
    out.push({
      x: (mesh.positions[a * 2]! + mesh.positions[b * 2]! + mesh.positions[c * 2]!) / 3,
      y: (mesh.positions[a * 2 + 1]! + mesh.positions[b * 2 + 1]! + mesh.positions[c * 2 + 1]!) / 3,
    });
  }
  return out;
}

/** 點是否落在網格任一三角形內（含邊）——用來確認「剪影都在網格內」/「凹口沒被橋接」。 */
function pointInAnyTriangle(mesh: SimMesh, px: number, py: number): boolean {
  const p = mesh.positions;
  const sign = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]!;
    const b = mesh.indices[t + 1]!;
    const c = mesh.indices[t + 2]!;
    const d1 = sign(px, py, p[a * 2]!, p[a * 2 + 1]!, p[b * 2]!, p[b * 2 + 1]!);
    const d2 = sign(px, py, p[b * 2]!, p[b * 2 + 1]!, p[c * 2]!, p[c * 2 + 1]!);
    const d3 = sign(px, py, p[c * 2]!, p[c * 2 + 1]!, p[a * 2]!, p[a * 2 + 1]!);
    const hasNeg = d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6;
    const hasPos = d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6;
    if (!(hasNeg && hasPos)) return true;
  }
  return false;
}

describe('buildSimMesh', () => {
  it('決定性：相同 (pngBytes, params) 兩次呼叫 → SimMesh 深度相等', () => {
    const png = pngFrom(240, 240, disc(120, 120, 100));
    const a = buildSimMesh(png);
    const b = buildSimMesh(png);
    expect(a.positions).toEqual(b.positions);
    expect(a.indices).toEqual(b.indices);
    expect(a.uv).toEqual(b.uv);
    expect(a.restAreas).toEqual(b.restAreas);
  });

  it('頂點 bbox 在容差內覆蓋 alpha 不透明區域 bbox', () => {
    const png = pngFrom(240, 240, disc(120, 120, 90));
    const mesh = buildSimMesh(png);
    const b = vertexBBox(mesh);
    const tol = 3;
    // 不透明區域 bbox = [30, 210]²
    expect(b.minX).toBeLessThanOrEqual(30 + tol);
    expect(b.minY).toBeLessThanOrEqual(30 + tol);
    expect(b.maxX).toBeGreaterThanOrEqual(210 - tol);
    expect(b.maxY).toBeGreaterThanOrEqual(210 - tol);
    // 不會超出圖片太多
    expect(b.minX).toBeGreaterThan(30 - 10);
    expect(b.maxX).toBeLessThan(210 + 10);
  });

  it('不連通輸入 → 只納入最大連通元件', () => {
    const big = disc(80, 80, 60);
    const small = disc(210, 210, 20);
    const png = pngFrom(256, 256, (x, y) => big(x, y) || small(x, y));
    const mesh = buildSimMesh(png);
    const b = vertexBBox(mesh);
    // 大圓 bbox 約 [20,140]；小圓 (190..230) 不應進來
    expect(b.maxX).toBeLessThan(160);
    expect(b.maxY).toBeLessThan(160);
  });

  it('有洞（甜甜圈）輸入 → 洞內無三角形', () => {
    const R = 100;
    const r = 40;
    const png = pngFrom(260, 260, (x, y) => {
      const d2 = (x - 130) ** 2 + (y - 130) ** 2;
      return d2 <= R * R && d2 >= r * r;
    });
    const mesh = buildSimMesh(png);
    for (const c of triangleCentroids(mesh)) {
      const d = Math.hypot(c.x - 130, c.y - 130);
      expect(d).toBeGreaterThan(r - 6);
    }
  });

  it('剪影貼到影像邊緣 → 輪廓閉合、整個剪影都在網格內', () => {
    // 半圓貼在左邊緣：圓心在 x=0
    const png = pngFrom(200, 240, (x, y) => x ** 2 + (y - 120) ** 2 <= 110 * 110);
    const mesh = buildSimMesh(png);
    const b = vertexBBox(mesh);
    // 左緣被外擴一圈包住
    expect(b.minX).toBeLessThanOrEqual(0.5);
    // 貼邊那條深處的取樣點，都真的被某個三角形蓋住（不只是輪廓環包住）
    for (let y = 40; y <= 200; y += 20) {
      expect(pointInAnyTriangle(mesh, 1.5, y)).toBe(true);
    }
    // 剪影正中央也在網格內
    expect(pointInAnyTriangle(mesh, 60, 120)).toBe(true);
  });

  it('凹形輸入 → 網格貼合凹形（凹口既無三角形、也沒被橋接）', () => {
    // L 形：左半或下半不透明；右上象限是凹口
    const png = pngFrom(240, 240, (x, y) => x < 120 || y > 120);
    const mesh = buildSimMesh(png);
    // 重心不落在凹口
    for (const c of triangleCentroids(mesh)) {
      expect(c.x > 130 && c.y < 110).toBe(false);
    }
    // 凹口深處的點沒有被任何三角形蓋住（沒有橫跨凹角的橋接三角形）
    for (const [px, py] of [
      [200, 40],
      [160, 60],
      [220, 100],
    ] as const) {
      expect(pointInAnyTriangle(mesh, px, py)).toBe(false);
    }
    // 對照：L 形兩臂內部確實有三角形
    expect(pointInAnyTriangle(mesh, 60, 60)).toBe(true);
    expect(pointInAnyTriangle(mesh, 200, 200)).toBe(true);
  });

  it('目標 Particle 數落在約 200–500', () => {
    const png = pngFrom(260, 260, disc(130, 130, 110));
    const mesh = buildSimMesh(png);
    const particles = mesh.positions.length / 2;
    expect(particles).toBeGreaterThanOrEqual(200);
    expect(particles).toBeLessThanOrEqual(500);
  });

  it('沒有面積 < ε 的退化三角形', () => {
    const png = pngFrom(240, 240, disc(120, 120, 100));
    const mesh = buildSimMesh(png);
    expect(mesh.restAreas.length).toBe(mesh.indices.length / 3);
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t]!;
      const b = mesh.indices[t + 1]!;
      const c = mesh.indices[t + 2]!;
      const area = Math.abs(
        triangleSignedArea(
          mesh.positions[a * 2]!,
          mesh.positions[a * 2 + 1]!,
          mesh.positions[b * 2]!,
          mesh.positions[b * 2 + 1]!,
          mesh.positions[c * 2]!,
          mesh.positions[c * 2 + 1]!,
        ),
      );
      expect(area).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('UV = 頂點在原圖的正規化座標', () => {
    const png = pngFrom(240, 200, disc(120, 100, 80));
    const mesh = buildSimMesh(png);
    for (let i = 0; i < mesh.positions.length / 2; i++) {
      expect(mesh.uv[i * 2]).toBeCloseTo(mesh.positions[i * 2]! / 240, 4);
      expect(mesh.uv[i * 2 + 1]).toBeCloseTo(mesh.positions[i * 2 + 1]! / 200, 4);
      expect(mesh.uv[i * 2]).toBeGreaterThanOrEqual(-0.05);
      expect(mesh.uv[i * 2]).toBeLessThanOrEqual(1.05);
    }
  });

  it('大圖（2000×2000）不會爆：降採樣後仍在 Particle 預算內', () => {
    const png = pngFrom(2000, 2000, disc(1000, 1000, 850));
    const mesh = buildSimMesh(png);
    const particles = mesh.positions.length / 2;
    expect(particles).toBeGreaterThanOrEqual(200);
    expect(particles).toBeLessThanOrEqual(500);
  });

  it('全透明輸入 → 丟 MeshPipelineError', () => {
    const png = pngFrom(32, 32, () => false);
    expect(() => buildSimMesh(png)).toThrow(MeshPipelineError);
  });

  it('params 覆寫會改變輸出（且仍決定性）', () => {
    const png = pngFrom(240, 240, disc(120, 120, 100));
    const coarse = buildSimMesh(png, { targetParticleCount: 220 });
    const fine = buildSimMesh(png, { targetParticleCount: 480 });
    expect(fine.positions.length).toBeGreaterThan(coarse.positions.length);
    expect(buildSimMesh(png, { targetParticleCount: 220 }).positions).toEqual(coarse.positions);
  });

  it('Ruppert 細化：圓盤所有三角形最小角 ≥ 25°、面積無巨大離群（無 sliver、無大洞）', () => {
    const png = pngFrom(240, 240, disc(120, 120, 100));
    const mesh = buildSimMesh(png);
    const angles = triangleAngles(mesh);
    expect(angles.length).toBeGreaterThan(0);
    expect(Math.min(...angles)).toBeGreaterThanOrEqual(25 - 1e-6);
    // 最大面積準則有生效：最大三角形不應是中位數的一個數量級以上
    const areas = triangleAreas(mesh).sort((x, y) => x - y);
    const median = areas[Math.floor(areas.length / 2)]!;
    expect(Math.max(...areas)).toBeLessThan(median * 6);
  });

  it('Ruppert 細化：凹形（L 形）尖角區也達品質下界，殘餘 sliver 為個位數', () => {
    const png = pngFrom(240, 240, (x, y) => x < 120 || y > 120);
    const angles = triangleAngles(buildSimMesh(png));
    const bad = angles.filter((a) => a < 25 - 1e-6);
    // 驗收條件：少數貼著 constrained segment 的例外允許
    expect(bad.length).toBeLessThanOrEqual(5);
    // 且沒有真正的針狀 sliver
    expect(Math.min(...angles)).toBeGreaterThan(10);
  });

  it('未細化（refineMinAngleDeg=0）對照組確實有一堆 sliver', () => {
    const png = pngFrom(240, 240, disc(120, 120, 100));
    const raw = triangleAngles(buildSimMesh(png, { refineMinAngleDeg: 0 }));
    const refined = triangleAngles(buildSimMesh(png));
    expect(raw.filter((a) => a < 25).length).toBeGreaterThan(20);
    expect(refined.filter((a) => a < 25).length).toBe(0);
  });

  it('尖銳凹形（星形）誘發 encroachment 連鎖 → 仍終止、決定性、凹口未被橋接', () => {
    // 8 芒星：半徑在內外之間跳動，芒尖是尖銳凸角、芒谷是尖銳凹角
    const star = (x: number, y: number): boolean => {
      const dx = x - 130;
      const dy = y - 130;
      const ang = Math.atan2(dy, dx);
      const r = 45 + 55 * Math.abs(Math.cos(4 * ang));
      return dx * dx + dy * dy <= r * r;
    };
    const png = pngFrom(260, 260, star);
    const a = buildSimMesh(png);
    const b = buildSimMesh(png);
    expect(a.indices.length).toBeGreaterThan(0);
    expect(a.positions).toEqual(b.positions);
    expect(a.indices).toEqual(b.indices);
    for (let i = 0; i < a.positions.length; i++) expect(Number.isFinite(a.positions[i])).toBe(true);
    // 芒谷方向（ang = π/8，cos(4·ang)=0 → r 最小 45）；半徑 70 的點深陷兩芒之間，
    // 應在剪影外、也不被跨越凹角的三角形橋接
    const px = 130 + 70 * Math.cos(Math.PI / 8);
    const py = 130 + 70 * Math.sin(Math.PI / 8);
    expect(pointInAnyTriangle(a, px, py)).toBe(false);
  });
});
