import { describe, expect, it } from 'vitest';

import type { CameraState } from '../../camera';
import { cameraTrackGlobalRange, mergeTracks, type OverlayTrack } from './overlay';

/** 一份最小合法的相機起點快照。 */
function snapshot(x: number): CameraState {
  return {
    transform: { x, y: 0, scale: 1 },
    followEnabled: true,
    framing: false,
    sinceManualSeconds: 2,
  };
}

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

  it('沒帶 inStep／outStep 時整條照舊（等同不修剪）', () => {
    const track: OverlayTrack = {
      startStep: 4,
      idPrefix: 'A/',
      steps: [
        { atStep: 0, event: { type: 'tap', x: 0, y: 0 } },
        { atStep: 6, event: { type: 'tap', x: 1, y: 1 } },
      ],
    };
    expect(mergeTracks([track])).toEqual([
      { atStep: 4, event: { type: 'tap', x: 0, y: 0 } },
      { atStep: 10, event: { type: 'tap', x: 1, y: 1 } },
    ]);
  });

  describe('頭尾修剪（issue #35 / V2 T1-3）', () => {
    it('丟掉 atStep 落在 in／out 範圍外的排程項', () => {
      const track: OverlayTrack = {
        startStep: 0,
        idPrefix: 'A/',
        inStep: 3,
        outStep: 7,
        steps: [
          { atStep: 0, event: { type: 'tap', x: 0, y: 0 } }, // < in，丟
          { atStep: 3, event: { type: 'tap', x: 3, y: 3 } }, // = in，留
          { atStep: 5, event: { type: 'tap', x: 5, y: 5 } }, // 範圍內，留
          { atStep: 7, event: { type: 'tap', x: 7, y: 7 } }, // = out，留
          { atStep: 9, event: { type: 'tap', x: 9, y: 9 } }, // > out，丟
        ],
      };
      expect(mergeTracks([track])).toEqual([
        { atStep: 0, event: { type: 'tap', x: 3, y: 3 } },
        { atStep: 2, event: { type: 'tap', x: 5, y: 5 } },
        { atStep: 4, event: { type: 'tap', x: 7, y: 7 } },
      ]);
    });

    it('留下來的 atStep 先減 in、再加該條的 startStep（修掉的開頭不留空白）', () => {
      const track: OverlayTrack = {
        startStep: 100,
        idPrefix: 'A/',
        inStep: 20,
        steps: [
          { atStep: 20, event: { type: 'tap', x: 0, y: 0 } },
          { atStep: 35, event: { type: 'tap', x: 1, y: 1 } },
        ],
      };
      expect(mergeTracks([track])).toEqual([
        { atStep: 100, event: { type: 'tap', x: 0, y: 0 } },
        { atStep: 115, event: { type: 'tap', x: 1, y: 1 } },
      ]);
    });

    it('in／out 邊界值：剛好落在 in 或 out 上的排程項保留', () => {
      const track: OverlayTrack = {
        startStep: 0,
        idPrefix: 'A/',
        inStep: 5,
        outStep: 5,
        steps: [
          { atStep: 4, event: { type: 'tap', x: 4, y: 4 } },
          { atStep: 5, event: { type: 'tap', x: 5, y: 5 } },
          { atStep: 6, event: { type: 'tap', x: 6, y: 6 } },
        ],
      };
      expect(mergeTracks([track])).toEqual([{ atStep: 0, event: { type: 'tap', x: 5, y: 5 } }]);
    });

    it('in > out（範圍為空）→ 這條不貢獻任何事件，不丟例外', () => {
      const track: OverlayTrack = {
        startStep: 0,
        idPrefix: 'A/',
        inStep: 8,
        outStep: 3,
        steps: [
          { atStep: 0, event: { type: 'tap', x: 0, y: 0 } },
          { atStep: 5, event: { type: 'tap', x: 5, y: 5 } },
          { atStep: 10, event: { type: 'tap', x: 10, y: 10 } },
        ],
      };
      expect(() => mergeTracks([track])).not.toThrow();
      expect(mergeTracks([track])).toEqual([]);
    });

    it('Grab 橫跨進場點 → 用原始挑選座標重建 grab，再補 moveGrab 拉到進場當下目標', () => {
      const track: OverlayTrack = {
        startStep: 50,
        idPrefix: 'A/',
        inStep: 10,
        steps: [
          { atStep: 2, event: { type: 'grab', id: 'p', x: 0, y: 0 } }, // 原始挑選座標
          { atStep: 6, event: { type: 'moveGrab', id: 'p', x: 3, y: 4 } }, // 進場點前最後一次移動
          { atStep: 14, event: { type: 'moveGrab', id: 'p', x: 8, y: 9 } },
          { atStep: 18, event: { type: 'release', id: 'p' } },
        ],
      };
      expect(mergeTracks([track])).toEqual([
        { atStep: 50, event: { type: 'grab', id: 'A/p', x: 0, y: 0 } }, // 命中 rest 形狀上正確的材質點
        { atStep: 50, event: { type: 'moveGrab', id: 'A/p', x: 3, y: 4 } }, // 同 step 拉到進場當下目標
        { atStep: 54, event: { type: 'moveGrab', id: 'A/p', x: 8, y: 9 } },
        { atStep: 58, event: { type: 'release', id: 'A/p' } },
      ]);
    });

    it('Grab 橫跨進場點但進場前沒被拖動 → 只重建 grab，不補多餘的 moveGrab', () => {
      const track: OverlayTrack = {
        startStep: 0,
        idPrefix: 'A/',
        inStep: 10,
        steps: [
          { atStep: 4, event: { type: 'grab', id: 'p', x: 1, y: 1 } },
          { atStep: 12, event: { type: 'moveGrab', id: 'p', x: 2, y: 2 } },
          { atStep: 16, event: { type: 'release', id: 'p' } },
        ],
      };
      expect(mergeTracks([track])).toEqual([
        { atStep: 0, event: { type: 'grab', id: 'A/p', x: 1, y: 1 } },
        { atStep: 2, event: { type: 'moveGrab', id: 'A/p', x: 2, y: 2 } },
        { atStep: 6, event: { type: 'release', id: 'A/p' } },
      ]);
    });

    it('重建的 grab／moveGrab 排在同條同一 step 的存活事件之前', () => {
      const track: OverlayTrack = {
        startStep: 0,
        idPrefix: 'A/',
        inStep: 10,
        steps: [
          { atStep: 4, event: { type: 'grab', id: 'p', x: 1, y: 1 } },
          { atStep: 10, event: { type: 'moveGrab', id: 'p', x: 2, y: 2 } }, // 剛好在進場點
        ],
      };
      expect(mergeTracks([track])).toEqual([
        { atStep: 0, event: { type: 'grab', id: 'A/p', x: 1, y: 1 } },
        { atStep: 0, event: { type: 'moveGrab', id: 'A/p', x: 2, y: 2 } },
      ]);
    });

    it('Grab 橫跨出場點 → 在出場點補一個 release（尾段真的被截掉時）', () => {
      const track: OverlayTrack = {
        startStep: 100,
        idPrefix: 'A/',
        outStep: 8,
        steps: [
          { atStep: 2, event: { type: 'grab', id: 'p', x: 0, y: 0 } },
          { atStep: 6, event: { type: 'moveGrab', id: 'p', x: 1, y: 1 } },
          { atStep: 12, event: { type: 'moveGrab', id: 'p', x: 2, y: 2 } }, // > out，丟
          { atStep: 15, event: { type: 'release', id: 'p' } }, // > out，丟
        ],
      };
      expect(mergeTracks([track])).toEqual([
        { atStep: 102, event: { type: 'grab', id: 'A/p', x: 0, y: 0 } },
        { atStep: 106, event: { type: 'moveGrab', id: 'A/p', x: 1, y: 1 } },
        { atStep: 108, event: { type: 'release', id: 'A/p' } }, // 補：出場點放開，不黏著果凍
      ]);
    });

    it('Grab 橫跨進場點與出場點 → 進場重建、出場補 release', () => {
      const track: OverlayTrack = {
        startStep: 0,
        idPrefix: 'A/',
        inStep: 5,
        outStep: 15,
        steps: [
          { atStep: 1, event: { type: 'grab', id: 'p', x: 0, y: 0 } },
          { atStep: 3, event: { type: 'moveGrab', id: 'p', x: 1, y: 1 } },
          { atStep: 10, event: { type: 'moveGrab', id: 'p', x: 2, y: 2 } },
          { atStep: 20, event: { type: 'release', id: 'p' } }, // > out，丟
        ],
      };
      expect(mergeTracks([track])).toEqual([
        { atStep: 0, event: { type: 'grab', id: 'A/p', x: 0, y: 0 } },
        { atStep: 0, event: { type: 'moveGrab', id: 'A/p', x: 1, y: 1 } },
        { atStep: 5, event: { type: 'moveGrab', id: 'A/p', x: 2, y: 2 } },
        { atStep: 10, event: { type: 'release', id: 'A/p' } },
      ]);
    });

    it('Grab 沒 release 但尾段沒被截掉（out ≥ 最後一筆）→ 不補 release', () => {
      const track: OverlayTrack = {
        startStep: 0,
        idPrefix: 'A/',
        outStep: 100,
        steps: [
          { atStep: 2, event: { type: 'grab', id: 'p', x: 0, y: 0 } },
          { atStep: 6, event: { type: 'moveGrab', id: 'p', x: 1, y: 1 } },
        ],
      };
      expect(mergeTracks([track])).toEqual([
        { atStep: 2, event: { type: 'grab', id: 'A/p', x: 0, y: 0 } },
        { atStep: 6, event: { type: 'moveGrab', id: 'A/p', x: 1, y: 1 } },
      ]);
    });

    it('Grab 在進場點之前就 release → 不重建', () => {
      const track: OverlayTrack = {
        startStep: 0,
        idPrefix: 'A/',
        inStep: 10,
        steps: [
          { atStep: 2, event: { type: 'grab', id: 'p', x: 0, y: 0 } },
          { atStep: 5, event: { type: 'release', id: 'p' } },
          { atStep: 12, event: { type: 'tap', x: 1, y: 1 } },
        ],
      };
      expect(mergeTracks([track])).toEqual([{ atStep: 2, event: { type: 'tap', x: 1, y: 1 } }]);
    });

    it('Grab 在進場點之前轉成 Pin → 不當作 Grab 重建', () => {
      const track: OverlayTrack = {
        startStep: 0,
        idPrefix: 'A/',
        inStep: 10,
        steps: [
          { atStep: 2, event: { type: 'grab', id: 'p', x: 0, y: 0 } },
          { atStep: 4, event: { type: 'pin', id: 'p' } },
          { atStep: 14, event: { type: 'unpin', id: 'p' } },
        ],
      };
      expect(mergeTracks([track])).toEqual([{ atStep: 4, event: { type: 'unpin', id: 'A/p' } }]);
    });

    it('inStep = 0 不觸發重建（沒有頭可修）', () => {
      const track: OverlayTrack = {
        startStep: 0,
        idPrefix: 'A/',
        inStep: 0,
        steps: [{ atStep: 0, event: { type: 'grab', id: 'p', x: 0, y: 0 } }],
      };
      expect(mergeTracks([track])).toEqual([
        { atStep: 0, event: { type: 'grab', id: 'A/p', x: 0, y: 0 } },
      ]);
    });

    it('多條各自修剪，疊加時互不影響', () => {
      const a: OverlayTrack = {
        startStep: 0,
        idPrefix: 'A/',
        inStep: 5,
        steps: [
          { atStep: 0, event: { type: 'tap', x: 0, y: 0 } },
          { atStep: 8, event: { type: 'tap', x: 8, y: 8 } },
        ],
      };
      const b: OverlayTrack = {
        startStep: 10,
        idPrefix: 'B/',
        outStep: 2,
        steps: [
          { atStep: 1, event: { type: 'tap', x: 1, y: 1 } },
          { atStep: 9, event: { type: 'tap', x: 9, y: 9 } },
        ],
      };
      expect(mergeTracks([a, b])).toEqual([
        { atStep: 3, event: { type: 'tap', x: 8, y: 8 } },
        { atStep: 11, event: { type: 'tap', x: 1, y: 1 } },
      ]);
    });
  });

  describe('相機軌硬切 + 不重疊解析（issue #36 / V2 T1-4）', () => {
    it('相機軌在（重錨後）起始 step 插一個帶 startCamera 快照的 setState 絕對指令', () => {
      const snap = snapshot(7);
      const cam: OverlayTrack = {
        startStep: 30,
        idPrefix: 'c1/',
        startCamera: snap,
        steps: [
          { atStep: 0, event: { type: 'panBy', dxScreen: 10, dyScreen: 0 } },
          { atStep: 6, event: { type: 'zoomBy', factor: 1.2, pivotScreen: { x: 0, y: 0 } } },
        ],
      };
      expect(mergeTracks([cam])).toEqual([
        { atStep: 30, event: { type: 'setState', state: snap } },
        { atStep: 30, event: { type: 'panBy', dxScreen: 10, dyScreen: 0 } },
        { atStep: 36, event: { type: 'zoomBy', factor: 1.2, pivotScreen: { x: 0, y: 0 } } },
      ]);
    });

    it('頭修剪把 setState 重錨到 startStep（跟修剪後的第一筆位移同一個 step）', () => {
      const snap = snapshot(1);
      const cam: OverlayTrack = {
        startStep: 100,
        idPrefix: 'c1/',
        startCamera: snap,
        inStep: 10,
        steps: [
          { atStep: 2, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } }, // < in，丟
          { atStep: 10, event: { type: 'panBy', dxScreen: 2, dyScreen: 0 } }, // = in，重錨到 100
          { atStep: 25, event: { type: 'panBy', dxScreen: 3, dyScreen: 0 } }, // → 115
        ],
      };
      expect(mergeTracks([cam])).toEqual([
        { atStep: 100, event: { type: 'setState', state: snap } },
        { atStep: 100, event: { type: 'panBy', dxScreen: 2, dyScreen: 0 } },
        { atStep: 115, event: { type: 'panBy', dxScreen: 3, dyScreen: 0 } },
      ]);
    });

    it('兩條相機軌重疊 → 重疊區間只保留先列那條的排程項（含後列的硬切）', () => {
      const first: OverlayTrack = {
        startStep: 0,
        idPrefix: 'c1/',
        startCamera: snapshot(1),
        steps: [
          { atStep: 0, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } },
          { atStep: 10, event: { type: 'panBy', dxScreen: 2, dyScreen: 0 } }, // 作用區間到全域 step 10
        ],
      };
      const second: OverlayTrack = {
        startStep: 5, // 落在 first 的 [0,10] 內
        idPrefix: 'c2/',
        startCamera: snapshot(9),
        steps: [
          { atStep: 0, event: { type: 'panBy', dxScreen: 8, dyScreen: 0 } }, // 全域 5，被 first 佔用 → 丟
          { atStep: 8, event: { type: 'panBy', dxScreen: 9, dyScreen: 0 } }, // 全域 13，> 10 → 留
        ],
      };
      expect(mergeTracks([first, second])).toEqual([
        { atStep: 0, event: { type: 'setState', state: snapshot(1) } },
        { atStep: 0, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } },
        { atStep: 10, event: { type: 'panBy', dxScreen: 2, dyScreen: 0 } },
        { atStep: 13, event: { type: 'panBy', dxScreen: 9, dyScreen: 0 } },
      ]);
      // second 的硬切（全域 step 5）落在重疊區間，被丟掉——這正是「認先列」的軟警告場景。
    });

    it('相機軌不重疊 → 兩條都完整貢獻，各自硬切', () => {
      const a: OverlayTrack = {
        startStep: 0,
        idPrefix: 'c1/',
        startCamera: snapshot(1),
        steps: [{ atStep: 0, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } }],
      };
      const b: OverlayTrack = {
        startStep: 50,
        idPrefix: 'c2/',
        startCamera: snapshot(2),
        steps: [{ atStep: 0, event: { type: 'panBy', dxScreen: 2, dyScreen: 0 } }],
      };
      expect(mergeTracks([a, b])).toEqual([
        { atStep: 0, event: { type: 'setState', state: snapshot(1) } },
        { atStep: 0, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } },
        { atStep: 50, event: { type: 'setState', state: snapshot(2) } },
        { atStep: 50, event: { type: 'panBy', dxScreen: 2, dyScreen: 0 } },
      ]);
    });

    it('「認先列」是陣列順序：把時間上較晚的相機軌排在前，較早的反而被它壓', () => {
      const listedFirst: OverlayTrack = {
        startStep: 20,
        idPrefix: 'c1/',
        startCamera: snapshot(1),
        steps: [{ atStep: 10, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } }], // 作用區間 [20,30]
      };
      const listedSecond: OverlayTrack = {
        startStep: 0,
        idPrefix: 'c2/',
        startCamera: snapshot(2),
        steps: [{ atStep: 40, event: { type: 'panBy', dxScreen: 2, dyScreen: 0 } }], // 作用區間 [0,40]，與 [20,30] 重疊
      };
      const merged = mergeTracks([listedFirst, listedSecond]);
      // listedSecond 的硬切（全域 0）與位移（全域 40）都落在 listedFirst 的 [20,30] 外 → 保留；
      // 但若它有事件落在 [20,30] 內會被丟。這裡驗證先列那條完整、後列那條沒被反過來壓掉區間外的事件。
      expect(merged).toEqual([
        { atStep: 0, event: { type: 'setState', state: snapshot(2) } },
        { atStep: 20, event: { type: 'setState', state: snapshot(1) } },
        { atStep: 30, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } },
        { atStep: 40, event: { type: 'panBy', dxScreen: 2, dyScreen: 0 } },
      ]);
    });

    it('動作軌與相機軌混合 → 依全域 atStep 穩定排序合併成一條', () => {
      const action: OverlayTrack = {
        startStep: 0,
        idPrefix: 't1/',
        steps: [
          { atStep: 0, event: { type: 'grab', id: 'g', x: 0, y: 0 } },
          { atStep: 20, event: { type: 'release', id: 'g' } },
        ],
      };
      const cam: OverlayTrack = {
        startStep: 5,
        idPrefix: 't2/',
        startCamera: snapshot(3),
        steps: [{ atStep: 5, event: { type: 'panBy', dxScreen: 4, dyScreen: 0 } }],
      };
      expect(mergeTracks([action, cam])).toEqual([
        { atStep: 0, event: { type: 'grab', id: 't1/g', x: 0, y: 0 } },
        { atStep: 5, event: { type: 'setState', state: snapshot(3) } },
        { atStep: 10, event: { type: 'panBy', dxScreen: 4, dyScreen: 0 } },
        { atStep: 20, event: { type: 'release', id: 't1/g' } },
      ]);
    });

    it('動作軌不受相機軌不重疊規則影響（可自由與相機軌、彼此重疊）', () => {
      const cam: OverlayTrack = {
        startStep: 0,
        idPrefix: 'c1/',
        startCamera: snapshot(1),
        steps: [{ atStep: 100, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } }], // 佔用 [0,100]
      };
      const action: OverlayTrack = {
        startStep: 10,
        idPrefix: 't1/',
        steps: [{ atStep: 0, event: { type: 'tap', x: 1, y: 1 } }], // 全域 10，落在相機軌區間內——動作軌不受影響
      };
      expect(mergeTracks([cam, action])).toEqual([
        { atStep: 0, event: { type: 'setState', state: snapshot(1) } },
        { atStep: 10, event: { type: 'tap', x: 1, y: 1 } },
        { atStep: 100, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } },
      ]);
    });

    it('cameraTrackGlobalRange：起始 = startStep，結束 = 修剪後最後一筆重錨到全域軸的 step', () => {
      expect(
        cameraTrackGlobalRange({
          startStep: 10,
          steps: [
            { atStep: 0, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } },
            { atStep: 8, event: { type: 'panBy', dxScreen: 2, dyScreen: 0 } },
          ],
        }),
      ).toEqual([10, 18]);
      // 尾修剪把最後一筆切掉 → 結束跟著往前（落在修剪後最後一筆留下來的那筆上）
      expect(
        cameraTrackGlobalRange({
          startStep: 10,
          outStep: 4,
          steps: [
            { atStep: 0, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } },
            { atStep: 4, event: { type: 'panBy', dxScreen: 3, dyScreen: 0 } }, // = out，留 → 全域 14
            { atStep: 8, event: { type: 'panBy', dxScreen: 2, dyScreen: 0 } }, // > out，不算進區間
          ],
        }),
      ).toEqual([10, 14]);
      // 沒有排程項 → 結束 = 起始
      expect(cameraTrackGlobalRange({ startStep: 7, steps: [] })).toEqual([7, 7]);
    });

    it('claimedCameraRanges 用 cameraTrackGlobalRange 算：尾修剪切掉後段事件後，先前落在其中的後列軌不再被壓', () => {
      const first: OverlayTrack = {
        startStep: 0,
        idPrefix: 'c1/',
        startCamera: snapshot(1),
        outStep: 3, // 把 atStep 30 那筆切掉 → 作用區間只到最後一筆「留下來的」（全域 2）
        steps: [
          { atStep: 0, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } },
          { atStep: 2, event: { type: 'panBy', dxScreen: 5, dyScreen: 0 } }, // 留，全域 2
          { atStep: 30, event: { type: 'panBy', dxScreen: 2, dyScreen: 0 } }, // > out，切掉
        ],
      };
      const second: OverlayTrack = {
        startStep: 5, // 在「到最後一筆原始事件」的舊算法下會落在 [0,30] 內被壓；新算法 [0,2] 不壓
        idPrefix: 'c2/',
        startCamera: snapshot(9),
        steps: [{ atStep: 0, event: { type: 'panBy', dxScreen: 8, dyScreen: 0 } }],
      };
      expect(cameraTrackGlobalRange(first)).toEqual([0, 2]);
      expect(mergeTracks([first, second])).toEqual([
        { atStep: 0, event: { type: 'setState', state: snapshot(1) } },
        { atStep: 0, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } },
        { atStep: 2, event: { type: 'panBy', dxScreen: 5, dyScreen: 0 } },
        { atStep: 5, event: { type: 'setState', state: snapshot(9) } },
        { atStep: 5, event: { type: 'panBy', dxScreen: 8, dyScreen: 0 } },
      ]);
    });

    it('相機軌套頭尾修剪範圍為空（in > out）→ 不貢獻任何事件，連硬切都不插', () => {
      const cam: OverlayTrack = {
        startStep: 0,
        idPrefix: 'c1/',
        startCamera: snapshot(1),
        inStep: 20,
        outStep: 5,
        steps: [{ atStep: 10, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } }],
      };
      expect(mergeTracks([cam])).toEqual([]);
    });
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
      {
        startStep: 2,
        idPrefix: 'A/',
        steps: [{ atStep: 1, event: { type: 'grab', id: 'g', x: 0, y: 0 } }],
      },
      { startStep: 0, idPrefix: 'B/', steps: [{ atStep: 4, event: { type: 'tap', x: 2, y: 2 } }] },
    ]);
  });
});
