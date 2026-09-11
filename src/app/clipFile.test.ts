/**
 * `clipFile` 序列化端的單元測試（issue #57 / V2 T2-4）——聚焦 `serializeClip`：
 * 產出合法 `version: 1` JSON、涵蓋所有欄位、`image.bytes` 走 base64 逐位元組還原、
 * 不改動傳入的 `ClipState`。`parseClipFile`（反向）由 issue #58 補完，不在此測。
 * prior art：`src/app/track/groups.test.ts`、`src/app/demos/overlay.test.ts`。
 */

import { describe, expect, it } from 'vitest';

import { CLIP_FILE_VERSION, clipFileTimestamp, serializeClip, type ClipState } from './clipFile';

/** test-only：base64 → bytes（模組本身只做編碼，解碼由 issue #58 補）。 */
function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 涵蓋所有欄位的 `ClipState`：改過名的 Track、多群組、非空 setupPins、砍半的 targetParticleCount、walled 邊界。 */
function fullClip(): ClipState {
  return {
    image: {
      format: 'gif',
      // 含 0 與 255，確保 base64 邊界值也逐位元組還原。
      bytes: new Uint8Array([0, 1, 2, 127, 128, 200, 253, 254, 255]),
    },
    meshParams: {
      maxMaskEdge: 1024,
      alphaThreshold: 0.5,
      simplifyTolerance: 1.5,
      targetParticleCount: 175, // 效能退路砍半後的值
      minTriangleArea: 0.5,
      minTriangleAngleDeg: 15,
      refineMinAngleDeg: 25,
      refineMaxAreaFactor: 2,
      refineMaxPasses: 30,
    },
    sim: { softness: 0.73, tapStrength: 4200, boundary: 'walled' },
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
    counters: { nextTrackNum: 3, nextGroupNum: 2 },
  };
}

describe('serializeClip', () => {
  it('產出合法 JSON，帶 version: 1', () => {
    const parsed = JSON.parse(serializeClip(fullClip()));
    expect(parsed.version).toBe(CLIP_FILE_VERSION);
    expect(CLIP_FILE_VERSION).toBe(1);
  });

  it('image：格式原樣，bytes 走 base64、逐位元組還原', () => {
    const clip = fullClip();
    const parsed = JSON.parse(serializeClip(clip));
    expect(parsed.image.format).toBe('gif');
    expect(typeof parsed.image.bytes).toBe('string');
    expect(Array.from(decodeBase64(parsed.image.bytes))).toEqual(Array.from(clip.image.bytes));
  });

  it('meshParams：完整九欄原樣保留（含砍半的 targetParticleCount）', () => {
    const clip = fullClip();
    const parsed = JSON.parse(serializeClip(clip));
    expect(parsed.meshParams).toEqual(clip.meshParams);
    expect(parsed.meshParams.targetParticleCount).toBe(175);
  });

  it('sim：軟硬度 0–1 值、輕拍力道、邊界模式原樣保留', () => {
    const parsed = JSON.parse(serializeClip(fullClip()));
    expect(parsed.sim).toEqual({ softness: 0.73, tapStrength: 4200, boundary: 'walled' });
  });

  it('tracks：含名字、起始、頭尾修剪、steps、相機軌起點快照、groupIds（陣列）', () => {
    const clip = fullClip();
    const parsed = JSON.parse(serializeClip(clip));
    expect(parsed.tracks).toEqual(clip.tracks);
    // groupIds 是陣列而非 Set 的序列化殘骸
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

  it('counters：流水號原樣保留', () => {
    const parsed = JSON.parse(serializeClip(fullClip()));
    expect(parsed.counters).toEqual({ nextTrackNum: 3, nextGroupNum: 2 });
  });

  it('不改動傳入的 ClipState，且冪等', () => {
    const clip = fullClip();
    const first = serializeClip(clip);
    const second = serializeClip(clip);
    expect(second).toBe(first); // 冪等：第二次呼叫結果不變
    expect(Array.from(clip.image.bytes)).toEqual([0, 1, 2, 127, 128, 200, 253, 254, 255]);
    expect(clip.tracks[0]!.groupIds).toEqual(['default', 'g1']);
    expect(clip).toEqual(fullClip()); // 整體與一份全新的 fullClip() 深度相等
  });

  it('空 tracks / groups / setupPins 也能序列化（預設果凍剛啟動的狀態）', () => {
    const clip = fullClip();
    const empty: ClipState = {
      ...clip,
      image: { format: 'png', bytes: new Uint8Array([137, 80, 78, 71]) },
      tracks: [],
      groups: [{ id: 'default', name: '預設', enabled: true }],
      setupPins: [],
    };
    const parsed = JSON.parse(serializeClip(empty));
    expect(parsed.tracks).toEqual([]);
    expect(parsed.setupPins).toEqual([]);
    expect(parsed.image.format).toBe('png');
    expect(Array.from(decodeBase64(parsed.image.bytes))).toEqual([137, 80, 78, 71]);
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
