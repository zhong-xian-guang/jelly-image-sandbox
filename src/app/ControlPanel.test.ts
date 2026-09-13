/**
 * `ControlPanel` 的 DOM 測試（issue #43 / V2 T1-8）——聚焦「依群組分區的 Track
 * 清單」：每個群組一段標頭 + 底下該群組的成員卡片、一條 Track 屬多組就多次出現、
 * 動作軌與相機軌都畫 `群組 ▾`（issue #37 把相機軌接進分群 UI）、空群組放提示、
 * 鎖定狀態涵蓋整區。`ControlPanel` 是純 DOM 接線層，jsdom 下可直接建。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ControlPanel, type ControlPanelOptions, type TrackListRow } from './ControlPanel';

/** 依 `<label>` 文字內容找出裡面的 range input——`rangeRow` 產生的每個滑桿都是這個形狀。 */
function findRangeInputByLabel(panel: ControlPanel, labelText: string): HTMLInputElement {
  const label = [...panel.element.querySelectorAll('label')].find((l) =>
    l.textContent?.includes(labelText),
  );
  expect(label).toBeDefined();
  return label!.querySelector('input[type=range]') as HTMLInputElement;
}

/** 一份把所有回呼都設成 spy 的最小 options，測試各自覆寫需要的欄位。 */
function makeOptions(overrides: Partial<ControlPanelOptions> = {}): ControlPanelOptions {
  return {
    initial: {
      activeTool: 'general',
      boundary: 'infinite',
      softness: 0.5,
      tapStrength: 6000,
      pinMode: false,
      showPins: true,
      followLocked: false,
      showWireframe: false,
      recordTarget: 'action',
      showFanRange: true,
      showFanIcon: true,
      fanWidth: 150,
      fanStrength: 4000,
      fanFalloffExponent: 2,
      fanFrequency: 2,
      showFormationHint: true,
    },
    tapStrengthRange: { min: 1000, max: 11000, step: 100 },
    fanWidthRange: { min: 20, max: 400, step: 5 },
    fanStrengthRange: { min: 500, max: 12000, step: 100 },
    fanFalloffRange: { min: 0.2, max: 5, step: 0.1 },
    fanFrequencyRange: { min: 0.2, max: 10, step: 0.1 },
    demos: [],
    onImportImage: vi.fn(),
    onSaveClip: vi.fn(),
    onLoadClip: vi.fn(),
    onToolChange: vi.fn(),
    onRemoveFan: vi.fn(),
    onShowFanRangeChange: vi.fn(),
    onShowFanIconChange: vi.fn(),
    onFanWidthChange: vi.fn(),
    onFanStrengthChange: vi.fn(),
    onFanFalloffChange: vi.fn(),
    onFanFrequencyChange: vi.fn(),
    onFormationDefineStart: vi.fn(),
    onFormationDefineEnd: vi.fn(),
    onShowFormationHintChange: vi.fn(),
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

    expect(findRangeInputByLabel(panel, '軟硬度').value).toBe('0.83');
    expect(findRangeInputByLabel(panel, '輕拍力道').value).toBe('7300');
    const selects = [...panel.element.querySelectorAll('select')] as HTMLSelectElement[];
    const boundarySelect = selects.find((s) => s.querySelector('option[value="walled"]'));
    expect(boundarySelect?.value).toBe('walled');
  });
});

describe('ControlPanel — 目前工具選擇器（issue #65 / V2 T3-1；ADR-0011）', () => {
  function findToolSelect(panel: ControlPanel): HTMLSelectElement {
    const select = [...panel.element.querySelectorAll('select')].find((s) =>
      s.querySelector('option[value="general"]'),
    ) as HTMLSelectElement | undefined;
    expect(select).toBeDefined();
    return select!;
  }

  it('預設選中「一般操作」，選項含「一般操作」與「電風扇」', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);

    const select = findToolSelect(panel);
    expect(select.value).toBe('general');
    expect([...select.options].map((o) => o.value)).toEqual(['general', 'fan', 'formation']);
  });

  it('切換選項 → onToolChange 收到新值', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const select = findToolSelect(panel);

    select.value = 'general';
    select.dispatchEvent(new Event('change'));

    expect(opts.onToolChange).toHaveBeenCalledWith('general');
  });

  it('切到「電風扇」→ onToolChange 收到 "fan"', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const select = findToolSelect(panel);

    select.value = 'fan';
    select.dispatchEvent(new Event('change'));

    expect(opts.onToolChange).toHaveBeenCalledWith('fan');
  });
});

describe('ControlPanel — 切到非一般操作的工具時鎖住 Pin 控制項（issue #67 事後檢視追加）', () => {
  function findToolSelect(panel: ControlPanel): HTMLSelectElement {
    return [...panel.element.querySelectorAll('select')].find((s) =>
      s.querySelector('option[value="fan"]'),
    ) as HTMLSelectElement;
  }

  function pinCheckbox(panel: ControlPanel): HTMLInputElement {
    const label = [...panel.element.querySelectorAll('label')].find((l) =>
      l.textContent?.includes('Pin 模式'),
    );
    return label!.querySelector('input[type=checkbox]') as HTMLInputElement;
  }

  function clearPinsButton(panel: ControlPanel): HTMLButtonElement {
    return [...panel.element.querySelectorAll('button')].find(
      (b) => b.textContent === '清除所有 Pin',
    ) as HTMLButtonElement;
  }

  function toolLockHint(panel: ControlPanel): HTMLElement {
    return [...panel.element.querySelectorAll('.jelly-control-hint')].find((el) =>
      el.textContent?.includes('Pin 暫時無法使用'),
    ) as HTMLElement;
  }

  it('初始為「一般操作」→ Pin 控制項可用、提示隱藏', () => {
    const panel = new ControlPanel(makeOptions());
    expect(pinCheckbox(panel).disabled).toBe(false);
    expect(clearPinsButton(panel).disabled).toBe(false);
    expect(toolLockHint(panel).hidden).toBe(true);
  });

  it('切到「電風扇」→ Pin 模式勾選框／清除所有 Pin 都鎖住、提示顯示', () => {
    const panel = new ControlPanel(makeOptions());
    const select = findToolSelect(panel);

    select.value = 'fan';
    select.dispatchEvent(new Event('change'));

    expect(pinCheckbox(panel).disabled).toBe(true);
    expect(clearPinsButton(panel).disabled).toBe(true);
    expect(toolLockHint(panel).hidden).toBe(false);
  });

  it('切回「一般操作」→ 解鎖、提示重新隱藏，且不強制取消勾選 Pin 模式', () => {
    const panel = new ControlPanel(
      makeOptions({ initial: { ...makeOptions().initial, pinMode: true } }),
    );
    const select = findToolSelect(panel);

    select.value = 'fan';
    select.dispatchEvent(new Event('change'));
    select.value = 'general';
    select.dispatchEvent(new Event('change'));

    expect(pinCheckbox(panel).disabled).toBe(false);
    expect(clearPinsButton(panel).disabled).toBe(false);
    expect(toolLockHint(panel).hidden).toBe(true);
    expect(pinCheckbox(panel).checked).toBe(true); // 鎖住期間沒被強制取消勾選
  });

  // issue #68 事後檢視：Pin 模式在非一般操作工具下其實不生效（見
  // `JellySandbox.pinModeActive`），所以「作用中」的強調色也要跟著熄掉，
  // 不然會跟旁邊「Pin 暫時無法使用」的提示自相矛盾。
  it('Pin 模式勾著時切到別的工具 → 「作用中」強調色熄掉；切回一般操作 → 恢復', () => {
    const panel = new ControlPanel(
      makeOptions({ initial: { ...makeOptions().initial, pinMode: true } }),
    );
    const select = findToolSelect(panel);
    const label = () =>
      [...panel.element.querySelectorAll('label')].find((l) =>
        l.textContent?.includes('Pin 模式'),
      ) as HTMLElement;

    expect(label().classList.contains('jelly-pin-mode-active')).toBe(true);

    select.value = 'formation';
    select.dispatchEvent(new Event('change'));
    expect(label().classList.contains('jelly-pin-mode-active')).toBe(false);
    expect(pinCheckbox(panel).checked).toBe(true); // 勾選狀態本身不動

    select.value = 'general';
    select.dispatchEvent(new Event('change'));
    expect(label().classList.contains('jelly-pin-mode-active')).toBe(true);
  });

  it('「顯示 Pin」關閉時切回「一般操作」——兩個鎖住理由是 OR，顯示 Pin 這個理由仍生效', () => {
    const panel = new ControlPanel(
      makeOptions({ initial: { ...makeOptions().initial, showPins: false } }),
    );
    const select = findToolSelect(panel);

    // 一開始就因為「顯示 Pin」關閉而鎖住。
    expect(pinCheckbox(panel).disabled).toBe(true);

    select.value = 'fan';
    select.dispatchEvent(new Event('change'));
    select.value = 'general';
    select.dispatchEvent(new Event('change'));

    // 切回一般操作只解除「工具」這個鎖住理由，「顯示 Pin」關閉仍鎖著。
    expect(pinCheckbox(panel).disabled).toBe(true);
    expect(toolLockHint(panel).hidden).toBe(true); // 提示只跟「工具」理由掛勾，不會誤植成顯示 Pin 的理由
  });
});

describe('ControlPanel — 沙盒工具收合區塊（issue #67 事後檢視追加）', () => {
  function toolDetails(panel: ControlPanel): HTMLDetailsElement {
    return panel.element.querySelector('details.jelly-tool-section') as HTMLDetailsElement;
  }

  function fanParams(panel: ControlPanel): HTMLElement {
    return panel.element.querySelector('.jelly-tool-params') as HTMLElement;
  }

  function findToolSelect(panel: ControlPanel): HTMLSelectElement {
    return [...panel.element.querySelectorAll('select')].find((s) =>
      s.querySelector('option[value="fan"]'),
    ) as HTMLSelectElement;
  }

  it('預設收合——<details> 沒有 open 屬性', () => {
    const panel = new ControlPanel(makeOptions());
    expect(toolDetails(panel).open).toBe(false);
  });

  it('初始為「一般操作」→ 電風扇專屬參數區塊 hidden', () => {
    const panel = new ControlPanel(makeOptions());
    expect(fanParams(panel).hidden).toBe(true);
  });

  it('切到「電風扇」→ 專屬參數區塊顯示；切回「一般操作」→ 再次隱藏', () => {
    const panel = new ControlPanel(makeOptions());
    const select = findToolSelect(panel);

    select.value = 'fan';
    select.dispatchEvent(new Event('change'));
    expect(fanParams(panel).hidden).toBe(false);

    select.value = 'general';
    select.dispatchEvent(new Event('change'));
    expect(fanParams(panel).hidden).toBe(true);
  });

  it('初始工具就是「電風扇」（例如載入片段後重建面板）→ 專屬參數區塊一開始就顯示', () => {
    const panel = new ControlPanel(
      makeOptions({ initial: { ...makeOptions().initial, activeTool: 'fan' } }),
    );
    expect(fanParams(panel).hidden).toBe(false);
  });

  // issue #68 事後檢視：兩個工具上線後，使用者回報兩組參數在面板上混在一起。
  // 根因是 CSS（`.jelly-tool-params` 的 `display: flex` 蓋掉 `[hidden]`，jsdom
  // 載不到樣式表所以測不出來），這裡守的是另一半：同一時間最多只有一組
  // 參數區塊的 `hidden` 是 false，而且每組都帶自己的標題。
  it('任一時刻最多只有一組工具參數區塊沒有 hidden', () => {
    const panel = new ControlPanel(makeOptions());
    const select = findToolSelect(panel);
    const blocks = () => [...panel.element.querySelectorAll('.jelly-tool-params')] as HTMLElement[];
    const visibleCount = () => blocks().filter((el) => !el.hidden).length;

    expect(blocks()).toHaveLength(2); // 電風扇 + 編隊抓取
    expect(visibleCount()).toBe(0); // 一般操作：兩組都收起來

    select.value = 'fan';
    select.dispatchEvent(new Event('change'));
    expect(visibleCount()).toBe(1);

    select.value = 'formation';
    select.dispatchEvent(new Event('change'));
    expect(visibleCount()).toBe(1);
  });

  it('每組工具參數區塊都有自己的標題', () => {
    const panel = new ControlPanel(makeOptions());
    const titles = [...panel.element.querySelectorAll('.jelly-tool-params-title')].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['電風扇', '編隊抓取']);
  });
});

describe('ControlPanel — 電風扇控制項（issue #66 / V2 T3-2）', () => {
  it('面板有一顆「移除風扇」按鈕，點擊呼叫 onRemoveFan', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);

    const button = [...panel.element.querySelectorAll('button')].find(
      (b) => b.textContent === '移除風扇',
    );
    expect(button).toBeDefined();

    button!.click();
    expect(opts.onRemoveFan).toHaveBeenCalledTimes(1);
  });

  it('「顯示風扇範圍」checkbox 初始值來自 initial.showFanRange，切換觸發 onShowFanRangeChange', () => {
    const opts = makeOptions({ initial: { ...makeOptions().initial, showFanRange: false } });
    const panel = new ControlPanel(opts);

    const label = [...panel.element.querySelectorAll('label')].find((l) =>
      l.textContent?.includes('顯示風扇範圍'),
    );
    expect(label).toBeDefined();
    const checkbox = label!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(opts.onShowFanRangeChange).toHaveBeenCalledWith(true);
  });

  it('「顯示風扇圖示」checkbox 初始值來自 initial.showFanIcon，切換觸發 onShowFanIconChange', () => {
    const opts = makeOptions({ initial: { ...makeOptions().initial, showFanIcon: false } });
    const panel = new ControlPanel(opts);

    const label = [...panel.element.querySelectorAll('label')].find((l) =>
      l.textContent?.includes('顯示風扇圖示'),
    );
    expect(label).toBeDefined();
    const checkbox = label!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(opts.onShowFanIconChange).toHaveBeenCalledWith(true);
  });

  it('「風扇寬度」滑桿初始值來自 initial.fanWidth，拖動觸發 onFanWidthChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '風扇寬度');

    expect(Number(input.value)).toBe(opts.initial.fanWidth);
    input.value = '300';
    input.dispatchEvent(new Event('input'));
    expect(opts.onFanWidthChange).toHaveBeenCalledWith(300);
  });

  it('「風扇強度」滑桿初始值來自 initial.fanStrength，拖動觸發 onFanStrengthChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '風扇強度');

    expect(Number(input.value)).toBe(opts.initial.fanStrength);
    input.value = '9000';
    input.dispatchEvent(new Event('input'));
    expect(opts.onFanStrengthChange).toHaveBeenCalledWith(9000);
  });

  it('「風扇衰減程度」滑桿初始值來自 initial.fanFalloffExponent，拖動觸發 onFanFalloffChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '風扇衰減程度');

    expect(Number(input.value)).toBe(opts.initial.fanFalloffExponent);
    input.value = '0.5';
    input.dispatchEvent(new Event('input'));
    expect(opts.onFanFalloffChange).toHaveBeenCalledWith(0.5);
  });

  it('「風扇頻率」滑桿初始值來自 initial.fanFrequency，拖動觸發 onFanFrequencyChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '風扇頻率');

    expect(Number(input.value)).toBe(opts.initial.fanFrequency);
    input.value = '5';
    input.dispatchEvent(new Event('input'));
    expect(opts.onFanFrequencyChange).toHaveBeenCalledWith(5);
  });
});

describe('ControlPanel — 編隊抓取控制項（issue #68 / V2 T3-4）', () => {
  function findToolSelect(panel: ControlPanel): HTMLSelectElement {
    return [...panel.element.querySelectorAll('select')].find((s) =>
      s.querySelector('option[value="formation"]'),
    ) as HTMLSelectElement;
  }

  function switchToFormation(panel: ControlPanel): void {
    const select = findToolSelect(panel);
    select.value = 'formation';
    select.dispatchEvent(new Event('change'));
  }

  function formationParams(panel: ControlPanel): HTMLElement {
    return [...panel.element.querySelectorAll('.jelly-tool-params')].find((el) =>
      el.textContent?.includes('編隊'),
    ) as HTMLElement;
  }

  function defineButton(panel: ControlPanel): HTMLButtonElement {
    return [...formationParams(panel).querySelectorAll('button')][0] as HTMLButtonElement;
  }

  it('切到「編隊抓取」→ onToolChange 收到 "formation"，專屬參數區塊顯示、電風扇區塊隱藏', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    switchToFormation(panel);

    expect(opts.onToolChange).toHaveBeenCalledWith('formation');
    expect(formationParams(panel).hidden).toBe(false);
  });

  it('初始工具就是「編隊抓取」→ 專屬參數區塊一開始就顯示', () => {
    const panel = new ControlPanel(
      makeOptions({ initial: { ...makeOptions().initial, activeTool: 'formation' } }),
    );
    expect(formationParams(panel).hidden).toBe(false);
  });

  it('「顯示編隊抓取提示」checkbox 初始值來自 initial.showFormationHint，切換觸發 onShowFormationHintChange', () => {
    const opts = makeOptions({ initial: { ...makeOptions().initial, showFormationHint: false } });
    const panel = new ControlPanel(opts);

    const label = [...panel.element.querySelectorAll('label')].find((l) =>
      l.textContent?.includes('顯示編隊抓取提示'),
    );
    expect(label).toBeDefined();
    const checkbox = label!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(opts.onShowFormationHintChange).toHaveBeenCalledWith(true);
  });

  it('按鈕依狀態換文字：開始設定形狀 → 完成設定 → 重新設定編隊形狀，各自呼叫對應回呼', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    switchToFormation(panel);
    const button = defineButton(panel);

    expect(button.textContent).toBe('開始設定形狀');
    button.click();
    expect(opts.onFormationDefineStart).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('完成設定');

    button.click();
    expect(opts.onFormationDefineEnd).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('重新設定編隊形狀');

    button.click();
    expect(opts.onFormationDefineStart).toHaveBeenCalledTimes(2);
    expect(button.textContent).toBe('完成設定');
  });
});
