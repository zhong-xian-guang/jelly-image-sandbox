import { describe, expect, it } from 'vitest';

import type { CameraState } from '../camera';
import { Clip } from './Clip';
import type { DemoStep } from './demos/types';

const CAM: CameraState = {
  transform: { x: 1, y: 2, scale: 3 },
  followEnabled: true,
  framing: false,
  sinceManualSeconds: 0,
};

const tap = (atStep: number): DemoStep => ({ atStep, event: { type: 'tap', x: 0, y: 0 } });
const pan = (atStep: number): DemoStep => ({
  atStep,
  event: { type: 'panBy', dxScreen: 1, dyScreen: 0 },
});

describe('Clip — Track 清單與 view()', () => {
  it('新片段：只有預設群組、沒有 Track、可播放數 0、片段初始 Pin 0', () => {
    const view = new Clip().view();
    expect(view.groups).toEqual([
      {
        id: 'default',
        name: '預設',
        enabled: true,
        trackCount: 0,
        soloed: false,
        deletable: false,
      },
    ]);
    expect(view.tracks).toEqual([]);
    expect(view.playableTrackCount).toBe(0);
    expect(view.setupPinCount).toBe(0);
  });

  it('新增的 Track：流水號 id、自動摘要名稱、秒數換算、加入預設群組', () => {
    const clip = new Clip();
    clip.addTrack('action', [tap(30), tap(90)], null);
    clip.addTrack('camera', [pan(60)], CAM);
    const [a, c] = clip.view().tracks;
    expect(a).toEqual({
      id: 't1',
      kind: 'action',
      label: '動作軌 1（輕拍）',
      startSeconds: 0,
      inSeconds: 0,
      outSeconds: 1.5,
      firstEventSeconds: 0.5,
      lastEventSeconds: 1.5,
      overlapping: false,
      groups: [{ id: 'default', name: '預設', member: true }],
    });
    expect(c!.id).toBe('t2');
    expect(c!.label).toBe('相機軌 2（平移）');
    expect(clip.view().playableTrackCount).toBe(2);
    expect(clip.view().groups[0]!.trackCount).toBe(2);
  });
});

describe('Clip — Track 編輯', () => {
  it('起始秒數量化成 step、負數 clamp 到 0', () => {
    const clip = new Clip();
    const id = clip.addTrack('action', [tap(60)], null);
    clip.setTrackStartTime(id, 0.11);
    expect(clip.view().tracks[0]!.startSeconds).toBeCloseTo(7 / 60, 10);
    clip.setTrackStartTime(id, -3);
    expect(clip.view().tracks[0]!.startSeconds).toBe(0);
  });

  it('頭修剪不越過尾、尾修剪不小於頭', () => {
    const clip = new Clip();
    const id = clip.addTrack('action', [tap(0), tap(120)], null);
    clip.setTrackTrimIn(id, 5);
    expect(clip.view().tracks[0]!.inSeconds).toBe(2);
    clip.setTrackTrimOut(id, 1);
    expect(clip.view().tracks[0]!.outSeconds).toBe(2);
    clip.setTrackTrimIn(id, -1);
    expect(clip.view().tracks[0]!.inSeconds).toBe(0);
  });

  it('改名：非空覆寫自動摘要、空字串退回自動摘要', () => {
    const clip = new Clip();
    const id = clip.addTrack('action', [tap(0)], null);
    clip.renameTrack(id, '甩一下');
    expect(clip.view().tracks[0]!.label).toBe('甩一下');
    clip.setTrackStartTime(id, 1);
    expect(clip.view().tracks[0]!.label).toBe('甩一下');
    clip.renameTrack(id, '');
    expect(clip.view().tracks[0]!.label).toBe('動作軌 1（輕拍）');
  });

  it('刪除 Track 後流水號不回收', () => {
    const clip = new Clip();
    const id = clip.addTrack('action', [tap(0)], null);
    clip.deleteTrack(id);
    expect(clip.view().tracks).toEqual([]);
    expect(clip.addTrack('action', [tap(0)], null)).toBe('t2');
  });
});

describe('Clip — 群組', () => {
  it('新增群組：流水號命名、預設開啟、可刪', () => {
    const clip = new Clip();
    clip.addGroup();
    expect(clip.view().groups[1]).toEqual({
      id: 'g1',
      name: '群組 1',
      enabled: true,
      trackCount: 0,
      soloed: false,
      deletable: true,
    });
  });

  it('只勾一個關閉中的群組 → 不可播放；全取消勾選 → 補回預設群組', () => {
    const clip = new Clip();
    const id = clip.addTrack('action', [tap(0)], null);
    clip.addGroup();
    clip.setGroupEnabled('g1', false);
    clip.setTrackGroups(id, ['g1']);
    expect(clip.view().playableTrackCount).toBe(0);
    expect(clip.overlayTracks()).toEqual([]);
    clip.setTrackGroups(id, []);
    expect(clip.view().tracks[0]!.groups).toEqual([
      { id: 'default', name: '預設', member: true },
      { id: 'g1', name: '群組 1', member: false },
    ]);
  });

  it('刪除群組：成員掉到 0 群組時回預設群組；預設群組刪不掉', () => {
    const clip = new Clip();
    const id = clip.addTrack('action', [tap(0)], null);
    clip.addGroup();
    clip.setTrackGroups(id, ['g1']);
    clip.deleteGroup('g1');
    expect(clip.view().groups.map((g) => g.id)).toEqual(['default']);
    expect(clip.view().groups[0]!.trackCount).toBe(1);
    clip.deleteGroup('default');
    expect(clip.view().groups.map((g) => g.id)).toEqual(['default']);
  });

  it('獨奏：只留該群組開，再按一次還原；手動動開關後還原點作廢', () => {
    const clip = new Clip();
    clip.addGroup();
    clip.setGroupEnabled('g1', false);
    clip.toggleGroupSolo('g1');
    expect(clip.view().groups.map((g) => [g.enabled, g.soloed])).toEqual([
      [false, false],
      [true, true],
    ]);
    clip.toggleGroupSolo('g1');
    expect(clip.view().groups.map((g) => [g.enabled, g.soloed])).toEqual([
      [true, false],
      [false, false],
    ]);
    clip.toggleGroupSolo('default');
    clip.setGroupEnabled('g1', true);
    expect(clip.view().groups.every((g) => !g.soloed)).toBe(true);
  });

  it('改名群組會反映到 Track 的群組勾選項', () => {
    const clip = new Clip();
    clip.addTrack('action', [tap(0)], null);
    clip.renameGroup('default', '主要');
    expect(clip.view().groups[0]!.name).toBe('主要');
    expect(clip.view().tracks[0]!.groups[0]!.name).toBe('主要');
  });
});

describe('Clip — 相機軌重疊與疊播輸入', () => {
  it('開啟中群組裡時間重疊的相機軌標紅；關掉其中一條所屬群組就消失', () => {
    const clip = new Clip();
    const a = clip.addTrack('camera', [pan(0), pan(60)], CAM);
    clip.addTrack('camera', [pan(0)], CAM);
    expect(clip.view().tracks.map((t) => t.overlapping)).toEqual([true, true]);
    clip.addGroup();
    clip.setTrackGroups(a, ['g1']);
    clip.setGroupEnabled('g1', false);
    expect(clip.view().tracks.map((t) => t.overlapping)).toEqual([false, false]);
  });

  it('不重疊的相機軌不標紅；動作軌永遠不標紅', () => {
    const clip = new Clip();
    clip.addTrack('camera', [pan(0)], CAM);
    const b = clip.addTrack('camera', [pan(0)], CAM);
    clip.addTrack('action', [tap(0)], null);
    clip.setTrackStartTime(b, 2);
    expect(clip.view().tracks.map((t) => t.overlapping)).toEqual([false, false, false]);
  });

  it('overlayTracks：片段初始 Pin 合成軌排最前，其後照清單順序帶起始／修剪／相機快照', () => {
    const clip = new Clip();
    clip.setSetupPins([{ x: 5, y: 6 }]);
    const a = clip.addTrack('action', [tap(0), tap(30)], null);
    clip.addTrack('camera', [pan(10)], CAM);
    clip.setTrackStartTime(a, 1);
    clip.setTrackTrimIn(a, 0.25);
    const [setup, first, second] = clip.overlayTracks();
    expect(setup).toEqual({
      startStep: 0,
      idPrefix: 'setup/',
      steps: [{ atStep: 0, event: { type: 'pin', id: 0, x: 5, y: 6 } }],
    });
    expect(first).toEqual({
      startStep: 60,
      idPrefix: 't1/',
      steps: [tap(0), tap(30)],
      inStep: 15,
      outStep: 30,
      startCamera: null,
    });
    expect(second!.idPrefix).toBe('t2/');
    expect(second!.startCamera).toEqual(CAM);
  });
});

describe('Clip — 片段初始 Pin', () => {
  it('設為目前 Pin 取代上一份、清除歸零', () => {
    const clip = new Clip();
    clip.setSetupPins([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    clip.setSetupPins([{ x: 3, y: 3 }]);
    expect(clip.view().setupPinCount).toBe(1);
    clip.clearSetupPins();
    expect(clip.view().setupPinCount).toBe(0);
  });
});

describe('Clip — 片段檔讀寫與清空', () => {
  function populated(): Clip {
    const clip = new Clip();
    const a = clip.addTrack('action', [tap(0), tap(30)], null);
    clip.addTrack('camera', [pan(10)], CAM);
    clip.addGroup();
    clip.setTrackGroups(a, ['default', 'g1']);
    clip.renameTrack(a, '自訂');
    clip.setTrackStartTime(a, 0.5);
    clip.setSetupPins([{ x: 7, y: 8 }]);
    return clip;
  }

  it('toClipPart：Track 攤成存檔格式（name = 自訂名或自動摘要、groupIds 陣列）與流水號', () => {
    expect(populated().toClipPart()).toEqual({
      tracks: [
        {
          id: 't1',
          kind: 'action',
          name: '自訂',
          startStep: 30,
          inStep: 0,
          outStep: 30,
          steps: [tap(0), tap(30)],
          startCamera: null,
          groupIds: ['default', 'g1'],
        },
        {
          id: 't2',
          kind: 'camera',
          name: '相機軌 2（平移）',
          startStep: 0,
          inStep: 0,
          outStep: 10,
          steps: [pan(10)],
          startCamera: CAM,
          groupIds: ['default'],
        },
      ],
      groups: [
        { id: 'default', name: '預設', enabled: true },
        { id: 'g1', name: '群組 1', enabled: true },
      ],
      setupPins: [{ x: 7, y: 8 }],
      counters: { nextTrackNum: 3, nextGroupNum: 2 },
    });
  });

  it('fromClipPart(toClipPart()) 來回一致：view 相同、之後的流水號接續', () => {
    const source = populated();
    const loaded = new Clip();
    loaded.fromClipPart(source.toClipPart());
    expect(loaded.view()).toEqual(source.view());
    expect(loaded.toClipPart()).toEqual(source.toClipPart());
    expect(loaded.addTrack('action', [tap(0)], null)).toBe('t3');
    loaded.addGroup();
    expect(loaded.view().groups.at(-1)!.id).toBe('g2');
  });

  it('載入的 Track 清空名稱時退回存檔的名稱', () => {
    const loaded = new Clip();
    loaded.fromClipPart(populated().toClipPart());
    loaded.renameTrack('t1', '');
    expect(loaded.view().tracks[0]!.label).toBe('自訂');
  });

  it('fromClipPart 清掉進行中的獨奏', () => {
    const clip = populated();
    clip.toggleGroupSolo('g1');
    clip.fromClipPart(populated().toClipPart());
    expect(clip.view().groups.every((g) => !g.soloed)).toBe(true);
  });

  it('toClipPart 是拷貝：之後編輯 Clip 不影響已取出的那份', () => {
    const clip = populated();
    const part = clip.toClipPart();
    clip.renameGroup('g1', '改過');
    clip.clearSetupPins();
    expect(part.groups[1]!.name).toBe('群組 1');
    expect(part.setupPins).toEqual([{ x: 7, y: 8 }]);
  });

  it('clear()：回到全新片段，流水號歸零；錄製目標保留', () => {
    const clip = populated();
    clip.recordTarget = 'both';
    clip.clear();
    expect(clip.view()).toEqual(new Clip().view());
    expect(clip.toClipPart()).toEqual(new Clip().toClipPart());
    expect(clip.addTrack('action', [tap(0)], null)).toBe('t1');
    expect(clip.recordTarget).toBe('both');
  });
});

describe('Clip — 變更通知', () => {
  it('狀態有變才通知；找不到 id 或值相同時不通知', () => {
    let count = 0;
    const clip = new Clip({ onChange: () => count++ });
    const id = clip.addTrack('action', [tap(0)], null);
    expect(count).toBe(1);
    clip.renameTrack(id, '');
    clip.renameTrack('nope', 'x');
    clip.setTrackStartTime('nope', 1);
    clip.setGroupEnabled('default', true);
    clip.renameGroup('default', '預設');
    clip.clearSetupPins();
    expect(count).toBe(1);
    clip.setGroupEnabled('default', false);
    expect(count).toBe(2);
  });
});
