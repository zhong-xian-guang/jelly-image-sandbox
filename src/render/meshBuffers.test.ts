import { describe, expect, it } from 'vitest';

import {
  containerPosition,
  createTextureBuffers,
  screenToWorld,
  type TextureMesh,
  validateTextureMesh,
  writePositions,
} from './meshBuffers';

/** 兩個三角形共用一條邊的小網格（4 頂點、2 三角形）。 */
function quadMesh(): TextureMesh {
  return {
    uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

describe('validateTextureMesh', () => {
  it('合法網格不丟', () => {
    expect(() => validateTextureMesh(quadMesh())).not.toThrow();
  });

  it('uv 長度為奇數 → 丟', () => {
    expect(() =>
      validateTextureMesh({ uv: new Float32Array(3), indices: new Uint32Array(0) }),
    ).toThrow(/uv 長度/);
  });

  it('indices 長度非 3 的倍數 → 丟', () => {
    expect(() =>
      validateTextureMesh({ uv: new Float32Array([0, 0, 1, 1]), indices: new Uint32Array([0, 1]) }),
    ).toThrow(/3 的倍數/);
  });

  it('索引超出頂點範圍 → 丟', () => {
    expect(() =>
      validateTextureMesh({
        uv: new Float32Array([0, 0, 1, 1]),
        indices: new Uint32Array([0, 1, 2]),
      }),
    ).toThrow(/超出頂點範圍/);
  });
});

describe('createTextureBuffers', () => {
  it('positions 深拷貝成 Float32Array；uvs / indices 各自複製', () => {
    const mesh = quadMesh();
    const positions = new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]);
    const b = createTextureBuffers(mesh, positions);

    expect(b.positions).toBeInstanceOf(Float32Array);
    expect(Array.from(b.positions)).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
    expect(Array.from(b.uvs)).toEqual(Array.from(mesh.uv));
    expect(Array.from(b.indices)).toEqual(Array.from(mesh.indices));

    // 與來源脫鉤
    positions[0] = 999;
    expect(b.positions[0]).toBe(0);
    b.uvs[0] = 0.5;
    expect(mesh.uv[0]).toBe(0);
  });

  it('positions 長度與頂點數不符 → 丟', () => {
    expect(() => createTextureBuffers(quadMesh(), new Float64Array(6))).toThrow(/與頂點數不符/);
  });
});

describe('writePositions', () => {
  it('就地把 Float64 座標寫進 Float32 buffer', () => {
    const target = new Float32Array(4);
    const out = writePositions(target, new Float64Array([1.5, 2.5, -3.5, 4.5]));
    expect(out).toBe(target);
    expect(Array.from(target)).toEqual([1.5, 2.5, -3.5, 4.5]);
  });

  it('長度不符 → 丟', () => {
    expect(() => writePositions(new Float32Array(4), new Float64Array(6))).toThrow(/不符/);
  });
});

describe('containerPosition / screenToWorld', () => {
  it('camera 在原點、scale 1 → container 位在畫布中心', () => {
    expect(containerPosition({ x: 0, y: 0, scale: 1 }, 800, 600)).toEqual({ x: 400, y: 300 });
  });

  it('平移 camera → container 反向位移 scale 倍', () => {
    expect(containerPosition({ x: 100, y: 50, scale: 2 }, 800, 600)).toEqual({
      x: 400 - 200,
      y: 300 - 100,
    });
  });

  it('screenToWorld 是 containerPosition 的逆：畫布中心 ↔ camera 焦點', () => {
    const camera = { x: 30, y: -20, scale: 1.5 };
    const w = screenToWorld(camera, 640, 480, 320, 240);
    expect(w.x).toBeCloseTo(camera.x, 9);
    expect(w.y).toBeCloseTo(camera.y, 9);
  });

  it('screenToWorld ∘ (worldToScreen) 往返還原', () => {
    const camera = { x: 12, y: 34, scale: 0.8 };
    const p = containerPosition(camera, 1000, 700);
    const world = { x: 55, y: -18 };
    const screenX = p.x + world.x * camera.scale;
    const screenY = p.y + world.y * camera.scale;
    const back = screenToWorld(camera, 1000, 700, screenX, screenY);
    expect(back.x).toBeCloseTo(world.x, 9);
    expect(back.y).toBeCloseTo(world.y, 9);
  });
});
