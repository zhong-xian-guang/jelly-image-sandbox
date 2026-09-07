import { describe, expect, it } from 'vitest';

import { mergeTracks, type OverlayTrack } from './overlay';

describe('mergeTracks', () => {
  it('把每條 Track 的 atStep 依各自的 startStep 平移，合併成一條全域時間軸', () => {
    const a: OverlayTrack = {
      startStep: 0,
      idPrefix: 'A/',
      steps: [
        { atStep: 0, event: { type: 'grab', id: 'g', x: 0, y: 0 } },
        { atStep: 5, event: { type: 'release', id: 'g' } },
      ],
    };
    const b: OverlayTrack = {
      startStep: 10,
      idPrefix: 'B/',
      steps: [{ atStep: 0, event: { type: 'tap', x: 1, y: 1 } }],
    };

    expect(mergeTracks([a, b])).toEqual([
      { atStep: 0, event: { type: 'grab', id: 'A/g', x: 0, y: 0 } },
      { atStep: 5, event: { type: 'release', id: 'A/g' } },
      { atStep: 10, event: { type: 'tap', x: 1, y: 1 } },
    ]);
  });

  it('不同 Track 用到同一個原始 id 會被前綴成互不碰撞的新 id（條內引用一致）', () => {
    const a: OverlayTrack = {
      startStep: 0,
      idPrefix: 'A/',
      steps: [
        { atStep: 0, event: { type: 'grab', id: 'p', x: 0, y: 0 } },
        { atStep: 2, event: { type: 'moveGrab', id: 'p', x: 1, y: 0 } },
        { atStep: 4, event: { type: 'release', id: 'p' } },
      ],
    };
    const b: OverlayTrack = {
      startStep: 0,
      idPrefix: 'B/',
      steps: [
        { atStep: 1, event: { type: 'grab', id: 'p', x: 9, y: 9 } },
        { atStep: 3, event: { type: 'release', id: 'p' } },
      ],
    };

    const merged = mergeTracks([a, b]);
    const ids = merged.flatMap((s) => ('id' in s.event ? [s.event.id] : []));
    expect(new Set(ids)).toEqual(new Set(['A/p', 'B/p']));
    // 一條 Track 的 release 落在自己前綴的 id 上，不會誤中另一條同名的 Grab。
    expect(merged).toEqual([
      { atStep: 0, event: { type: 'grab', id: 'A/p', x: 0, y: 0 } },
      { atStep: 1, event: { type: 'grab', id: 'B/p', x: 9, y: 9 } },
      { atStep: 2, event: { type: 'moveGrab', id: 'A/p', x: 1, y: 0 } },
      { atStep: 3, event: { type: 'release', id: 'B/p' } },
      { atStep: 4, event: { type: 'release', id: 'A/p' } },
    ]);
  });

  it('同一條 Track 內的 pin／unpin／movePin 也套同一個前綴，跨 Track 不干擾', () => {
    const a: OverlayTrack = {
      startStep: 0,
      idPrefix: 'A/',
      steps: [
        { atStep: 0, event: { type: 'pin', id: 'x', x: 0, y: 0 } },
        { atStep: 2, event: { type: 'movePin', id: 'x', x: 1, y: 1 } },
        { atStep: 4, event: { type: 'unpin', id: 'x' } },
      ],
    };
    const b: OverlayTrack = {
      startStep: 0,
      idPrefix: 'B/',
      steps: [{ atStep: 1, event: { type: 'pin', id: 'x', x: 5, y: 5 } }],
    };

    const merged = mergeTracks([a, b]);
    expect(merged.flatMap((s) => ('id' in s.event ? [s.event.id] : []))).toEqual([
      'A/x',
      'B/x',
      'A/x',
      'A/x',
    ]);
  });

  it('沒有 id 欄位的事件（tap）原樣通過，只平移 atStep', () => {
    const track: OverlayTrack = {
      startStep: 7,
      idPrefix: 'A/',
      steps: [
        { atStep: 0, event: { type: 'tap', x: 2, y: 3 } },
        { atStep: 3, event: { type: 'tap', x: 4, y: 5 } },
      ],
    };

    expect(mergeTracks([track])).toEqual([
      { atStep: 7, event: { type: 'tap', x: 2, y: 3 } },
      { atStep: 10, event: { type: 'tap', x: 4, y: 5 } },
    ]);
  });

  it('同一個全域 atStep 上，先列的 Track 事件排在前面（穩定排序，決定性）', () => {
    const a: OverlayTrack = {
      startStep: 5,
      idPrefix: 'A/',
      steps: [{ atStep: 0, event: { type: 'tap', x: 0, y: 0 } }],
    };
    const b: OverlayTrack = {
      startStep: 0,
      idPrefix: 'B/',
      steps: [{ atStep: 5, event: { type: 'tap', x: 1, y: 1 } }],
    };

    expect(mergeTracks([a, b])).toEqual([
      { atStep: 5, event: { type: 'tap', x: 0, y: 0 } },
      { atStep: 5, event: { type: 'tap', x: 1, y: 1 } },
    ]);
  });

  it('連續合併同一份輸入結果逐格一致（決定性）', () => {
    const tracks: OverlayTrack[] = [
      {
        startStep: 0,
        idPrefix: 'A/',
        steps: [
          { atStep: 0, event: { type: 'grab', id: 'g', x: 0, y: 0 } },
          { atStep: 3, event: { type: 'release', id: 'g' } },
        ],
      },
      {
        startStep: 2,
        idPrefix: 'B/',
        steps: [{ atStep: 0, event: { type: 'grab', id: 'g', x: 9, y: 9 } }],
      },
    ];
    expect(mergeTracks(tracks)).toEqual(mergeTracks(tracks));
  });

  it('空清單回傳空陣列；步數為空的 Track 不貢獻任何事件', () => {
    expect(mergeTracks([])).toEqual([]);
    expect(
      mergeTracks([
        { startStep: 3, idPrefix: 'A/', steps: [] },
        {
          startStep: 0,
          idPrefix: 'B/',
          steps: [{ atStep: 0, event: { type: 'tap', x: 0, y: 0 } }],
        },
      ]),
    ).toEqual([{ atStep: 0, event: { type: 'tap', x: 0, y: 0 } }]);
  });

  it('不改動傳入的 tracks 陣列、每個 OverlayTrack、其 steps 陣列與 step 物件', () => {
    const stepA = { atStep: 1, event: { type: 'grab', id: 'g', x: 0, y: 0 } } as const;
    const stepB = { atStep: 4, event: { type: 'tap', x: 2, y: 2 } } as const;
    const trackA: OverlayTrack = { startStep: 2, idPrefix: 'A/', steps: [stepA] };
    const trackB: OverlayTrack = { startStep: 0, idPrefix: 'B/', steps: [stepB] };
    const tracks = [trackA, trackB];

    // 凍結每一層：任何寫入（就地改 atStep、push 進 steps、換掉 tracks 內容）都會丟例外。
    Object.freeze(tracks);
    Object.freeze(trackA);
    Object.freeze(trackB);
    Object.freeze(trackA.steps);
    Object.freeze(trackB.steps);
    Object.freeze(stepA);
    Object.freeze(stepB);

    expect(() => mergeTracks(tracks)).not.toThrow();
    expect(tracks).toEqual([
      { startStep: 2, idPrefix: 'A/', steps: [{ atStep: 1, event: { type: 'grab', id: 'g', x: 0, y: 0 } }] },
      { startStep: 0, idPrefix: 'B/', steps: [{ atStep: 4, event: { type: 'tap', x: 2, y: 2 } }] },
    ]);
  });
});
