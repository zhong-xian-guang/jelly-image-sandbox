import { describe, expect, it } from 'vitest';

import {
  computeWireframeEdges,
  containerPosition,
  createTextureBuffers,
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

describe('computeWireframeEdges', () => {
  it('兩個三角形共用一條邊 → 共用邊只算一次（5 條邊，10 個索引）', () => {
    const edges = computeWireframeEdges(quadMesh().indices);
    expect(edges.length).toBe(10);

    const pairs = new Set<string>();
    for (let i = 0; i < edges.length; i += 2) {
      const [a, b] = [edges[i]!, edges[i + 1]!];
      pairs.add(a < b ? `${a}_${b}` : `${b}_${a}`);
    }
    expect(pairs).toEqual(new Set(['0_1', '1_2', '0_2', '2_3', '0_3']));
  });

  it('沒有三角形 → 空陣列', () => {
    expect(computeWireframeEdges(new Uint32Array(0))).toEqual(new Uint32Array(0));
  });

  it('單一三角形 → 三條邊', () => {
    const edges = computeWireframeEdges(new Uint32Array([0, 1, 2]));
    expect(edges.length).toBe(6);
  });
});

// 投影公式本身（worldToScreen / screenToWorld）測在 src/camera/project.test.ts；
// 這裡只驗 containerPosition 是它在世界原點的特例。
describe('containerPosition', () => {
  it('camera 在原點、scale 1 → container 位在畫布中心', () => {
    expect(containerPosition({ x: 0, y: 0, scale: 1 }, 800, 600)).toEqual({ x: 400, y: 300 });
  });

  it('平移 camera → container 反向位移 scale 倍', () => {
    expect(containerPosition({ x: 100, y: 50, scale: 2 }, 800, 600)).toEqual({
      x: 400 - 200,
      y: 300 - 100,
    });
  });
});
