/**
 * `ControlPanel` 的 DOM 測試（issue #43 / V2 T1-8）——聚焦「依群組分區的 Track
 * 清單」：每個群組一段標頭 + 底下該群組的成員卡片、一條 Track 屬多組就多次出現、
 * 動作軌與相機軌都畫 `群組 ▾`（issue #37 把相機軌接進分群 UI）、空群組放提示、
 * 鎖定狀態涵蓋整區。`ControlPanel` 是純 DOM 接線層，jsdom 下可直接建。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ControlPanel, type ControlPanelOptions, type TrackListRow } from './ControlPanel';

/** 一份把所有回呼都設成 spy 的最小 options，測試各自覆寫需要的欄位。 */
function makeOptions(overrides: Partial<ControlPanelOptions> = {}): ControlPanelOptions {
  return {
    initial: {
      boundary: 'infinite',
      softness: 0.5,
      tapStrength: 6000,
      pinMode: false,
      showPins: true,
      followLocked: false,
      showWireframe: false,
      recordTarget: 'action',
    },
    tapStrengthRange: { min: 1000, max: 11000, step: 100 },
    demos: [],
    onImportImage: vi.fn(),
    onSaveClip: vi.fn(),
    onLoadClip: vi.fn(),
    onBoundaryChange: vi.fn(),
    onSoftnessChange: vi.fn(),
    onTapStrengthChange: vi.fn(),
    onPinModeChange: vi.fn(),
    onClearPins: vi.fn(),
    onShowPinsChange: vi.fn(),
    onFollowLockChange: vi.fn(),
    onFrameJelly: vi.fn(),
    onRunDemo: vi.fn(),
    onReset: vi.fn(),
    onWireframeChange: vi.fn(),
    onRecordTargetChange: vi.fn(),
    onToggleRecording: vi.fn(),
    onPlayAll: vi.fn(),
    onSnapshotSetupPins: vi.fn(),
    onClearSetupPins: vi.fn(),
    onAddGroup: vi.fn(),
    onGroupEnabledChange: vi.fn(),
    onGroupRename: vi.fn(),
    onGroupSolo: vi.fn(),
    onDeleteGroup: vi.fn(),
    onTrackGroupsChange: vi.fn(),
    onTogglePause: vi.fn(),
    onTrackStartTimeChange: vi.fn(),
    onTrackTrimInChange: vi.fn(),
    onTrackTrimOutChange: vi.fn(),
    onDeleteTrack: vi.fn(),
    onTrackRename: vi.fn(),
    ...overrides,
  };
}

/** 一列動作軌，`memberOf` 是它所屬的群組 id。 */
function actionRow(
  id: string,
  memberOf: string[],
  allGroups: { id: string; name: string }[],
): TrackListRow {
  return {
    id,
    kind: 'action',
    label: `動作軌 ${id}`,
    startSeconds: 0,
    inSeconds: 0,
    outSeconds: 1,
    firstEventSeconds: 0,
    lastEventSeconds: 1,
    groups: allGroups.map((g) => ({ id: g.id, name: g.name, member: memberOf.includes(g.id) })),
  };
}

function cameraRow(id: string, allGroups: { id: string; name: string }[]): TrackListRow {
  return {
    id,
    kind: 'camera',
    label: `相機軌 ${id}`,
    startSeconds: 0,
    inSeconds: 0,
    outSeconds: 1,
    firstEventSeconds: 0,
    lastEventSeconds: 1,
    overlapping: false,
    groups: allGroups.map((g) => ({ id: g.id, name: g.name, member: g.id === 'default' })),
  };
}

const GROUPS_META = [
  { id: 'default', name: '預設' },
  { id: 'g1', name: '群組 1' },
];

function groupRows(enabled: Record<string, boolean> = {}) {
  return GROUPS_META.map((g) => ({
    id: g.id,
    name: g.name,
    enabled: enabled[g.id] ?? true,
    trackCount: 0,
    soloed: false,
    deletable: g.id !== 'default',
  }));
}

describe('ControlPanel — 依群組分區的 Track 清單（issue #43）', () => {
  let panel: ControlPanel;
  let opts: ControlPanelOptions;

  beforeEach(() => {
    opts = makeOptions();
    panel = new ControlPanel(opts);
  });

  function sections() {
    return [...panel.element.querySelectorAll('.jelly-group-section')];
  }

  it('每個群組畫成一段，標頭帶群組名稱', () => {
    panel.setGroups(groupRows());
    panel.setTracks([]);
    expect(sections()).toHaveLength(2);
    const names = sections().map(
      (s) => (s.querySelector('input.jelly-group-name') as HTMLInputElement).value,
    );
    expect(names).toEqual(['預設', '群組 1']);
  });

  it('一條 Track 屬多個群組 → 在每段各出現一次', () => {
    panel.setGroups(groupRows());
    panel.setTracks([
      actionRow('t1', ['default', 'g1'], GROUPS_META),
      actionRow('t2', ['g1'], GROUPS_META),
    ]);
    const [defaultSec, g1Sec] = sections();
    expect([...defaultSec!.querySelectorAll('.jelly-track-row')]).toHaveLength(1); // 只有 t1
    expect([...g1Sec!.querySelectorAll('.jelly-track-row')]).toHaveLength(2); // t1 + t2
    const labels = [...g1Sec!.querySelectorAll('input.jelly-track-label')].map(
      (i) => (i as HTMLInputElement).value,
    );
    expect(labels).toEqual(['動作軌 t1', '動作軌 t2']);
  });

  it('動作軌與相機軌卡片都有 `群組 ▾`（issue #37：相機軌接進分群 UI）', () => {
    panel.setGroups(groupRows());
    panel.setTracks([actionRow('a1', ['default'], GROUPS_META), cameraRow('c1', GROUPS_META)]);
    const [defaultSec] = sections();
    const cards = [...defaultSec!.querySelectorAll('.jelly-track-row')];
    expect(cards).toHaveLength(2);
    const withMenu = cards.filter((c) => c.querySelector('.jelly-track-groups'));
    expect(withMenu).toHaveLength(2);
  });

  it('勾相機軌的 `群組 ▾` → onTrackGroupsChange 收到該相機軌 id + 勾好的群組', () => {
    panel.setGroups(groupRows());
    panel.setTracks([cameraRow('c1', GROUPS_META)]);
    const menu = panel.element.querySelector('.jelly-track-groups')!;
    const boxes = [...menu.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
    boxes[1]!.checked = true; // g1
    boxes[1]!.dispatchEvent(new Event('change'));
    expect(opts.onTrackGroupsChange).toHaveBeenCalledWith('c1', ['default', 'g1']);
  });

  it('沒有成員的群組 → 標頭底下放一行提示', () => {
    panel.setGroups(groupRows());
    panel.setTracks([actionRow('t1', ['default'], GROUPS_META)]);
    const [, g1Sec] = sections();
    expect(g1Sec!.querySelector('.jelly-group-empty')?.textContent).toBe('（尚無 Track）');
  });

  it('勾選 `群組 ▾` 的核取方塊 → onTrackGroupsChange 收到目前勾好的所有 id', () => {
    panel.setGroups(groupRows());
    panel.setTracks([actionRow('t1', ['default'], GROUPS_META)]);
    const menu = panel.element.querySelector('.jelly-track-groups')!;
    const boxes = [...menu.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
    // 第二個是 g1；勾起來
    boxes[1]!.checked = true;
    boxes[1]!.dispatchEvent(new Event('change'));
    expect(opts.onTrackGroupsChange).toHaveBeenCalledWith('t1', ['default', 'g1']);
  });

  it('setPlayableTrackCount(0) → 「▶ 播放」變灰；> 0 且未忙 → 可按', () => {
    panel.setGroups(groupRows());
    panel.setTracks([actionRow('t1', ['default'], GROUPS_META)]);
    const playButton = [...panel.element.querySelectorAll('button')].find(
      (b) => b.textContent === '▶ 播放',
    ) as HTMLButtonElement;
    panel.setPlayableTrackCount(0);
    expect(playButton.disabled).toBe(true);
    panel.setPlayableTrackCount(1);
    expect(playButton.disabled).toBe(false);
  });

  it('錄製中 → 群組標頭控制項 + Track 卡片欄位 + 群組 ▾ 全部 disabled', () => {
    panel.setGroups(groupRows());
    panel.setTracks([actionRow('t1', ['default'], GROUPS_META)]);
    panel.setPlayableTrackCount(1);
    panel.setRecordingActive(true);

    const controls = [
      ...panel.element.querySelectorAll('.jelly-group-section input, .jelly-group-section button'),
    ] as (HTMLInputElement | HTMLButtonElement)[];
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((c) => c.disabled)).toBe(true);

    panel.setRecordingActive(false);
    expect(controls.every((c) => !c.disabled)).toBe(true);
  });

  it('setGroups 先於 setTracks 或反過來，最終結果一致', () => {
    panel.setTracks([actionRow('t1', ['g1'], GROUPS_META)]);
    panel.setGroups(groupRows());
    const [, g1Sec] = sections();
    expect([...g1Sec!.querySelectorAll('.jelly-track-row')]).toHaveLength(1);
  });
});

describe('ControlPanel — 片段初始 Pin 列（issue #39）', () => {
  let panel: ControlPanel;
  let opts: ControlPanelOptions;

  beforeEach(() => {
    opts = makeOptions();
    panel = new ControlPanel(opts);
  });

  function setupRow(): HTMLElement {
    return panel.element.querySelector('.jelly-setup-pins-row') as HTMLElement;
  }
  function buttons(): HTMLButtonElement[] {
    return [...setupRow().querySelectorAll('button')] as HTMLButtonElement[];
  }
  function countText(): string {
    return setupRow().querySelector('.jelly-setup-pins-count')!.textContent ?? '';
  }

  it('預設顯示「片段初始 Pin：0 個」＋兩顆鈕', () => {
    expect(countText()).toBe('片段初始 Pin：0 個');
    expect(buttons().map((b) => b.textContent)).toEqual(['設為目前 Pin', '清除']);
  });

  it('setSetupPinCount 更新數字', () => {
    panel.setSetupPinCount(2);
    expect(countText()).toBe('片段初始 Pin：2 個');
    panel.setSetupPinCount(0);
    expect(countText()).toBe('片段初始 Pin：0 個');
  });

  it('兩顆鈕點下 → 對應回呼', () => {
    const [snapshot, clear] = buttons();
    snapshot!.click();
    clear!.click();
    expect(opts.onSnapshotSetupPins).toHaveBeenCalledTimes(1);
    expect(opts.onClearSetupPins).toHaveBeenCalledTimes(1);
  });

  it('錄製中 / 播放中 → 兩顆鈕變灰，結束後解鎖（不受 Track 數量影響）', () => {
    expect(buttons().every((b) => !b.disabled)).toBe(true);

    panel.setRecordingActive(true);
    expect(buttons().every((b) => b.disabled)).toBe(true);
    panel.setRecordingActive(false);
    expect(buttons().every((b) => !b.disabled)).toBe(true);

    panel.setPlaybackControlsEnabled(false);
    expect(buttons().every((b) => b.disabled)).toBe(true);
    panel.setPlaybackControlsEnabled(true);
    expect(buttons().every((b) => !b.disabled)).toBe(true);
  });
});

describe('ControlPanel — Track 清單內改名（issue #54 / V2 T2-1）', () => {
  let panel: ControlPanel;
  let opts: ControlPanelOptions;

  beforeEach(() => {
    opts = makeOptions();
    panel = new ControlPanel(opts);
    panel.setGroups(groupRows());
  });

  function labelInput(): HTMLInputElement {
    return panel.element.querySelector('input.jelly-track-label') as HTMLInputElement;
  }

  it('每列的名稱是可編輯 input，值為目前的 label', () => {
    panel.setTracks([actionRow('t1', ['default'], GROUPS_META)]);
    const input = labelInput();
    expect(input).toBeTruthy();
    expect(input.tagName).toBe('INPUT');
    expect(input.value).toBe('動作軌 t1');
  });

  it('改名並失焦 → onTrackRename(id, 修剪後的新名)', () => {
    panel.setTracks([actionRow('t1', ['default'], GROUPS_META)]);
    const input = labelInput();
    input.value = '  左上角慢慢拉  ';
    input.dispatchEvent(new Event('change'));
    expect(opts.onTrackRename).toHaveBeenCalledWith('t1', '左上角慢慢拉');
  });

  it('清空名稱 → onTrackRename(id, "")（呼叫端據此退回自動摘要）', () => {
    panel.setTracks([actionRow('t1', ['default'], GROUPS_META)]);
    const input = labelInput();
    input.value = '   ';
    input.dispatchEvent(new Event('change'));
    expect(opts.onTrackRename).toHaveBeenCalledWith('t1', '');
  });

  it('種類標記（動作／相機）與名稱欄位並存，改名不影響種類辨識', () => {
    panel.setTracks([actionRow('a1', ['default'], GROUPS_META), cameraRow('c1', GROUPS_META)]);
    const [defaultSec] = [...panel.element.querySelectorAll('.jelly-group-section')];
    const cards = [...defaultSec!.querySelectorAll('.jelly-track-row')];
    const badges = cards.map((c) => c.querySelector('.jelly-track-badge')?.textContent);
    expect(badges).toEqual(['動作', '相機']);
    expect(cards.every((c) => c.querySelector('input.jelly-track-label'))).toBe(true);
  });

  it('錄製中 → 名稱欄位一併鎖住，結束後解鎖', () => {
    panel.setTracks([actionRow('t1', ['default'], GROUPS_META)]);
    panel.setRecordingActive(true);
    expect(labelInput().disabled).toBe(true);
    panel.setRecordingActive(false);
    expect(labelInput().disabled).toBe(false);
  });

  it('播放中 → 名稱欄位一併鎖住', () => {
    panel.setTracks([actionRow('t1', ['default'], GROUPS_META)]);
    panel.setPlaybackControlsEnabled(false);
    expect(labelInput().disabled).toBe(true);
    panel.setPlaybackControlsEnabled(true);
    expect(labelInput().disabled).toBe(false);
  });
});

describe('ControlPanel — 匯入圖片按鈕（issue #56）', () => {
  it('面板有一顆「匯入圖片」按鈕，點擊呼叫 onImportImage', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);

    const button = [...panel.element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('匯入圖片'),
    );
    expect(button).toBeDefined();

    button!.click();
    expect(opts.onImportImage).toHaveBeenCalledTimes(1);
  });

  it('匯入圖片按鈕不受播放／錄製鎖定影響（重新匯入自帶場景收束）', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const button = [...panel.element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('匯入圖片'),
    )!;

    panel.setPlaybackControlsEnabled(false);
    panel.setRecordingActive(true);

    expect(button.disabled).toBe(false);
    button.click();
    expect(opts.onImportImage).toHaveBeenCalledTimes(1);
  });
});

describe('ControlPanel — 儲存片段按鈕（issue #57 / V2 T2-4）', () => {
  it('面板有一顆「儲存片段」按鈕，點擊呼叫 onSaveClip', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);

    const button = [...panel.element.querySelectorAll('button')].find(
      (b) => b.textContent === '儲存片段',
    );
    expect(button).toBeDefined();

    button!.click();
    expect(opts.onSaveClip).toHaveBeenCalledTimes(1);
  });

  it('儲存片段按鈕任何時候都可用（不受播放／錄製鎖定影響）', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const button = [...panel.element.querySelectorAll('button')].find(
      (b) => b.textContent === '儲存片段',
    )!;

    panel.setPlaybackControlsEnabled(false);
    panel.setRecordingActive(true);

    expect(button.disabled).toBe(false);
    button.click();
    expect(opts.onSaveClip).toHaveBeenCalledTimes(1);
  });
});

describe('ControlPanel — 載入片段按鈕（issue #58 / V2 T2-5）', () => {
  it('面板有一顆「載入片段」按鈕，點擊呼叫 onLoadClip', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);

    const button = [...panel.element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('載入片段'),
    );
    expect(button).toBeDefined();

    button!.click();
    expect(opts.onLoadClip).toHaveBeenCalledTimes(1);
  });

  it('載入片段按鈕任何時候都可用（不受播放／錄製鎖定影響——載入自帶場景收束）', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const button = [...panel.element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('載入片段'),
    )!;

    panel.setPlaybackControlsEnabled(false);
    panel.setRecordingActive(true);

    expect(button.disabled).toBe(false);
    button.click();
    expect(opts.onLoadClip).toHaveBeenCalledTimes(1);
  });

  it('setSoftness／setTapStrength／setBoundary 把值灌回面板對應的控制項', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);

    panel.setSoftness(0.83);
    panel.setTapStrength(7300);
    panel.setBoundary('walled');

    const sliders = [...panel.element.querySelectorAll('input[type=range]')] as HTMLInputElement[];
    expect(sliders.map((s) => s.value)).toEqual(['0.83', '7300']);
    const select = panel.element.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('walled');
  });
});
