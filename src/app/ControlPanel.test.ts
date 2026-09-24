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
      gravity: 0,
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
      sprayRadius: 140,
      spraySpacing: 36,
      eraseRadius: 100,
      handfulRadius: 140,
      showHandfulRange: true,
      hideHintsDuringPlayback: false,
      importSize: 512,
      meshDensity: 350,
    },
    importSizeRange: { min: 128, max: 1024, step: 16 },
    meshDensityRange: { min: 100, max: 800, step: 10 },
    tapStrengthRange: { min: 1000, max: 11000, step: 100 },
    gravityRange: { min: 0, max: 10000, step: 100 },
    fanWidthRange: { min: 20, max: 400, step: 5 },
    fanStrengthRange: { min: 500, max: 12000, step: 100 },
    fanFalloffRange: { min: 0.2, max: 5, step: 0.1 },
    fanFrequencyRange: { min: 0.2, max: 10, step: 0.1 },
    sprayRadiusRange: { min: 20, max: 400, step: 10 },
    spraySpacingRange: { min: 12, max: 120, step: 2 },
    eraseRadiusRange: { min: 20, max: 400, step: 10 },
    handfulRadiusRange: { min: 20, max: 400, step: 10 },
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
    onSprayRadiusChange: vi.fn(),
    onSpraySpacingChange: vi.fn(),
    onEraseRadiusChange: vi.fn(),
    onHandfulRadiusChange: vi.fn(),
    onShowHandfulRangeChange: vi.fn(),
    onHideHintsDuringPlaybackChange: vi.fn(),
    onImportSizeChange: vi.fn(),
    onMeshDensityChange: vi.fn(),
    onRebuildAll: vi.fn(),
    onClearAll: vi.fn(),
    onBoundaryChange: vi.fn(),
    onSoftnessChange: vi.fn(),
    onTapStrengthChange: vi.fn(),
    onGravityChange: vi.fn(),
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

describe('ControlPanel — 邊界下拉（issue #92 / V3 T2-2；ADR-0012）', () => {
  const boundarySelect = (panel: ControlPanel): HTMLSelectElement => {
    const selects = [...panel.element.querySelectorAll('select')] as HTMLSelectElement[];
    const select = selects.find((s) => s.querySelector('option[value="walled"]'));
    if (!select) throw new Error('找不到邊界下拉');
    return select;
  };

  it('邊界下拉含三個選項：無限／有牆／僅地板', () => {
    const panel = new ControlPanel(makeOptions());
    const options = [...boundarySelect(panel).options].map((o) => [o.value, o.textContent]);
    expect(options).toEqual([
      ['infinite', '無限'],
      ['walled', '有牆'],
      ['floor', '僅地板'],
    ]);
  });

  it("選「僅地板」→ onBoundaryChange 收到 'floor'", () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const select = boundarySelect(panel);
    select.value = 'floor';
    select.dispatchEvent(new Event('change'));
    expect(opts.onBoundaryChange).toHaveBeenCalledWith('floor');
  });

  it("setBoundary('floor') 同步顯示、不觸發回呼", () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    panel.setBoundary('floor');
    expect(boundarySelect(panel).value).toBe('floor');
    expect(opts.onBoundaryChange).not.toHaveBeenCalled();
  });
});

describe('ControlPanel — 重力拉霸（issue #91 / V3 T2-1；ADR-0012）', () => {
  it('「重力」拉霸初始值來自 initial.gravity（0），範圍來自 gravityRange', () => {
    const panel = new ControlPanel(makeOptions());
    const input = findRangeInputByLabel(panel, '重力');
    expect(Number(input.value)).toBe(0);
    expect(Number(input.min)).toBe(0);
    expect(Number(input.max)).toBe(10000);
    expect(Number(input.step)).toBe(100);
  });

  it('拖動 → onGravityChange 收到數值', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '重力');
    input.value = '850';
    input.dispatchEvent(new Event('input'));
    expect(opts.onGravityChange).toHaveBeenCalledWith(850);
  });

  it('拉霸旁顯示目前數值，拖動時跟著更新', () => {
    const panel = new ControlPanel(makeOptions());
    const input = findRangeInputByLabel(panel, '重力');
    const row = input.closest('label')!;
    expect(row.querySelector('output')?.textContent).toBe('0');
    input.value = '850';
    input.dispatchEvent(new Event('input'));
    expect(row.querySelector('output')?.textContent).toBe('850');
  });

  it('setGravity 更新拉霸與數值顯示、不回呼 onGravityChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    panel.setGravity(1200);
    const input = findRangeInputByLabel(panel, '重力');
    expect(input.value).toBe('1200');
    expect(input.closest('label')!.querySelector('output')?.textContent).toBe('1200');
    expect(opts.onGravityChange).not.toHaveBeenCalled();
  });

  it('「重力」列緊接在「軟硬度」／「輕拍力道」之後（同為全域物理參數）', () => {
    const panel = new ControlPanel(makeOptions());
    const tapRow = findRangeInputByLabel(panel, '輕拍力道').closest('label')!;
    const gravityRow = findRangeInputByLabel(panel, '重力').closest('label')!;
    expect(tapRow.nextElementSibling).toBe(gravityRow);
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

  it('預設選中「一般操作」，選項含目前上線的每個沙盒工具', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);

    const select = findToolSelect(panel);
    expect(select.value).toBe('general');
    expect([...select.options].map((o) => o.value)).toEqual([
      'general',
      'pin',
      'handfulGrab',
      'fan',
      'formation',
      'spray',
      'erase',
      'spawn',
      'removeJelly',
      'rebuildJelly',
    ]);
  });

  it('切到「生成 Jelly」／「移除 Jelly」→ onToolChange 收到對應值（issue #97）', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const select = findToolSelect(panel);

    select.value = 'spawn';
    select.dispatchEvent(new Event('change'));
    expect(opts.onToolChange).toHaveBeenCalledWith('spawn');

    select.value = 'removeJelly';
    select.dispatchEvent(new Event('change'));
    expect(opts.onToolChange).toHaveBeenCalledWith('removeJelly');
  });

  it('切到「重建 Jelly」→ onToolChange 收到 "rebuildJelly"（issue #98）', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const select = findToolSelect(panel);

    select.value = 'rebuildJelly';
    select.dispatchEvent(new Event('change'));
    expect(opts.onToolChange).toHaveBeenCalledWith('rebuildJelly');
  });

  it('播放中三個 Jelly 工具都變灰，其餘工具照常可選（issue #97 / #98）', () => {
    const panel = new ControlPanel(makeOptions());
    const select = findToolSelect(panel);
    const disabledValues = () => [...select.options].filter((o) => o.disabled).map((o) => o.value);

    expect(disabledValues()).toEqual([]);

    panel.setPlaybackControlsEnabled(false);
    expect(disabledValues()).toEqual(['spawn', 'removeJelly', 'rebuildJelly']);
    expect(select.disabled).toBe(false);

    panel.setPlaybackControlsEnabled(true);
    expect(disabledValues()).toEqual([]);
  });

  it('錄製中只有「重建 Jelly」變灰——生成／移除本來就要錄進 Track（issue #97 / #98）', () => {
    const panel = new ControlPanel(makeOptions());
    const select = findToolSelect(panel);
    const disabledValues = () => [...select.options].filter((o) => o.disabled).map((o) => o.value);

    panel.setRecordingActive(true);
    expect(disabledValues()).toEqual(['rebuildJelly']);

    panel.setRecordingActive(false);
    expect(disabledValues()).toEqual([]);
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

describe('ControlPanel — Pin 工具取代「Pin 模式」勾選框（issue #115；ADR-0015）', () => {
  function findToolSelect(panel: ControlPanel): HTMLSelectElement {
    return [...panel.element.querySelectorAll('select')].find((s) =>
      s.querySelector('option[value="pin"]'),
    ) as HTMLSelectElement;
  }

  function clearPinsButton(panel: ControlPanel): HTMLButtonElement {
    return [...panel.element.querySelectorAll('button')].find(
      (b) => b.textContent === '清除所有 Pin',
    ) as HTMLButtonElement;
  }

  it('面板上不再有「Pin 模式」勾選框，也沒有「Pin 暫時無法使用」提示', () => {
    const panel = new ControlPanel(makeOptions());
    expect(panel.element.textContent).not.toContain('Pin 模式');
    expect(panel.element.textContent).not.toContain('Pin 暫時無法使用');
  });

  it('工具選擇器有「Pin」選項，切過去 → onToolChange 收到 "pin"', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const select = findToolSelect(panel);
    expect(select.querySelector('option[value="pin"]')!.textContent).toBe('Pin');

    select.value = 'pin';
    select.dispatchEvent(new Event('change'));
    expect(opts.onToolChange).toHaveBeenCalledWith('pin');
  });

  it('「清除所有 Pin」不受目前工具影響（切到電風扇仍可用）', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const select = findToolSelect(panel);
    select.value = 'fan';
    select.dispatchEvent(new Event('change'));

    expect(clearPinsButton(panel).disabled).toBe(false);
    clearPinsButton(panel).click();
    expect(opts.onClearPins).toHaveBeenCalled();
  });

  it('「顯示 Pin」關閉 → 「清除所有 Pin」鎖住（所見即所得）；打開 → 解鎖', () => {
    const panel = new ControlPanel(
      makeOptions({ initial: { ...makeOptions().initial, showPins: false } }),
    );
    expect(clearPinsButton(panel).disabled).toBe(true);

    const showPins = [...panel.element.querySelectorAll('label')]
      .find((l) => l.textContent?.includes('顯示 Pin'))!
      .querySelector('input[type=checkbox]') as HTMLInputElement;
    showPins.checked = true;
    showPins.dispatchEvent(new Event('change'));
    expect(clearPinsButton(panel).disabled).toBe(false);
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

    expect(blocks()).toHaveLength(5); // 電風扇 + 編隊抓取 + 撒 Pin + 移除 Pin + 大把抓取
    expect(visibleCount()).toBe(0); // 一般操作：四組都收起來

    select.value = 'fan';
    select.dispatchEvent(new Event('change'));
    expect(visibleCount()).toBe(1);

    select.value = 'formation';
    select.dispatchEvent(new Event('change'));
    expect(visibleCount()).toBe(1);

    select.value = 'spray';
    select.dispatchEvent(new Event('change'));
    expect(visibleCount()).toBe(1);

    select.value = 'erase';
    select.dispatchEvent(new Event('change'));
    expect(visibleCount()).toBe(1);
  });

  it('每組工具參數區塊都有自己的標題', () => {
    const panel = new ControlPanel(makeOptions());
    const titles = [...panel.element.querySelectorAll('.jelly-tool-params-title')].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['電風扇', '編隊抓取', '撒 Pin', '移除 Pin', '大把抓取']);
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

describe('ControlPanel — 撒 Pin 控制項（issue #69 / V2 T3-5）', () => {
  function findToolSelect(panel: ControlPanel): HTMLSelectElement {
    return [...panel.element.querySelectorAll('select')].find((s) =>
      s.querySelector('option[value="spray"]'),
    ) as HTMLSelectElement;
  }

  function sprayParams(panel: ControlPanel): HTMLElement {
    return [...panel.element.querySelectorAll('.jelly-tool-params')].find((el) =>
      el.textContent?.includes('撒 Pin 範圍半徑'),
    ) as HTMLElement;
  }

  it('切到「撒 Pin」→ onToolChange 收到 "spray"，專屬參數區塊顯示', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const select = findToolSelect(panel);

    expect(sprayParams(panel).hidden).toBe(true);
    select.value = 'spray';
    select.dispatchEvent(new Event('change'));

    expect(opts.onToolChange).toHaveBeenCalledWith('spray');
    expect(sprayParams(panel).hidden).toBe(false);
  });

  it('初始工具就是「撒 Pin」→ 專屬參數區塊一開始就顯示', () => {
    const panel = new ControlPanel(
      makeOptions({ initial: { ...makeOptions().initial, activeTool: 'spray' } }),
    );
    expect(sprayParams(panel).hidden).toBe(false);
  });

  it('「撒 Pin 範圍半徑」滑桿初始值來自 initial.sprayRadius，拖動觸發 onSprayRadiusChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '撒 Pin 範圍半徑');

    expect(Number(input.value)).toBe(opts.initial.sprayRadius);
    input.value = '300';
    input.dispatchEvent(new Event('input'));
    expect(opts.onSprayRadiusChange).toHaveBeenCalledWith(300);
  });

  it('「撒 Pin 間距」滑桿初始值來自 initial.spraySpacing，拖動觸發 onSpraySpacingChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '撒 Pin 間距');

    expect(Number(input.value)).toBe(opts.initial.spraySpacing);
    input.value = '20';
    input.dispatchEvent(new Event('input'));
    expect(opts.onSpraySpacingChange).toHaveBeenCalledWith(20);
  });
});

describe('ControlPanel — 移除 Pin 控制項（issue #70 / V2 T3-6）', () => {
  function findToolSelect(panel: ControlPanel): HTMLSelectElement {
    return [...panel.element.querySelectorAll('select')].find((s) =>
      s.querySelector('option[value="erase"]'),
    ) as HTMLSelectElement;
  }

  function eraseParams(panel: ControlPanel): HTMLElement {
    return [...panel.element.querySelectorAll('.jelly-tool-params')].find((el) =>
      el.textContent?.includes('移除 Pin 範圍半徑'),
    ) as HTMLElement;
  }

  it('切到「移除 Pin」→ onToolChange 收到 "erase"，專屬參數區塊顯示', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const select = findToolSelect(panel);

    expect(eraseParams(panel).hidden).toBe(true);
    select.value = 'erase';
    select.dispatchEvent(new Event('change'));

    expect(opts.onToolChange).toHaveBeenCalledWith('erase');
    expect(eraseParams(panel).hidden).toBe(false);
  });

  it('「移除 Pin 範圍半徑」滑桿初始值來自 initial.eraseRadius，拖動觸發 onEraseRadiusChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '移除 Pin 範圍半徑');

    expect(Number(input.value)).toBe(opts.initial.eraseRadius);
    input.value = '250';
    input.dispatchEvent(new Event('input'));
    expect(opts.onEraseRadiusChange).toHaveBeenCalledWith(250);
  });

  // 驗收條件「跟撒 Pin 的半徑參數各自獨立」在面板這一端的意思：兩條各自獨立的
  // 滑桿、各自獨立的回呼，動其中一條不會連帶觸發另一條。
  it('跟撒 Pin 的半徑是兩條各自獨立的滑桿，動一條不動到另一條', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const eraseInput = findRangeInputByLabel(panel, '移除 Pin 範圍半徑');
    const sprayInput = findRangeInputByLabel(panel, '撒 Pin 範圍半徑');
    expect(eraseInput).not.toBe(sprayInput);

    eraseInput.value = '200';
    eraseInput.dispatchEvent(new Event('input'));
    expect(opts.onEraseRadiusChange).toHaveBeenCalledWith(200);
    expect(opts.onSprayRadiusChange).not.toHaveBeenCalled();
    expect(Number(sprayInput.value)).toBe(opts.initial.sprayRadius);
  });
});

describe('ControlPanel — 播放時隱藏提示（issue #71 / V2 T3-7）', () => {
  function findHideHintsCheckbox(panel: ControlPanel): HTMLInputElement {
    const label = [...panel.element.querySelectorAll('label')].find((l) =>
      l.textContent?.includes('播放時隱藏提示'),
    );
    expect(label).toBeDefined();
    return label!.querySelector('input[type="checkbox"]') as HTMLInputElement;
  }

  it('checkbox 初始值來自 initial.hideHintsDuringPlayback，切換觸發 onHideHintsDuringPlaybackChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const checkbox = findHideHintsCheckbox(panel);
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(opts.onHideHintsDuringPlaybackChange).toHaveBeenCalledWith(true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(opts.onHideHintsDuringPlaybackChange).toHaveBeenLastCalledWith(false);
  });

  it('初始值為 true → 勾選框一開始就是勾著的', () => {
    const base = makeOptions();
    const panel = new ControlPanel(
      makeOptions({ initial: { ...base.initial, hideHintsDuringPlayback: true } }),
    );
    expect(findHideHintsCheckbox(panel).checked).toBe(true);
  });

  // 驗收條件：這個開關「本身不受播放狀態影響、隨時可切換」——播放中鎖住的是
  // Demo／錄製／Track 清單那一批，不包含它。
  it('播放中／錄製中仍可切換（不被 setPlaybackControlsEnabled／setRecordingActive 鎖住）', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    panel.setPlaybackControlsEnabled(false);
    panel.setRecordingActive(true);

    const checkbox = findHideHintsCheckbox(panel);
    expect(checkbox.disabled).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(opts.onHideHintsDuringPlaybackChange).toHaveBeenCalledWith(true);
  });

  // 它蓋掉的是「所有提示」，不是某個工具專屬的東西——因此不該躲在任何一個
  // 工具專屬區塊（`.jelly-tool-params`）裡面，切工具不會讓它消失。
  it('是面板上的全域一列，不屬於任何工具專屬參數區塊', () => {
    const panel = new ControlPanel(makeOptions());
    const checkbox = findHideHintsCheckbox(panel);
    expect(checkbox.closest('.jelly-tool-params')).toBeNull();
  });
});

describe('ControlPanel — 匯入區塊：匯入尺寸拉霸（issue #88 / V3 T1-1）', () => {
  it('面板有「匯入」小標題', () => {
    const panel = new ControlPanel(makeOptions());
    const headings = [...panel.element.querySelectorAll('.jelly-control-heading')].map(
      (h) => h.textContent,
    );
    expect(headings).toContain('匯入');
  });

  it('「匯入尺寸」拉霸初始值來自 initial.importSize（512），範圍來自 importSizeRange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '匯入尺寸');
    expect(Number(input.value)).toBe(512);
    expect(Number(input.min)).toBe(128);
    expect(Number(input.max)).toBe(1024);
    expect(Number(input.step)).toBe(16);
  });

  it('拖動 → onImportSizeChange 收到數值', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '匯入尺寸');
    input.value = '256';
    input.dispatchEvent(new Event('input'));
    expect(opts.onImportSizeChange).toHaveBeenCalledWith(256);
  });

  it('拉霸旁顯示目前數值，拖動時跟著更新', () => {
    const panel = new ControlPanel(makeOptions());
    const input = findRangeInputByLabel(panel, '匯入尺寸');
    const row = input.closest('label')!;
    expect(row.textContent).toContain('512');
    input.value = '256';
    input.dispatchEvent(new Event('input'));
    expect(row.textContent).toContain('256');
    expect(row.textContent).not.toContain('512');
  });

  it('不受播放／錄製鎖定影響（拉霸只管「下一次」匯入）', () => {
    const panel = new ControlPanel(makeOptions());
    const input = findRangeInputByLabel(panel, '匯入尺寸');
    panel.setRecordingActive(true);
    expect(input.disabled).toBe(false);
    panel.setRecordingActive(false);
    panel.setPlaybackControlsEnabled(false);
    expect(input.disabled).toBe(false);
  });
});

describe('ControlPanel — 匯入區塊：網格密度拉霸（issue #89 / V3 T1-2）', () => {
  it('「網格密度」拉霸初始值來自 initial.meshDensity（350），範圍來自 meshDensityRange', () => {
    const panel = new ControlPanel(makeOptions());
    const input = findRangeInputByLabel(panel, '網格密度');
    expect(Number(input.value)).toBe(350);
    expect(Number(input.min)).toBe(100);
    expect(Number(input.max)).toBe(800);
    expect(Number(input.step)).toBe(10);
  });

  it('拖動 → onMeshDensityChange 收到數值，旁邊的數值跟著更新', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '網格密度');
    const row = input.closest('label')!;
    expect(row.textContent).toContain('350');
    input.value = '800';
    input.dispatchEvent(new Event('input'));
    expect(opts.onMeshDensityChange).toHaveBeenCalledWith(800);
    expect(row.textContent).toContain('800');
    expect(row.textContent).not.toContain('350');
  });

  it('setMeshDensity(value) 更新拉霸與數值顯示，但不觸發 onMeshDensityChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '網格密度');
    const row = input.closest('label')!;
    panel.setMeshDensity(170);
    expect(Number(input.value)).toBe(170);
    expect(row.textContent).toContain('170');
    expect(row.textContent).not.toContain('350');
    expect(opts.onMeshDensityChange).not.toHaveBeenCalled();
  });

  it('「網格密度」列在「匯入」小標題底下、跟「匯入尺寸」同區', () => {
    const panel = new ControlPanel(makeOptions());
    const heading = [...panel.element.querySelectorAll('.jelly-control-heading')].find(
      (h) => h.textContent === '匯入',
    )!;
    const importSizeRow = findRangeInputByLabel(panel, '匯入尺寸').closest('label')!;
    const densityRow = findRangeInputByLabel(panel, '網格密度').closest('label')!;
    // 三者在同一個父節點下、且順序為 小標題 → 匯入尺寸 → 網格密度。
    const siblings = [...heading.parentElement!.children];
    expect(siblings.indexOf(heading)).toBeLessThan(siblings.indexOf(importSizeRow));
    expect(siblings.indexOf(importSizeRow)).toBeLessThan(siblings.indexOf(densityRow));
  });

  it('不受播放／錄製鎖定影響（拉霸只管「下一次」匯入）', () => {
    const panel = new ControlPanel(makeOptions());
    const input = findRangeInputByLabel(panel, '網格密度');
    panel.setRecordingActive(true);
    expect(input.disabled).toBe(false);
    panel.setRecordingActive(false);
    panel.setPlaybackControlsEnabled(false);
    expect(input.disabled).toBe(false);
  });
});

describe('ControlPanel — 匯入區塊：「全部重建」按鈕（issue #90 / #98）', () => {
  function rebuildButton(panel: ControlPanel): HTMLButtonElement {
    const button = [...panel.element.querySelectorAll('button')].find(
      (b) => b.textContent === '全部重建',
    );
    expect(button).toBeDefined();
    return button!;
  }

  it('面板有一顆「全部重建」按鈕，點擊呼叫 onRebuildAll（issue #98）', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    rebuildButton(panel).click();
    expect(opts.onRebuildAll).toHaveBeenCalledTimes(1);
  });

  it('「全部重建」列在「匯入」區塊最後（小標題 → 匯入尺寸 → 網格密度 → 全部重建）', () => {
    const panel = new ControlPanel(makeOptions());
    const heading = [...panel.element.querySelectorAll('.jelly-control-heading')].find(
      (h) => h.textContent === '匯入',
    )!;
    const densityRow = findRangeInputByLabel(panel, '網格密度').closest('label')!;
    const rebuildRow = rebuildButton(panel).closest('.jelly-control-row')!;
    const siblings = [...heading.parentElement!.children];
    expect(siblings.indexOf(heading)).toBeLessThan(siblings.indexOf(densityRow));
    expect(siblings.indexOf(densityRow) + 1).toBe(siblings.indexOf(rebuildRow));
  });

  it('錄製中／播放中 → 按鈕變灰，結束後解鎖（不受 Track 數量影響）', () => {
    const panel = new ControlPanel(makeOptions());
    const button = rebuildButton(panel);
    expect(button.disabled).toBe(false);

    panel.setRecordingActive(true);
    expect(button.disabled).toBe(true);
    panel.setRecordingActive(false);
    expect(button.disabled).toBe(false);

    panel.setPlaybackControlsEnabled(false);
    expect(button.disabled).toBe(true);
    panel.setPlaybackControlsEnabled(true);
    expect(button.disabled).toBe(false);

    // 有 Track 也一樣：鎖與解鎖只看錄製／播放狀態。
    panel.setGroups(groupRows());
    panel.setTracks([actionRow('t1', ['default'], GROUPS_META)]);
    panel.setPlaybackControlsEnabled(false);
    expect(button.disabled).toBe(true);
    panel.setPlaybackControlsEnabled(true);
    expect(button.disabled).toBe(false);
  });
});

describe('ControlPanel — 「清空全部」按鈕（issue #95 / V3 T3-2；ADR-0013）', () => {
  function clearAllButton(panel: ControlPanel): HTMLButtonElement {
    const button = [...panel.element.querySelectorAll('button')].find(
      (b) => b.textContent === '清空全部',
    );
    expect(button).toBeDefined();
    return button!;
  }

  it('面板有一顆「清空全部」按鈕，點擊呼叫 onClearAll', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    clearAllButton(panel).click();
    expect(opts.onClearAll).toHaveBeenCalledTimes(1);
  });

  it('錄製中／播放中 → 按鈕變灰，結束後解鎖', () => {
    const panel = new ControlPanel(makeOptions());
    const button = clearAllButton(panel);
    expect(button.disabled).toBe(false);
    panel.setRecordingActive(true);
    expect(button.disabled).toBe(true);
    panel.setRecordingActive(false);
    expect(button.disabled).toBe(false);
    panel.setPlaybackControlsEnabled(false);
    expect(button.disabled).toBe(true);
    panel.setPlaybackControlsEnabled(true);
    expect(button.disabled).toBe(false);
  });
});

describe('ControlPanel — 大把抓取控制項（issue #113 / V3 T4-1）', () => {
  function findToolSelect(panel: ControlPanel): HTMLSelectElement {
    return [...panel.element.querySelectorAll('select')].find((s) =>
      s.querySelector('option[value="handfulGrab"]'),
    ) as HTMLSelectElement;
  }

  function handfulParams(panel: ControlPanel): HTMLElement {
    return [...panel.element.querySelectorAll('.jelly-tool-params')].find((el) =>
      el.textContent?.includes('大把抓取半徑'),
    ) as HTMLElement;
  }

  it('工具選擇器有「大把抓取」；切過去 → onToolChange("handfulGrab")、專屬參數區塊顯示', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const select = findToolSelect(panel);
    expect(select.querySelector('option[value="handfulGrab"]')!.textContent).toBe('大把抓取');

    expect(handfulParams(panel).hidden).toBe(true);
    select.value = 'handfulGrab';
    select.dispatchEvent(new Event('change'));
    expect(opts.onToolChange).toHaveBeenCalledWith('handfulGrab');
    expect(handfulParams(panel).hidden).toBe(false);
  });

  it('「大把抓取半徑」拉霸範圍與初始值來自 options，拖動觸發 onHandfulRadiusChange', () => {
    const opts = makeOptions({ initial: { ...makeOptions().initial, handfulRadius: 180 } });
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '大把抓取半徑');
    expect([input.min, input.max, input.step]).toEqual(['20', '400', '10']);
    expect(Number(input.value)).toBe(180);

    input.value = '260';
    input.dispatchEvent(new Event('input'));
    expect(opts.onHandfulRadiusChange).toHaveBeenCalledWith(260);
    expect(opts.onSprayRadiusChange).not.toHaveBeenCalled();
  });

  it('「顯示大把抓取範圍」checkbox 初始值來自 initial.showHandfulRange，切換觸發回呼', () => {
    const opts = makeOptions({ initial: { ...makeOptions().initial, showHandfulRange: false } });
    const panel = new ControlPanel(opts);
    const label = [...handfulParams(panel).querySelectorAll('label')].find((l) =>
      l.textContent?.includes('顯示大把抓取範圍'),
    );
    const checkbox = label!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(opts.onShowHandfulRangeChange).toHaveBeenCalledWith(true);
  });
});

describe('ControlPanel — 右鍵＋滾輪調半徑的拉霸同步（issue #114 / V3 T4-2）', () => {
  it('setToolRadius 只動對應工具的半徑拉霸，不觸發 onChange 回呼', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const spray = findRangeInputByLabel(panel, '撒 Pin 範圍半徑');
    const erase = findRangeInputByLabel(panel, '移除 Pin 範圍半徑');
    const handful = findRangeInputByLabel(panel, '大把抓取半徑');
    const before = [spray.value, erase.value, handful.value];

    panel.setToolRadius('spray', 230);
    expect([spray.value, erase.value, handful.value]).toEqual(['230', before[1], before[2]]);
    panel.setToolRadius('erase', 50);
    expect(erase.value).toBe('50');
    panel.setToolRadius('handfulGrab', 310);
    expect(handful.value).toBe('310');

    expect(opts.onSprayRadiusChange).not.toHaveBeenCalled();
    expect(opts.onEraseRadiusChange).not.toHaveBeenCalled();
    expect(opts.onHandfulRadiusChange).not.toHaveBeenCalled();
  });
});
