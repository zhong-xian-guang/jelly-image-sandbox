import { describe, expect, it } from 'vitest';

import { pointInRings, signedPolygonArea } from './geometry';
import { traceContours } from './marchingSquares';
import type { Point } from './types';

function maskFrom(rows: string[]): { data: Uint8Array; width: number; height: number } {
  const height = rows.length;
  const width = rows[0]!.length;
  const data = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) data[y * width + x] = row[x] === '#' ? 1 : 0;
  });
  return { data, width, height };
}

const bbox = (loop: Point[]) => ({
  minX: Math.min(...loop.map((p) => p.x)),
  minY: Math.min(...loop.map((p) => p.y)),
  maxX: Math.max(...loop.map((p) => p.x)),
  maxY: Math.max(...loop.map((p) => p.y)),
});

describe('traceContours', () => {
  it('實心方塊 → 單一封閉環，包住整個方塊', () => {
    const { data, width, height } = maskFrom(['.....', '.###.', '.###.', '.###.', '.....']);
    const loops = traceContours(data, width, height);
    expect(loops).toHaveLength(1);
    const b = bbox(loops[0]!);
    // 環落在不透明像素 [1,3]×[1,3] 外圈 0.5 處
    expect(b.minX).toBeCloseTo(0.5);
    expect(b.minY).toBeCloseTo(0.5);
    expect(b.maxX).toBeCloseTo(3.5);
    expect(b.maxY).toBeCloseTo(3.5);
    expect(Math.abs(signedPolygonArea(loops[0]!))).toBeGreaterThan(8);
  });

  it('貼齊畫框邊緣的剪影 → 輪廓仍閉合、把整塊包住', () => {
    const { data, width, height } = maskFrom(['###', '###', '###']);
    const loops = traceContours(data, width, height);
    expect(loops).toHaveLength(1);
    const b = bbox(loops[0]!);
    expect(b.minX).toBeCloseTo(-0.5);
    expect(b.minY).toBeCloseTo(-0.5);
    expect(b.maxX).toBeCloseTo(2.5);
    expect(b.maxY).toBeCloseTo(2.5);
    // 每個不透明像素中心都在環內
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) expect(pointInRings(loops, x, y)).toBe(true);
  });

  it('甜甜圈 → 外環 + 洞環兩個 loop，洞中心判為外部', () => {
    const { data, width, height } = maskFrom(['#####', '#####', '##.##', '#####', '#####']);
    const loops = traceContours(data, width, height);
    expect(loops).toHaveLength(2);
    expect(pointInRings(loops, 2, 2)).toBe(false); // 洞
    expect(pointInRings(loops, 0, 0)).toBe(true); // 本體
  });

  it('對角相接的兩塊（saddle）→ 不被連成一體', () => {
    const { data, width, height } = maskFrom(['#...', '.#..', '..#.', '...#']);
    const loops = traceContours(data, width, height);
    // 4 個彼此不相連的像素 → 4 個獨立小環
    expect(loops.length).toBe(4);
  });

  it('決定性：同輸入兩次 → 相同環', () => {
    const { data, width, height } = maskFrom(['.####', '.##.#', '.####']);
    expect(traceContours(data, width, height)).toEqual(traceContours(data, width, height));
  });
});
