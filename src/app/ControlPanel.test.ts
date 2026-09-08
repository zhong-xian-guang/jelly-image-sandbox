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
    expect(g1Sec!.textContent).toContain('動作軌 t1');
    expect(g1Sec!.textContent).toContain('動作軌 t2');
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
