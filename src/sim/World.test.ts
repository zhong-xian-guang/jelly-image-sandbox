import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, type BuildSimMeshParams } from '../mesh';
import { gridMesh } from './testFixtures';
import type { InputEvent } from './types';
import { WalledBoundary } from './boundary';
import { type MeshProvider, type SceneEntry, World } from './World';

/**
 * 固定的 `meshProvider`：不管來源是什麼都給一張 5×5 頂點的方格（`importSize` 決定
 * 邊長——`null` 時 40×40、否則最長邊 = `importSize`），讓「匯入尺寸有沒有傳到位」
 * 在 bbox 上看得出來。呼叫紀錄留著讓測試能斷言參數原樣轉交。
 */
function fixtureProvider(): MeshProvider & { calls: Parameters<MeshProvider>[] } {
  const calls: Parameters<MeshProvider>[] = [];
  const provider = ((sourceId, meshParams, importSize) => {
    calls.push([sourceId, meshParams, importSize]);
    return gridMesh(5, 5, importSize === null ? 10 : importSize / 4);
  }) as MeshProvider & { calls: Parameters<MeshProvider>[] };
  provider.calls = calls;
  return provider;
}

const MESH_PARAMS: BuildSimMeshParams = { ...DEFAULT_PARAMS, targetParticleCount: 200 };

function spawnEvent(
  jellyId: string,
  offset: { x: number; y: number },
  importSize: number | null = null,
): InputEvent {
  return { type: 'spawn', jellyId, sourceId: 'src/1', meshParams: MESH_PARAMS, importSize, offset };
}

/** 兩塊並排：A（`jelly/1`）在原點 40×40、B（`jelly/2`）在 x = 100 起 40×40。 */
function twoJellies(): { world: World; provider: ReturnType<typeof fixtureProvider> } {
  const provider = fixtureProvider();
  const world = new World(provider);
  world.applyInput(spawnEvent('jelly/1', { x: 0, y: 0 }));
  world.applyInput(spawnEvent('jelly/2', { x: 100, y: 0 }));
  return { world, provider };
}

function run(world: World, frames: number): void {
  for (let f = 0; f < frames; f++) world.step(1 / 60);
}

describe('World — 多塊共存（issue #95 / V3 T3-2）', () => {
  it('spawn 兩塊 → jellies() 兩筆依 id 排序、rest 座標含 offset、bbox() 為聯集', () => {
    const { world, provider } = twoJellies();
    const views = world.jellies();
    expect(views.map((j) => j.id)).toEqual(['jelly/1', 'jelly/2']);
    expect(views[1]!.positions[0]).toBe(100); // B 第一個 Particle x = 0 + offset 100
    expect(world.bbox()).toEqual({ minX: 0, minY: 0, maxX: 140, maxY: 40 });
    expect(provider.calls).toEqual([
      ['src/1', MESH_PARAMS, null],
      ['src/1', MESH_PARAMS, null],
    ]);
  });

  it('同 id 重複 spawn 為 no-op（不重建、不搬位置）', () => {
    const { world, provider } = twoJellies();
    world.applyInput({ type: 'grab', id: 'g', x: 20, y: 20 });
    world.applyInput({ type: 'moveGrab', id: 'g', x: 60, y: 20 });
    run(world, 10);
    const before = Array.from(world.jellies()[0]!.positions);
    world.applyInput(spawnEvent('jelly/1', { x: 500, y: 500 }));
    expect(world.jellies().length).toBe(2);
    expect(Array.from(world.jellies()[0]!.positions)).toEqual(before);
    expect(provider.calls.length).toBe(2);
  });

  it('importSize 轉交 meshProvider：bbox 最長邊 = importSize', () => {
    const provider = fixtureProvider();
    const world = new World(provider);
    world.applyInput(spawnEvent('jelly/1', { x: 0, y: 0 }, 80));
    expect(world.bbox()).toEqual({ minX: 0, minY: 0, maxX: 80, maxY: 80 });
  });

  it('空場：bbox() 為 null、step／pick 不丟錯、計數為 0', () => {
    const world = new World(fixtureProvider());
    expect(world.bbox()).toBeNull();
    expect(() => run(world, 3)).not.toThrow();
    expect(world.pick(0, 0)).toBeNull();
    expect(world.listPins()).toEqual([]);
    expect(world.grabCount).toBe(0);
    expect(world.pinCount).toBe(0);
    world.applyInput({ type: 'remove', jellyId: 'jelly/9' }); // 不存在 → no-op
    world.applyInput({ type: 'grab', id: 'g', x: 0, y: 0 }); // 沒東西可抓 → no-op
    expect(world.grabCount).toBe(0);
  });
});

describe('World — 事件路由', () => {
  it('remove 後那塊的 Pin 從 listPins() 消失、後續 moveGrab／unpin 為 no-op', () => {
    const { world } = twoJellies();
    world.applyInput({ type: 'pin', id: 'pA', x: 10, y: 10 });
    world.applyInput({ type: 'pin', id: 'pB', x: 110, y: 10 });
    world.applyInput({ type: 'grab', id: 'gB', x: 120, y: 20 });
    expect(world.listPins().map((p) => [p.id, p.jellyId])).toEqual([
      ['pA', 'jelly/1'],
      ['pB', 'jelly/2'],
    ]);
    expect(world.grabCount).toBe(1);

    world.applyInput({ type: 'remove', jellyId: 'jelly/2' });
    expect(world.jellies().map((j) => j.id)).toEqual(['jelly/1']);
    expect(world.listPins().map((p) => p.id)).toEqual(['pA']);
    expect(world.grabCount).toBe(0);
    expect(() => {
      world.applyInput({ type: 'moveGrab', id: 'gB', x: 300, y: 300 });
      world.applyInput({ type: 'unpin', id: 'pB' });
      world.applyInput({ type: 'release', id: 'gB' });
    }).not.toThrow();
    run(world, 5);
    expect(world.restAttachPoint('gB')).toBeNull();
    expect(world.restAttachPoint('pA')).toEqual({ x: 10, y: 10 });
  });

  it('重疊處 grab 命中 id 較大者（後生成在上）', () => {
    const provider = fixtureProvider();
    const world = new World(provider);
    world.applyInput(spawnEvent('jelly/1', { x: 0, y: 0 }));
    world.applyInput(spawnEvent('jelly/2', { x: 20, y: 20 })); // 與 A 在 [20,40]² 重疊
    world.applyInput(spawnEvent('jelly/10', { x: 30, y: 30 })); // 字串排序會排在 jelly/2 前面，數字排序才對
    expect(world.pick(35, 35)?.jellyId).toBe('jelly/10');
    expect(world.pick(25, 25)?.jellyId).toBe('jelly/2');
    expect(world.pick(5, 5)?.jellyId).toBe('jelly/1');
    world.applyInput({ type: 'grab', id: 'g', x: 25, y: 25 });
    world.applyInput({ type: 'moveGrab', id: 'g', x: 25, y: -60 });
    run(world, 30);
    // 被拉走的是 jelly/2：它的 bbox 往上（−y）伸出去、jelly/1 沒動。
    const [a, b] = world.jellies();
    const minY = (p: Float64Array) =>
      Math.min(...Array.from({ length: p.length / 2 }, (_, i) => p[2 * i + 1]!));
    expect(minY(b!.positions)).toBeLessThan(0);
    expect(minY(a!.positions)).toBeCloseTo(0, 6);
  });

  it('塊外近處 grab 吸附到跨塊最近的 Particle；離所有塊都太遠則 no-op', () => {
    const { world } = twoJellies();
    // (72, 20)：離 A 右緣 (40, 20) 32、離 B 左緣 (100, 20) 28 → B 較近。
    // 兩塊預設吸附半徑 = 對角線 56.6 × 0.1 ≈ 5.7，所以用 radius 覆寫。
    world.applyInput({ type: 'grab', id: 'g', x: 72, y: 20, radius: 40 });
    expect(world.grabCount).toBe(1);
    world.applyInput({ type: 'moveGrab', id: 'g', x: 72, y: -50 });
    run(world, 20);
    const [a, b] = world.jellies();
    expect(b!.positions[2 * 10 + 1]).toBeLessThan(-10); // B 左緣中點（index 10 = 格點 (0,2)）被拉上去
    expect(a!.positions[2 * 14 + 1]).toBeCloseTo(20, 6); // A 右緣中點（index 14 = 格點 (4,2)）沒動
    world.applyInput({ type: 'release', id: 'g' });
    world.applyInput({ type: 'grab', id: 'far', x: 70, y: 20 }); // 預設半徑 ≈ 5.7 → 兩塊都搆不到
    expect(world.grabCount).toBe(0);
  });

  it('不帶座標的 pin 把既有 Grab 就地凍結、movePin／unpin 循路由表到同一塊', () => {
    const { world } = twoJellies();
    world.applyInput({ type: 'grab', id: 'g', x: 120, y: 20 });
    world.applyInput({ type: 'pin', id: 'g' });
    expect(world.pinCount).toBe(1);
    expect(world.listPins()[0]!.jellyId).toBe('jelly/2');
    world.applyInput({ type: 'movePin', id: 'g', x: 120, y: 60 });
    run(world, 60);
    expect(world.listPins()[0]!.point.y).toBeCloseTo(60, 3);
    world.applyInput({ type: 'unpin', id: 'g' });
    expect(world.pinCount).toBe(0);
    expect(world.restAttachPoint('g')).toBeNull();
  });

  it('tap 在塊外時作用在最近的那塊', () => {
    const { world } = twoJellies();
    // (95, 20)：離 B 左緣 5、離 A 右緣 55——B 的 Tap 半徑 = 對角線 56.6 × 0.2 ≈ 11.3，搆得到。
    world.applyInput({ type: 'tap', x: 95, y: 20 });
    world.step(1 / 60);
    const [a, b] = world.jellies();
    expect(b!.positions[2 * 10]).toBeLessThan(99.5); // B 左緣中點被往拍擊點（−x）拉
    expect(a!.positions[2 * 14]).toBeCloseTo(40, 6); // A 沒動
  });

  it('setFan 兩塊都受影響、之後 spawn 的塊也被吹；clearFan 後新塊不動', () => {
    const { world } = twoJellies();
    world.applyInput({
      type: 'setFan',
      originX: -50,
      originY: 20,
      dirX: 1,
      dirY: 0,
      length: 400,
      width: 300,
      strength: 3000,
      falloffExponent: 1,
      frequency: 60,
    });
    expect(world.fanState()?.length).toBe(400);
    world.applyInput(spawnEvent('jelly/3', { x: 0, y: 100 })); // 風扇矩形內（y ∈ [−130, 170]）
    run(world, 30);
    for (const j of world.jellies()) {
      expect(j.positions[0]).toBeGreaterThan(j.id === 'jelly/2' ? 105 : 5);
    }
    world.applyInput({ type: 'clearFan' });
    expect(world.fanState()).toBeNull();
    world.applyInput(spawnEvent('jelly/4', { x: 0, y: 300 }));
    run(world, 30);
    expect(world.jellies()[3]!.positions[0]).toBe(0);
  });

  it('clearPins 清全場、保留 Grab；清掉的 id 可重用', () => {
    const { world } = twoJellies();
    world.applyInput({ type: 'pin', id: 'pA', x: 10, y: 10 });
    world.applyInput({ type: 'pin', id: 'pB', x: 110, y: 10 });
    world.applyInput({ type: 'grab', id: 'g', x: 20, y: 20 });
    world.applyInput({ type: 'clearPins' });
    expect(world.pinCount).toBe(0);
    expect(world.listPins()).toEqual([]);
    expect(world.grabCount).toBe(1);
    world.applyInput({ type: 'pin', id: 'pA', x: 112, y: 12 });
    expect(world.listPins()[0]!.jellyId).toBe('jelly/2');
  });
});

describe('World — Scene 與 reset', () => {
  it('setScene + 額外 spawn + remove + 拉扯後 reset() → 場上等於 Scene、每塊回 rest、約束與風扇清空', () => {
    const { world } = twoJellies();
    world.setScene(world.sceneSnapshot());
    world.applyInput(spawnEvent('jelly/3', { x: 200, y: 0 })); // 錄製式生成，不在 Scene
    world.applyInput({ type: 'remove', jellyId: 'jelly/1' });
    world.applyInput({ type: 'pin', id: 'p', x: 110, y: 10 });
    world.applyInput({ type: 'grab', id: 'g', x: 120, y: 20 });
    world.applyInput({ type: 'moveGrab', id: 'g', x: 180, y: 80 });
    world.applyInput({
      type: 'setFan',
      originX: 0,
      originY: 0,
      dirX: 1,
      dirY: 0,
      length: 100,
      width: 100,
      strength: 100,
      falloffExponent: 1,
      frequency: 1,
    });
    run(world, 20);
    world.reset();
    expect(world.jellies().map((j) => j.id)).toEqual(['jelly/1', 'jelly/2']);
    for (const j of world.jellies()) {
      expect(Array.from(j.positions)).toEqual(Array.from(j.mesh.positions));
    }
    expect(world.grabCount + world.pinCount).toBe(0);
    expect(world.fanState()).toBeNull();
    run(world, 30);
    for (const j of world.jellies()) {
      expect(Array.from(j.positions)).toEqual(Array.from(j.mesh.positions)); // 靜置不動
    }
  });

  it('Scene 裡同 id 但參數不同的塊 reset() 時整塊重建', () => {
    const { world } = twoJellies();
    const scene = world.sceneSnapshot();
    scene[1] = { ...scene[1]!, importSize: 80, offset: { x: 300, y: 0 } };
    world.setScene(scene);
    world.reset();
    const b = world.jellies()[1]!;
    expect(b.positions[0]).toBe(300);
    expect(world.bbox()).toEqual({ minX: 0, minY: 0, maxX: 380, maxY: 80 });
  });

  it('sceneSnapshot() 對得上 spawn 的參數（深拷貝、依 id 排序）', () => {
    const provider = fixtureProvider();
    const world = new World(provider);
    world.applyInput(spawnEvent('jelly/2', { x: 5, y: 6 }, 64));
    world.applyInput(spawnEvent('jelly/1', { x: 0, y: 0 }));
    const snap = world.sceneSnapshot();
    expect(snap).toEqual([
      {
        jellyId: 'jelly/1',
        sourceId: 'src/1',
        meshParams: MESH_PARAMS,
        importSize: null,
        offset: { x: 0, y: 0 },
      },
      {
        jellyId: 'jelly/2',
        sourceId: 'src/1',
        meshParams: MESH_PARAMS,
        importSize: 64,
        offset: { x: 5, y: 6 },
      },
    ]);
    snap[0]!.offset.x = 999;
    expect(world.sceneSnapshot()[0]!.offset.x).toBe(0);
    const scene: SceneEntry[] = snap;
    world.setScene(scene);
    scene[1]!.importSize = 1;
    world.reset();
    expect(world.jellies()[1]!.positions[0]).toBe(5); // setScene 已深拷貝，外部再改不影響
  });
});

describe('World — 全域參數與決定性', () => {
  it('applyParams 套到每塊：開重力後兩塊都往下掉；cellFrac 改動不丟錯', () => {
    const { world } = twoJellies();
    world.applyParams({ gravity: 2000 });
    run(world, 30);
    for (const j of world.jellies()) expect(j.positions[1]).toBeGreaterThan(50);
    world.applyParams({ cellFrac: 0.3, alphaSm: 0.5 });
    expect(world.params.cellFrac).toBe(0.3);
    expect(() => run(world, 5)).not.toThrow();
  });

  it('setBoundary 套到每塊與之後 spawn 的塊：Walled 箱擋住三塊落下', () => {
    const { world } = twoJellies();
    world.setBoundary(new WalledBoundary({ minX: -100, minY: -100, maxX: 300, maxY: 60 }));
    world.applyInput(spawnEvent('jelly/3', { x: 200, y: 0 }));
    world.applyParams({ gravity: 3000 });
    run(world, 120);
    expect(world.bbox()!.maxY).toBeLessThanOrEqual(60 + 1e-6);
  });

  it('同一段輸入跑兩次，所有塊的位置位元相同', () => {
    const script = (world: World) => {
      world.applyInput(spawnEvent('jelly/1', { x: 0, y: 0 }));
      world.applyInput(spawnEvent('jelly/2', { x: 100, y: 0 }));
      world.applyParams({ gravity: 500 });
      world.applyInput({
        type: 'setFan',
        originX: -50,
        originY: 20,
        dirX: 1,
        dirY: 0,
        length: 300,
        width: 100,
        strength: 2000,
        falloffExponent: 1,
        frequency: 5,
      });
      world.applyInput({ type: 'pin', id: 'p', x: 10, y: 10 });
      world.applyInput({ type: 'grab', id: 'g', x: 120, y: 20 });
      for (let f = 0; f < 10; f++) {
        world.applyInput({ type: 'moveGrab', id: 'g', x: 120 + 10 * f, y: 20 + 5 * f });
        world.step(1 / 60);
      }
      world.applyInput({ type: 'release', id: 'g' });
      world.applyInput({ type: 'tap', x: 20, y: 20 });
      run(world, 60);
      return world.jellies().map((j) => Array.from(j.positions));
    };
    expect(script(new World(fixtureProvider()))).toEqual(script(new World(fixtureProvider())));
  });
});
