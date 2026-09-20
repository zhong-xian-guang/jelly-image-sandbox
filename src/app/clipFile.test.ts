/**
 * `clipFile` 的單元測試——`serializeClip`（issue #57 / V2 T2-4；issue #95 升 v2）：產出合法
 * `version: 2` JSON、涵蓋所有欄位、每張來源圖 `bytes` 走 base64 逐位元組還原、多塊共用同一
 * `sourceId` 只存一份、不改動傳入的 `ClipState`。`parseClipFile`（issue #58 / V2 T2-5）：
 * `serializeClip` → `parseClipFile` round-trip 深度相等、v1 字串遷移成單塊 Scene、各類壞檔
 * （非 JSON／版本不符／欄位缺或型別錯／Scene 引用不存在的來源）丟 `ClipFileError`。
 * prior art：`src/app/track/groups.test.ts`、`src/app/demos/overlay.test.ts`。
 */

import { describe, expect, it } from 'vitest';

import type { BuildSimMeshParams } from '../mesh';
import {
  CLIP_FILE_VERSION,
  ClipFileError,
  clipFileTimestamp,
  parseClipFile,
  serializeClip,
  type ClipState,
} from './clipFile';

/** test-only：base64 → bytes。 */
function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const MESH_PARAMS: BuildSimMeshParams = {
  maxMaskEdge: 1024,
  alphaThreshold: 0.5,
  simplifyTolerance: 1.5,
  targetParticleCount: 175, // 效能退路砍半後的值
  minTriangleArea: 0.5,
  minTriangleAngleDeg: 15,
  refineMinAngleDeg: 25,
  refineMaxAreaFactor: 2,
  refineMaxPasses: 30,
};

/**
 * 涵蓋所有欄位的 `ClipState`：兩張來源圖、三塊 Scene（其中兩塊共用 `src/1`）、改過名的
 * Track、多群組、非空 setupPins、砍半的 targetParticleCount、walled 邊界。
 */
function fullClip(): ClipState {
  return {
    sources: {
      // 含 0 與 255，確保 base64 邊界值也逐位元組還原。
      'src/1': { format: 'gif', bytes: new Uint8Array([0, 1, 2, 127, 128, 200, 253, 254, 255]) },
      'src/2': { format: 'png', bytes: new Uint8Array([137, 80, 78, 71]) },
    },
    scene: [
      {
        jellyId: 'jelly/1',
        sourceId: 'src/1',
        meshParams: MESH_PARAMS,
        importSize: 512,
        offset: { x: 0, y: 0 },
      },
      {
        jellyId: 'jelly/2',
        sourceId: 'src/2',
        meshParams: { ...MESH_PARAMS, targetParticleCount: 350 },
        importSize: 256,
        offset: { x: 300.5, y: -12 },
      },
      {
        jellyId: 'jelly/3',
        sourceId: 'src/1',
        meshParams: MESH_PARAMS,
        importSize: null, // 從 v1 檔遷移、未重建的塊
        offset: { x: -80, y: 40 },
      },
    ],
    sim: { softness: 0.73, tapStrength: 4200, boundary: 'walled', gravity: 0 },
    tracks: [
      {
        id: 't1',
        kind: 'action',
        name: '左上角慢慢拉', // 使用者改過的名字
        startStep: 12,
        inStep: 3,
        outStep: 240,
        steps: [
          { atStep: 0, event: { type: 'grab', id: 1, x: 3, y: 4 } },
          { atStep: 30, event: { type: 'release', id: 1 } },
          {
            atStep: 40,
            event: {
              type: 'spawn',
              jellyId: 'jelly/4',
              sourceId: 'src/2',
              meshParams: MESH_PARAMS,
              importSize: 128,
              offset: { x: 1, y: 2 },
            },
          },
          { atStep: 50, event: { type: 'remove', jellyId: 'jelly/4' } },
        ],
        startCamera: null,
        groupIds: ['default', 'g1'],
      },
      {
        id: 't2',
        kind: 'camera',
        name: '相機軌 2（平移）', // 未改名時的自動摘要
        startStep: 0,
        inStep: 6,
        outStep: 180,
        steps: [{ atStep: 0, event: { type: 'panBy', dxScreen: 10, dyScreen: -5 } }],
        startCamera: {
          transform: { x: 1, y: 2, scale: 3 },
          followEnabled: false,
          sinceManualSeconds: 0,
          framing: false,
        },
        groupIds: ['g1'],
      },
    ],
    groups: [
      { id: 'default', name: '預設', enabled: true },
      { id: 'g1', name: '群組 1', enabled: false },
    ],
    setupPins: [
      { x: 10.5, y: -20.25 },
      { x: 0, y: 0 },
    ],
    counters: { nextTrackNum: 3, nextGroupNum: 2, nextJellyNum: 5, nextSourceNum: 3 },
  };
}

/** 一份 V2 時期（issue #57–#91）存出的 v1 片段檔文件（`image`／`meshParams`／`importSize` 在頂層）。 */
function v1Document(): Record<string, unknown> {
  return {
    version: 1,
    image: { format: 'jpeg', bytes: btoa(String.fromCharCode(0, 255, 128, 1, 254)) },
    meshParams: MESH_PARAMS,
    importSize: 384,
    sim: { softness: 0.4, tapStrength: 6000, boundary: 'floor', gravity: 2000 },
    tracks: [
      {
        id: 't1',
        kind: 'action',
        name: '動作軌 1（拖曳）',
        startStep: 0,
        inStep: 0,
        outStep: 30,
        steps: [
          { atStep: 0, event: { type: 'grab', id: 1, x: 3, y: 4 } },
          { atStep: 30, event: { type: 'release', id: 1 } },
        ],
        startCamera: null,
        groupIds: ['default'],
      },
    ],
    groups: [{ id: 'default', name: '預設', enabled: true }],
    setupPins: [{ x: 5, y: 6 }],
    counters: { nextTrackNum: 2, nextGroupNum: 1 },
  };
}

describe('serializeClip', () => {
  it('產出合法 JSON，帶 version: 2', () => {
    const parsed = JSON.parse(serializeClip(fullClip()));
    expect(parsed.version).toBe(CLIP_FILE_VERSION);
    expect(CLIP_FILE_VERSION).toBe(2);
  });

  it('sources：每張來源圖格式原樣、bytes 走 base64 逐位元組還原；共用同一 sourceId 的塊只存一份', () => {
    const clip = fullClip();
    const parsed = JSON.parse(serializeClip(clip));
    expect(Object.keys(parsed.sources)).toEqual(['src/1', 'src/2']);
    expect(parsed.sources['src/1'].format).toBe('gif');
    expect(typeof parsed.sources['src/1'].bytes).toBe('string');
    expect(Array.from(decodeBase64(parsed.sources['src/1'].bytes))).toEqual(
      Array.from(clip.sources['src/1']!.bytes),
    );
    expect(Array.from(decodeBase64(parsed.sources['src/2'].bytes))).toEqual([137, 80, 78, 71]);
    // 三塊 Scene 只引用兩張圖：檔案裡沒有第三份影像。
    expect(JSON.stringify(parsed).split(parsed.sources['src/1'].bytes).length - 1).toBe(1);
  });

  it('scene：每塊的 jellyId／sourceId／完整 meshParams／importSize（含 null）／offset 原樣保留', () => {
    const clip = fullClip();
    const parsed = JSON.parse(serializeClip(clip));
    expect(parsed.scene).toEqual(clip.scene);
    expect(parsed.scene[0].meshParams.targetParticleCount).toBe(175);
    expect(parsed.scene[2].importSize).toBeNull();
  });

  it('頂層不再有 v1 的 image／meshParams／importSize', () => {
    const parsed = JSON.parse(serializeClip(fullClip())) as Record<string, unknown>;
    expect('image' in parsed).toBe(false);
    expect('meshParams' in parsed).toBe(false);
    expect('importSize' in parsed).toBe(false);
  });

  it('sim：軟硬度 0–1 值、輕拍力道、邊界模式、重力原樣保留', () => {
    const parsed = JSON.parse(serializeClip(fullClip()));
    expect(parsed.sim).toEqual({
      softness: 0.73,
      tapStrength: 4200,
      boundary: 'walled',
      gravity: 0,
    });
  });

  it('tracks：含名字、起始、頭尾修剪、steps（含 spawn／remove 事件）、相機軌起點快照、groupIds（陣列）', () => {
    const clip = fullClip();
    const parsed = JSON.parse(serializeClip(clip));
    expect(parsed.tracks).toEqual(clip.tracks);
    expect(Array.isArray(parsed.tracks[0].groupIds)).toBe(true);
    expect(parsed.tracks[0].groupIds).toEqual(['default', 'g1']);
    expect(parsed.tracks[1].startCamera.transform).toEqual({ x: 1, y: 2, scale: 3 });
  });

  it('groups：id / name / enabled 原樣保留', () => {
    const parsed = JSON.parse(serializeClip(fullClip()));
    expect(parsed.groups).toEqual([
      { id: 'default', name: '預設', enabled: true },
      { id: 'g1', name: '群組 1', enabled: false },
    ]);
  });

  it('setupPins：{ x, y }[] 原樣保留', () => {
    const parsed = JSON.parse(serializeClip(fullClip()));
    expect(parsed.setupPins).toEqual([
      { x: 10.5, y: -20.25 },
      { x: 0, y: 0 },
    ]);
  });

  it('counters：四個流水號原樣保留', () => {
    const parsed = JSON.parse(serializeClip(fullClip()));
    expect(parsed.counters).toEqual({
      nextTrackNum: 3,
      nextGroupNum: 2,
      nextJellyNum: 5,
      nextSourceNum: 3,
    });
  });

  it('不改動傳入的 ClipState，且冪等', () => {
    const clip = fullClip();
    const first = serializeClip(clip);
    const second = serializeClip(clip);
    expect(second).toBe(first);
    expect(Array.from(clip.sources['src/1']!.bytes)).toEqual([
      0, 1, 2, 127, 128, 200, 253, 254, 255,
    ]);
    expect(clip.tracks[0]!.groupIds).toEqual(['default', 'g1']);
    expect(clip).toEqual(fullClip());
  });

  it('空 scene / tracks / groups / setupPins 也能序列化（「清空全部」後的空桌面）', () => {
    const clip = fullClip();
    const empty: ClipState = {
      ...clip,
      sources: { 'src/1': { format: 'png', bytes: new Uint8Array([137, 80, 78, 71]) } },
      scene: [],
      tracks: [],
      groups: [{ id: 'default', name: '預設', enabled: true }],
      setupPins: [],
    };
    const parsed = JSON.parse(serializeClip(empty));
    expect(parsed.scene).toEqual([]);
    expect(parsed.tracks).toEqual([]);
    expect(parsed.setupPins).toEqual([]);
    expect(Array.from(decodeBase64(parsed.sources['src/1'].bytes))).toEqual([137, 80, 78, 71]);
  });
});

describe('parseClipFile', () => {
  it('round-trip：serializeClip → parseClipFile 對全欄位 ClipState 深度相等', () => {
    const clip = fullClip();
    const parsed = parseClipFile(serializeClip(clip));
    expect(parsed).toEqual(clip);
    expect(Array.from(parsed.sources['src/1']!.bytes)).toEqual(
      Array.from(clip.sources['src/1']!.bytes),
    );
  });

  it('round-trip：空 scene / tracks / groups / setupPins', () => {
    const clip: ClipState = {
      ...fullClip(),
      sources: { 'src/1': { format: 'png', bytes: new Uint8Array([137, 80, 78, 71]) } },
      scene: [],
      tracks: [],
      groups: [{ id: 'default', name: '預設', enabled: true }],
      setupPins: [],
    };
    expect(parseClipFile(serializeClip(clip))).toEqual(clip);
  });

  it('round-trip：sources bytes 含 0 與 255 邊界值逐位元組還原', () => {
    const clip: ClipState = {
      ...fullClip(),
      sources: {
        'src/1': { format: 'jpeg', bytes: new Uint8Array([0, 255, 128, 1, 254]) },
        'src/2': { format: 'png', bytes: new Uint8Array([1]) },
      },
    };
    expect(Array.from(parseClipFile(serializeClip(clip)).sources['src/1']!.bytes)).toEqual([
      0, 255, 128, 1, 254,
    ]);
  });

  it('非 JSON → ClipFileError', () => {
    expect(() => parseClipFile('這不是 JSON {{{')).toThrow(ClipFileError);
  });

  it('version 不是已知值（3、0、字串）→ ClipFileError', () => {
    for (const bad of [3, 0, '2']) {
      const doc = { ...JSON.parse(serializeClip(fullClip())), version: bad };
      expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
    }
  });

  it('頂層不是物件（例如陣列）→ ClipFileError', () => {
    expect(() => parseClipFile('[1, 2, 3]')).toThrow(ClipFileError);
  });

  it('sources 欄位缺失 → ClipFileError', () => {
    const doc = JSON.parse(serializeClip(fullClip())) as Record<string, unknown>;
    delete doc.sources;
    expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
  });

  it('sources[].bytes 不是合法 base64 → ClipFileError', () => {
    const doc = JSON.parse(serializeClip(fullClip())) as {
      sources: Record<string, { bytes: string }>;
    };
    doc.sources['src/2']!.bytes = '不是 base64！！！';
    expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
  });

  it('sources[].format 不是已知格式 → ClipFileError', () => {
    const doc = JSON.parse(serializeClip(fullClip())) as {
      sources: Record<string, { format: string }>;
    };
    doc.sources['src/1']!.format = 'webp';
    expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
  });

  it('scene[].meshParams 欄位型別錯（字串取代數字）→ ClipFileError', () => {
    const doc = JSON.parse(serializeClip(fullClip())) as {
      scene: { meshParams: Record<string, unknown> }[];
    };
    doc.scene[1]!.meshParams.targetParticleCount = '350';
    expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
  });

  it('scene 引用不存在的 sourceId → ClipFileError', () => {
    const doc = JSON.parse(serializeClip(fullClip())) as { scene: { sourceId: string }[] };
    doc.scene[2]!.sourceId = 'src/9';
    expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
  });

  it('Track 裡的 spawn 事件引用不存在的 sourceId → ClipFileError', () => {
    const doc = JSON.parse(serializeClip(fullClip())) as {
      tracks: { steps: { event: Record<string, unknown> }[] }[];
    };
    doc.tracks[0]!.steps[2]!.event.sourceId = 'src/9';
    expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
  });

  it('scene[].offset 缺失或 importSize 非正數 → ClipFileError', () => {
    const noOffset = JSON.parse(serializeClip(fullClip())) as { scene: Record<string, unknown>[] };
    delete noOffset.scene[0]!.offset;
    expect(() => parseClipFile(JSON.stringify(noOffset))).toThrow(ClipFileError);
    for (const bad of [0, -1, '512', true]) {
      const doc = JSON.parse(serializeClip(fullClip())) as { scene: Record<string, unknown>[] };
      doc.scene[0]!.importSize = bad;
      expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
    }
  });

  it("sim.boundary: 'floor' round-trip（issue #92）", () => {
    const clip = fullClip();
    clip.sim.boundary = 'floor';
    expect(parseClipFile(serializeClip(clip)).sim.boundary).toBe('floor');
  });

  it('sim.boundary 不是已知值 → ClipFileError', () => {
    const doc = JSON.parse(serializeClip(fullClip())) as { sim: Record<string, unknown> };
    doc.sim.boundary = 'bouncy';
    expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
  });

  it('tracks 不是陣列 → ClipFileError', () => {
    const doc = JSON.parse(serializeClip(fullClip())) as Record<string, unknown>;
    doc.tracks = { t1: {} };
    expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
  });

  it('tracks[].kind 不是已知值 → ClipFileError', () => {
    const doc = JSON.parse(serializeClip(fullClip())) as { tracks: Record<string, unknown>[] };
    doc.tracks[0]!.kind = 'audio';
    expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
  });

  it('counters 欄位缺失（含新的 nextJellyNum）→ ClipFileError', () => {
    const doc = JSON.parse(serializeClip(fullClip())) as { counters: Record<string, unknown> };
    delete doc.counters.nextJellyNum;
    expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
  });
});

describe('v1 片段檔遷移（issue #95 / V3 T3-2；ADR-0013）', () => {
  it('v1 字串 → 單塊 Scene：sources = { src/1: image }、jelly/1 用頂層 meshParams／importSize、offset (0,0)、流水號 2', () => {
    const parsed = parseClipFile(JSON.stringify(v1Document()));
    expect(Object.keys(parsed.sources)).toEqual(['src/1']);
    expect(parsed.sources['src/1']!.format).toBe('jpeg');
    expect(Array.from(parsed.sources['src/1']!.bytes)).toEqual([0, 255, 128, 1, 254]);
    expect(parsed.scene).toEqual([
      {
        jellyId: 'jelly/1',
        sourceId: 'src/1',
        meshParams: MESH_PARAMS,
        importSize: 384,
        offset: { x: 0, y: 0 },
      },
    ]);
    expect(parsed.counters).toEqual({
      nextTrackNum: 2,
      nextGroupNum: 1,
      nextJellyNum: 2,
      nextSourceNum: 2,
    });
    // 其餘欄位原樣。
    expect(parsed.sim).toEqual({
      softness: 0.4,
      tapStrength: 6000,
      boundary: 'floor',
      gravity: 2000,
    });
    expect(parsed.tracks).toEqual(v1Document().tracks);
    expect(parsed.groups).toEqual([{ id: 'default', name: '預設', enabled: true }]);
    expect(parsed.setupPins).toEqual([{ x: 5, y: 6 }]);
  });

  it('v1 檔沒有 importSize → 那塊 importSize 為 null（未縮放）；沒有 sim.gravity → 0', () => {
    const doc = v1Document();
    delete doc.importSize;
    delete (doc.sim as Record<string, unknown>).gravity;
    const parsed = parseClipFile(JSON.stringify(doc));
    expect(parsed.scene[0]!.importSize).toBeNull();
    expect(parsed.sim.gravity).toBe(0);
  });

  it('遷移後再存永遠是 v2（round-trip 穩定）', () => {
    const migrated = parseClipFile(JSON.stringify(v1Document()));
    const text = serializeClip(migrated);
    expect(JSON.parse(text).version).toBe(2);
    expect(parseClipFile(text)).toEqual(migrated);
  });

  it('v1 檔壞掉（image 缺失／meshParams 型別錯）仍 → ClipFileError', () => {
    const noImage = v1Document();
    delete noImage.image;
    expect(() => parseClipFile(JSON.stringify(noImage))).toThrow(ClipFileError);
    const badMesh = v1Document();
    (badMesh.meshParams as Record<string, unknown>) = { ...MESH_PARAMS, maxMaskEdge: 'big' };
    expect(() => parseClipFile(JSON.stringify(badMesh))).toThrow(ClipFileError);
  });
});

describe('sim.gravity（issue #91 / V3 T2-1）', () => {
  it('round-trip：正數原樣還原', () => {
    const clip: ClipState = { ...fullClip(), sim: { ...fullClip().sim, gravity: 1500 } };
    expect(parseClipFile(serializeClip(clip)).sim.gravity).toBe(1500);
  });

  it('v2 檔沒有 sim.gravity 欄位 → 0', () => {
    const doc = JSON.parse(serializeClip(fullClip())) as { sim: Record<string, unknown> };
    delete doc.sim.gravity;
    expect(parseClipFile(JSON.stringify(doc))).toEqual(fullClip());
  });

  it('負數 → ClipFileError', () => {
    for (const bad of [-1, -500]) {
      const doc = JSON.parse(serializeClip(fullClip())) as { sim: Record<string, unknown> };
      doc.sim.gravity = bad;
      expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
    }
  });

  it('非數字（字串／布林／null／物件）→ ClipFileError', () => {
    for (const bad of ['500', true, null, {}]) {
      const doc = JSON.parse(serializeClip(fullClip())) as { sim: Record<string, unknown> };
      doc.sim.gravity = bad;
      expect(() => parseClipFile(JSON.stringify(doc))).toThrow(ClipFileError);
    }
  });
});

describe('clipFileTimestamp', () => {
  it('YYYYMMDD-HHMMSS，月份 +1、個位數補零', () => {
    // 2026-09-04 08:07:05（本地時間）
    expect(clipFileTimestamp(new Date(2026, 8, 4, 8, 7, 5))).toBe('20260904-080705');
  });

  it('雙位數時分秒與十二月不補零錯位', () => {
    expect(clipFileTimestamp(new Date(2026, 11, 25, 14, 30, 59))).toBe('20261225-143059');
  });
});
