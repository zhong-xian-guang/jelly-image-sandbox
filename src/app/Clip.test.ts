import { describe, expect, it } from 'vitest';

import { updateCamera, type CameraCommand, type CameraState } from '../camera';
import { isCameraCommand } from './demos/eventKind';
import { STEP_SECONDS } from './demos/time';
import { Clip, type ClipAction } from './Clip';
import type { DemoEvent, DemoStep } from './demos/types';

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

/** 跑 `n` 個 sim step，回傳每個 step 送出的事件（依 step 分組）。 */
function runSteps(clip: Clip, n: number): DemoEvent[][] {
  const out: DemoEvent[][] = [];
  for (let i = 0; i < n; i++) {
    const sent: DemoEvent[] = [];
    clip.step((e) => sent.push(e));
    out.push(sent);
  }
  return out;
}

describe('Clip — 播放 Track', () => {
  it('依起始秒數疊播：事件在排定的 step 送出（片段初始 Pin 在 step 0 最前面），播完切回閒置並通知', () => {
    let changes = 0;
    const clip = new Clip({ onChange: () => changes++ });
    clip.setSetupPins([{ x: 7, y: 8 }]);
    clip.addTrack('action', [tap(1)], null);
    clip.addTrack('camera', [pan(0)], CAM);
    clip.setTrackStartTime('t2', 2 / 60);
    expect(clip.playTracks(OTHER_CAM)).toBe(true);
    expect(clip.phase).toBe('playing');
    changes = 0;

    const sent = runSteps(clip, 3);
    expect(sent[0]!.map((e) => e.type)).toEqual(['pin']);
    expect(sent[1]).toEqual([{ type: 'tap', x: 0, y: 0 }]);
    expect(sent[2]!.map((e) => e.type)).toEqual(['setState', 'panBy']);
    expect(clip.phase).toBe('idle');
    expect(changes).toBe(1);
    expect(runSteps(clip, 1)).toEqual([[]]);
  });

  it('播放中 playbackSteps 是已推進的 step 數', () => {
    const clip = new Clip();
    clip.addTrack('action', [tap(10)], null);
    clip.playTracks(CAM);
    runSteps(clip, 4);
    expect(clip.playbackSteps).toBe(4);
  });

  it('沒有可播放的 Track（清單空、或群組全關）：不播、回傳 false', () => {
    const clip = new Clip();
    expect(clip.playTracks(CAM)).toBe(false);
    clip.addTrack('action', [tap(0)], null);
    clip.setGroupEnabled('default', false);
    expect(clip.playTracks(CAM)).toBe(false);
    expect(clip.phase).toBe('idle');
  });

  it('暫停：step 不推進、不送事件；繼續後接著播；沒在播放時暫停無作用', () => {
    const clip = new Clip();
    clip.togglePause();
    expect(clip.paused).toBe(false);
    clip.addTrack('action', [tap(1)], null);
    clip.playTracks(CAM);
    runSteps(clip, 1);
    clip.togglePause();
    expect(clip.paused).toBe(true);
    expect(runSteps(clip, 5)).toEqual([[], [], [], [], []]);
    expect(clip.playbackSteps).toBe(1);
    clip.togglePause();
    expect(runSteps(clip, 1)).toEqual([[{ type: 'tap', x: 0, y: 0 }]]);
  });

  it('暫停中停止／重設：回到閒置、暫停歸零', () => {
    const clip = new Clip();
    clip.addTrack('action', [tap(100)], null);
    clip.playTracks(CAM);
    clip.togglePause();
    clip.reset();
    expect(clip.phase).toBe('idle');
    expect(clip.paused).toBe(false);
  });
});

describe('Clip — 播放前鏡位', () => {
  it('停止／重設回傳播放前的鏡位，只回傳一次', () => {
    const clip = new Clip();
    clip.addTrack('action', [tap(100)], null);
    clip.playTracks(CAM);
    expect(clip.reset()).toEqual(CAM);
    expect(clip.reset()).toBeNull();
  });

  it('沒有播放過：停止／重設回傳 null', () => {
    expect(new Clip().reset()).toBeNull();
  });

  it('自己播完後停止／重設：仍回傳播放前的鏡位', () => {
    const clip = new Clip();
    clip.addTrack('action', [tap(0)], null);
    clip.playTracks(CAM);
    runSteps(clip, 2);
    expect(clip.phase).toBe('idle');
    expect(clip.reset()).toEqual(CAM);
  });

  it('播放中又按一次播放：被忽略，記下的仍是最初播放前的鏡位', () => {
    const clip = new Clip();
    clip.addTrack('action', [tap(600)], null);
    clip.playTracks(CAM);
    expect(clip.playTracks(OTHER_CAM)).toBe(false);
    expect(clip.reset()).toEqual(CAM);
  });

  it('播放 Demo 不記鏡位', () => {
    const clip = new Clip();
    clip.playDemo([tap(100)]);
    expect(clip.phase).toBe('playing');
    expect(clip.reset()).toBeNull();
  });

  it('只中斷播放（stopPlayback）不丟掉播放前的鏡位', () => {
    const clip = new Clip();
    clip.addTrack('action', [tap(100)], null);
    clip.playTracks(CAM);
    clip.stopPlayback();
    expect(clip.phase).toBe('idle');
    expect(clip.reset()).toEqual(CAM);
  });
});

describe('Clip — 播放不動鏡頭，相機軌開始才硬切（issue #156，原沙盒整合測試）', () => {
  it('沒有相機軌：整段播放不送任何相機指令（不推「框住果凍」）', () => {
    const clip = new Clip();
    clip.addTrack('action', [tap(0)], null);
    clip.playTracks(OTHER_CAM);
    expect(runSteps(clip, 5).flat().filter(isCameraCommand)).toEqual([]);
  });

  it('有相機軌：相機軌開始前不送相機指令（維持播放前的鏡位，不重設成跟隨開著）', () => {
    const clip = new Clip();
    clip.addTrack('camera', [{ atStep: 0, event: { type: 'setFollow', enabled: true } }], CAM);
    clip.setTrackStartTime('t1', 1);
    clip.playTracks(OTHER_CAM);
    const sent = runSteps(clip, 61);
    expect(sent.slice(0, 60).flat().filter(isCameraCommand)).toEqual([]);
    expect(sent[60]!.map((e) => e.type)).toEqual(['setState', 'setFollow']);
  });

  it('從同一個鏡位連按兩次播放（中間停止／重設），鏡頭軌跡逐格一致；相機軌開始那一格硬切到錄好的快照', () => {
    const canvas = { width: 1280, height: 800 };
    const target = { bbox: { minX: -50, minY: -50, maxX: 50, maxY: 50 } };
    const clip = new Clip();
    clip.addTrack('action', [tap(0)], null);
    clip.addTrack(
      'camera',
      [{ atStep: 20, event: { type: 'panBy', dxScreen: 40, dyScreen: 0 } }],
      CAM,
    );
    clip.setTrackStartTime('t2', 30 / 60);

    /** 照 `JellySandbox.frame` 的順序跑：`clip.step` 收相機指令 → `updateCamera`。 */
    function trajectory(start: CameraState): CameraState[] {
      clip.playTracks(start);
      let state = start;
      const out: CameraState[] = [];
      for (let i = 0; i < 90; i++) {
        const cmds: CameraCommand[] = [];
        clip.step((e) => {
          if (isCameraCommand(e)) cmds.push(e);
        });
        state = updateCamera(state, target, canvas, cmds, STEP_SECONDS);
        out.push(state);
      }
      expect(clip.reset()).toEqual(start);
      return out;
    }

    const a = trajectory(OTHER_CAM);
    const b = trajectory(OTHER_CAM);
    expect(a).toEqual(b);
    expect(a[29]!.transform).toEqual(OTHER_CAM.transform); // 跟隨關著 → 原地不動
    expect(a[30]!.transform).toEqual(CAM.transform);
  });
});

describe('Clip — 播放 Demo', () => {
  it('Demo 的排程經同一個 step 送出，播完回到閒置', () => {
    const clip = new Clip();
    clip.playDemo([tap(1), pan(0)]);
    const sent = runSteps(clip, 2);
    expect(sent[0]!.map((e) => e.type)).toEqual(['panBy']);
    expect(sent[1]!.map((e) => e.type)).toEqual(['tap']);
    expect(clip.phase).toBe('idle');
  });

  it('播放中、錄製中按 Demo：忽略', () => {
    const clip = new Clip();
    clip.toggleRecording(CAM);
    clip.playDemo([tap(0)]);
    expect(clip.phase).toBe('recording');
    clip.toggleRecording(CAM);
    clip.playDemo([tap(5)]);
    clip.playDemo([pan(0)]);
    expect(runSteps(clip, 1)).toEqual([[]]);
  });
});

/** 三個 phase 各建一個 Clip（播放中那個有一條還沒播完的 Track）。 */
function clipIn(phase: 'idle' | 'recording' | 'playing'): Clip {
  const clip = new Clip();
  clip.addTrack('action', [tap(600)], null);
  if (phase === 'recording') clip.toggleRecording(CAM);
  if (phase === 'playing') clip.playTracks(CAM);
  return clip;
}

describe('Clip — allows', () => {
  const ACTIONS: ClipAction[] = [
    'editTracks',
    'record',
    'play',
    'setupPins',
    'setInitialPose',
    'rebuildAll',
    'clearAll',
    'rebuildJelly',
    'removeJelly',
    'selectRecordTarget',
  ];
  const allowed = (clip: Clip) => ACTIONS.filter((a) => clip.allows(a));

  it('閒置：全部允許', () => {
    expect(allowed(clipIn('idle'))).toEqual(ACTIONS);
  });

  it('錄製中：只剩錄製鈕（停止錄製）與 Jelly 選單的移除', () => {
    expect(allowed(clipIn('recording'))).toEqual(['record', 'removeJelly']);
  });

  it('播放中：全部鎖住', () => {
    expect(allowed(clipIn('playing'))).toEqual([]);
  });

  it('view() 帶 phase 與 paused', () => {
    const clip = clipIn('playing');
    clip.togglePause();
    expect(clip.view()).toMatchObject({ phase: 'playing', paused: true });
    expect(clipIn('recording').view()).toMatchObject({ phase: 'recording', paused: false });
  });
});

describe('Clip — 不允許時忽略自己的指令', () => {
  for (const phase of ['recording', 'playing'] as const) {
    it(`${phase === 'recording' ? '錄製中' : '播放中'}：Track／群組編輯、片段初始 Pin、錄製目標都不動`, () => {
      const clip = clipIn('idle');
      clip.setSetupPins([{ x: 1, y: 1 }]);
      const before = clip.view();
      const beforePart = clip.toClipPart();
      if (phase === 'recording') clip.toggleRecording(CAM);
      else clip.playTracks(CAM);
      clip.setTrackStartTime('t1', 3);
      clip.setTrackTrimIn('t1', 1);
      clip.setTrackTrimOut('t1', 2);
      clip.renameTrack('t1', '改名');
      clip.deleteTrack('t1');
      clip.addGroup();
      clip.setGroupEnabled('default', false);
      clip.renameGroup('default', 'x');
      clip.toggleGroupSolo('default');
      clip.setTrackGroups('t1', []);
      clip.setSetupPins([]);
      clip.clearSetupPins();
      clip.recordTarget = 'both';
      clip.halt();
      expect(clip.view()).toEqual(before);
      expect(clip.toClipPart()).toEqual(beforePart);
      expect(clip.recordTarget).toBe('action');
    });
  }

  it('播放中不能開始錄製', () => {
    const clip = clipIn('playing');
    clip.toggleRecording(CAM);
    expect(clip.phase).toBe('playing');
  });
});

describe('Clip — clear／fromClipPart 收束錄製與播放', () => {
  it('clear()：中斷錄製（丟棄）與播放，回到閒置', () => {
    const rec = clipIn('recording');
    rec.record({ type: 'tap', x: 0, y: 0 });
    rec.clear();
    expect(rec.phase).toBe('idle');
    expect(rec.view().tracks).toEqual([]);
    const play = clipIn('playing');
    play.clear();
    expect(play.phase).toBe('idle');
    expect(runSteps(play, 700).flat()).toEqual([]);
  });

  it('fromClipPart：中斷播放，回到閒置', () => {
    const clip = clipIn('playing');
    clip.fromClipPart(new Clip().toClipPart());
    expect(clip.phase).toBe('idle');
  });
});

const OTHER_CAM: CameraState = {
  transform: { x: -5, y: 6, scale: 0.5 },
  followEnabled: false,
  framing: false,
  sinceManualSeconds: 1,
};

describe('Clip — 錄製', () => {
  it('錄製目標「兩者」：停止時依事件種類產生動作軌與相機軌，時間戳記是錄製中的 step 數', () => {
    const clip = new Clip();
    clip.recordTarget = 'both';
    clip.toggleRecording(CAM);
    expect(clip.phase).toBe('recording');
    clip.step(() => {});
    clip.record({ type: 'tap', x: 0, y: 0 });
    clip.step(() => {});
    clip.record({ type: 'panBy', dxScreen: 1, dyScreen: 0 });
    clip.toggleRecording(OTHER_CAM);
    expect(clip.phase).toBe('idle');
    const [action, camera] = clip.toClipPart().tracks;
    expect(action!.kind).toBe('action');
    expect(action!.steps).toEqual([tap(1)]);
    expect(action!.startCamera).toBeNull();
    expect(camera!.kind).toBe('camera');
    expect(camera!.steps).toEqual([pan(2)]);
    expect(camera!.startCamera).toEqual(CAM);
  });

  it('只錄動作：相機指令不進清單；沒錄到東西就不新增 Track', () => {
    const clip = new Clip();
    clip.toggleRecording(CAM);
    clip.record({ type: 'panBy', dxScreen: 1, dyScreen: 0 });
    clip.toggleRecording(CAM);
    expect(clip.view().tracks).toEqual([]);
  });

  it('只錄運鏡：只產生相機軌', () => {
    const clip = new Clip();
    clip.recordTarget = 'camera';
    clip.toggleRecording(CAM);
    clip.record({ type: 'tap', x: 0, y: 0 });
    clip.record({ type: 'panBy', dxScreen: 1, dyScreen: 0 });
    clip.toggleRecording(CAM);
    expect(clip.view().tracks.map((t) => t.kind)).toEqual(['camera']);
  });

  it('錄製中停止／重設：錄到的丟棄，不進清單', () => {
    const clip = new Clip();
    clip.toggleRecording(CAM);
    clip.record({ type: 'tap', x: 0, y: 0 });
    clip.reset();
    expect(clip.phase).toBe('idle');
    expect(clip.view().tracks).toEqual([]);
  });

  it('沒在錄製時 record 不作用', () => {
    const clip = new Clip();
    clip.record({ type: 'tap', x: 0, y: 0 });
    clip.toggleRecording(CAM);
    clip.toggleRecording(CAM);
    expect(clip.view().tracks).toEqual([]);
  });
});
