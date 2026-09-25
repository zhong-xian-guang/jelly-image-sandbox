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
      activeTool: 'grab',
      toolModes: { grab: 'single', pin: 'place' },
      showCursorLabel: true,
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
      pinBrushRadius: 120,
      spraySpacing: 36,
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
    pinBrushRadiusRange: { min: 20, max: 400, step: 10 },
    spraySpacingRange: { min: 12, max: 120, step: 2 },
    handfulRadiusRange: { min: 20, max: 400, step: 10 },
    demos: [],
    onImportImage: vi.fn(),
    onSaveClip: vi.fn(),
    onLoadClip: vi.fn(),
    onToolChange: vi.fn(),
    onModeChange: vi.fn(),
    onShowCursorLabelChange: vi.fn(),
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
    onPinBrushRadiusChange: vi.fn(),
    onSpraySpacingChange: vi.fn(),
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

/** 工具列上某個工具的按鈕（issue #122）。 */
function toolButton(panel: ControlPanel, tool: string): HTMLButtonElement {
  const button = panel.element.querySelector(
    `.jelly-toolbar button[data-tool="${tool}"]`,
  ) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  return button!;
}

/** 按工具列上的某顆按鈕（issue #122）。 */
function clickTool(panel: ControlPanel, tool: string): void {
  toolButton(panel, tool).click();
}

/** 目前高亮的工具按鈕的 `data-tool`。 */
function highlightedTools(panel: ControlPanel): string[] {
  return [...panel.element.querySelectorAll('.jelly-toolbar button.is-active')].map(
    (b) => (b as HTMLButtonElement).dataset.tool!,
  );
}

/** 參數卡上某個模式鈕（issue #122）——各工具的模式名稱互不重複，用模式就找得到。 */
function modeButton(panel: ControlPanel, mode: string): HTMLButtonElement {
  const button = panel.element.querySelector(
    `.jelly-mode-row button[data-mode="${mode}"]`,
  ) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  return button!;
}

function highlightedModes(panel: ControlPanel, tool = 'grab'): string[] {
  return [
    ...panel.element.querySelectorAll(`.jelly-mode-row[data-tool="${tool}"] button.is-active`),
  ].map((b) => (b as HTMLButtonElement).dataset.mode!);
}

/** 參數卡裡目前沒有 `hidden` 的那幾組（issue #122：最多一組）。 */
function visibleCards(panel: ControlPanel): HTMLElement[] {
  return (
    [...panel.element.querySelectorAll('.jelly-tool-card .jelly-tool-params')] as HTMLElement[]
  ).filter((el) => !el.hidden);
}

describe('ControlPanel — 工具列（issue #122 / V4 T1；ADR-0016）', () => {
  it('不再有「沙盒工具」收合區塊與目前工具下拉', () => {
    const panel = new ControlPanel(makeOptions());
    expect(panel.element.querySelector('details.jelly-tool-section')).toBeNull();
    expect(panel.element.textContent).not.toContain('沙盒工具');
    expect(panel.element.textContent).not.toContain('目前工具');
    const toolSelect = [...panel.element.querySelectorAll('select')].find((s) =>
      s.querySelector('option[value="fan"], option[value="grab"], option[value="general"]'),
    );
    expect(toolSelect).toBeUndefined();
  });

  it('工具列在側欄最上方，每個工具一顆按鈕（圖示＋文字），照工具列順序', () => {
    const panel = new ControlPanel(makeOptions());
    expect(panel.element.firstElementChild!.querySelector('.jelly-toolbar')).not.toBeNull();
    const buttons = [
      ...panel.element.querySelectorAll('.jelly-toolbar button'),
    ] as HTMLButtonElement[];
    expect(buttons.map((b) => b.dataset.tool)).toEqual(['grab', 'pin', 'fan', 'jelly']);
    expect(buttons.map((b) => b.querySelector('.jelly-tool-button-text')!.textContent)).toEqual([
      '抓取',
      'Pin',
      '電風扇',
      'Jelly',
    ]);
    for (const b of buttons) {
      expect(b.querySelector('.jelly-tool-button-icon')!.textContent).not.toBe('');
    }
  });

  it('高亮目前工具（預設抓取）；點一下就切換並回呼 onToolChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    expect(highlightedTools(panel)).toEqual(['grab']);
    expect(toolButton(panel, 'grab').getAttribute('aria-pressed')).toBe('true');

    clickTool(panel, 'fan');
    expect(opts.onToolChange).toHaveBeenCalledWith('fan');
    expect(highlightedTools(panel)).toEqual(['fan']);
    expect(toolButton(panel, 'grab').getAttribute('aria-pressed')).toBe('false');

    for (const tool of ['pin', 'jelly']) {
      clickTool(panel, tool);
      expect(opts.onToolChange).toHaveBeenLastCalledWith(tool);
      expect(highlightedTools(panel)).toEqual([tool]);
    }
  });

  it('initial.activeTool 決定一開始的高亮與參數卡', () => {
    const panel = new ControlPanel(
      makeOptions({ initial: { ...makeOptions().initial, activeTool: 'fan' } }),
    );
    expect(highlightedTools(panel)).toEqual(['fan']);
    expect(
      visibleCards(panel).map((el) => el.querySelector('.jelly-tool-params-title')!.textContent),
    ).toEqual(['電風扇']);
  });

  it('setActiveTool 只動高亮與參數卡，不回呼', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    panel.setActiveTool('pin');
    expect(highlightedTools(panel)).toEqual(['pin']);
    expect(visibleCards(panel)[0]!.textContent).toContain('Pin 筆刷半徑');
    expect(opts.onToolChange).not.toHaveBeenCalled();
  });

  it('播放中、錄製中工具列按鈕照常可按——Jelly 工具的限制改在右鍵選單各項變灰（issue #124）', () => {
    const panel = new ControlPanel(makeOptions());
    const disabled = () =>
      ([...panel.element.querySelectorAll('.jelly-toolbar button')] as HTMLButtonElement[])
        .filter((b) => b.disabled)
        .map((b) => b.dataset.tool);
    panel.setPlaybackControlsEnabled(false);
    expect(disabled()).toEqual([]);
    panel.setPlaybackControlsEnabled(true);
    panel.setRecordingActive(true);
    expect(disabled()).toEqual([]);
  });
});

describe('ControlPanel — 參數卡隨目前工具切換（issue #122）', () => {
  const cardTitles = (panel: ControlPanel) =>
    visibleCards(panel).map((el) => el.querySelector('.jelly-tool-params-title')!.textContent);

  it('任一時刻只有一組參數卡顯示，跟著目前工具換', () => {
    const panel = new ControlPanel(makeOptions());
    expect(cardTitles(panel)).toEqual(['抓取']);
    clickTool(panel, 'fan');
    expect(cardTitles(panel)).toEqual(['電風扇']);
    clickTool(panel, 'pin');
    expect(cardTitles(panel)).toEqual(['Pin']);
    clickTool(panel, 'jelly');
    expect(cardTitles(panel)).toEqual(['Jelly']);
    clickTool(panel, 'grab');
    expect(cardTitles(panel)).toEqual(['抓取']);
  });

  it('Jelly 的參數卡只有一行操作說明，沒有模式鈕與控制項（issue #124）', () => {
    const panel = new ControlPanel(makeOptions());
    clickTool(panel, 'jelly');
    const card = visibleCards(panel)[0]!;
    expect(card.querySelector('.jelly-mode-row')).toBeNull();
    expect(card.querySelectorAll('input, button, select')).toHaveLength(0);
    const text = card.textContent!;
    expect(text).toContain('左鍵生成');
    expect(text).toContain('右鍵點果凍：重建／移除');
  });

  it('抓取的參數卡：模式鈕、大把抓取半徑、顯示大把抓取範圍、顯示編隊抓取提示、設定形狀按鈕', () => {
    const panel = new ControlPanel(makeOptions());
    const card = visibleCards(panel)[0]!;
    expect(card.querySelector('.jelly-mode-row')).not.toBeNull();
    const text = card.textContent!;
    for (const part of ['大把抓取半徑', '顯示大把抓取範圍', '顯示編隊抓取提示', '開始設定形狀']) {
      expect(text).toContain(part);
    }
    // 順序照 spec #121「側欄」：模式鈕最上方。
    expect(card.children[1]!.classList.contains('jelly-mode-row')).toBe(true);
  });

  it('電風扇的參數卡內容跟原本相同：兩個顯示開關、四條拉霸、移除風扇', () => {
    const panel = new ControlPanel(makeOptions());
    clickTool(panel, 'fan');
    const text = visibleCards(panel)[0]!.textContent!;
    for (const part of [
      '顯示風扇範圍',
      '顯示風扇圖示',
      '風扇寬度',
      '風扇強度',
      '風扇衰減程度',
      '風扇頻率',
      '移除風扇',
    ]) {
      expect(text).toContain(part);
    }
  });
});

describe('ControlPanel — 抓取工具的模式鈕（issue #122）', () => {
  it('三顆模式鈕：單點／大把／編隊，initial.toolModes 決定一開始的高亮', () => {
    const panel = new ControlPanel(
      makeOptions({
        initial: { ...makeOptions().initial, toolModes: { grab: 'handful', pin: 'place' } },
      }),
    );
    const buttons = [
      ...panel.element.querySelectorAll('.jelly-mode-row[data-tool="grab"] button'),
    ] as HTMLButtonElement[];
    expect(buttons.map((b) => [b.dataset.mode, b.textContent])).toEqual([
      ['single', '單點'],
      ['handful', '大把'],
      ['formation', '編隊'],
    ]);
    expect(highlightedModes(panel)).toEqual(['handful']);
  });

  it('點模式鈕 → 高亮切過去、回呼 onModeChange(工具, 模式)', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    expect(highlightedModes(panel)).toEqual(['single']);
    modeButton(panel, 'formation').click();
    expect(opts.onModeChange).toHaveBeenCalledWith('grab', 'formation');
    expect(highlightedModes(panel)).toEqual(['formation']);
    expect(modeButton(panel, 'formation').getAttribute('aria-pressed')).toBe('true');
  });

  it('setToolMode（中鍵輪替從外面灌回來）→ 高亮同步、不回呼', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    panel.setToolMode('grab', 'handful');
    expect(highlightedModes(panel)).toEqual(['handful']);
    expect(opts.onModeChange).not.toHaveBeenCalled();
  });

  it('切走再切回抓取，模式鈕的高亮保留', () => {
    const panel = new ControlPanel(makeOptions());
    modeButton(panel, 'handful').click();
    clickTool(panel, 'fan');
    clickTool(panel, 'grab');
    expect(highlightedModes(panel)).toEqual(['handful']);
  });
});

describe('ControlPanel — 顯示游標標籤開關（issue #122）', () => {
  function cursorLabelCheckbox(panel: ControlPanel): HTMLInputElement {
    const label = [...panel.element.querySelectorAll('label')].find((l) =>
      l.textContent?.includes('顯示游標標籤'),
    );
    expect(label).toBeDefined();
    return label!.querySelector('input[type=checkbox]') as HTMLInputElement;
  }

  it('初始值來自 initial.showCursorLabel，切換觸發 onShowCursorLabelChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const checkbox = cursorLabelCheckbox(panel);
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(opts.onShowCursorLabelChange).toHaveBeenCalledWith(false);
  });

  it('跟顯示類開關放在一起，不在工具參數卡裡；播放／錄製中也不鎖', () => {
    const panel = new ControlPanel(makeOptions());
    const checkbox = cursorLabelCheckbox(panel);
    expect(checkbox.closest('.jelly-tool-section')).toBeNull();
    panel.setPlaybackControlsEnabled(false);
    panel.setRecordingActive(true);
    expect(checkbox.disabled).toBe(false);
  });
});

describe('ControlPanel — Pin 工具取代「Pin 模式」勾選框（issue #115；ADR-0015）', () => {
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

  it('工具列有「Pin」按鈕，按下 → onToolChange 收到 "pin"', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    clickTool(panel, 'pin');
    expect(opts.onToolChange).toHaveBeenCalledWith('pin');
  });

  it('「清除所有 Pin」不受目前工具影響（切到電風扇仍可用）', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    clickTool(panel, 'fan');

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

describe('ControlPanel — 編隊抓取控制項（issue #68；issue #122 併進抓取工具的參數卡）', () => {
  function grabParams(panel: ControlPanel): HTMLElement {
    return [...panel.element.querySelectorAll('.jelly-tool-params')].find((el) =>
      el.textContent?.includes('顯示編隊抓取提示'),
    ) as HTMLElement;
  }

  function defineButton(panel: ControlPanel): HTMLButtonElement {
    return [...grabParams(panel).querySelectorAll('button')].find((b) =>
      b.textContent?.includes('設定'),
    ) as HTMLButtonElement;
  }

  it('編隊的設定在抓取工具的參數卡裡，預設工具就看得到', () => {
    const panel = new ControlPanel(makeOptions());
    expect(grabParams(panel).hidden).toBe(false);
    expect(defineButton(panel)).toBeDefined();
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

describe('ControlPanel — Pin 工具（issue #123 / V4 T2）', () => {
  function pinCard(panel: ControlPanel): HTMLElement {
    return [...panel.element.querySelectorAll('.jelly-tool-params')].find(
      (el) => el.querySelector('.jelly-tool-params-title')!.textContent === 'Pin',
    ) as HTMLElement;
  }

  it('工具列上不再有撒 Pin、移除 Pin', () => {
    const panel = new ControlPanel(makeOptions());
    const tools = [...panel.element.querySelectorAll('.jelly-toolbar button')].map(
      (b) => (b as HTMLButtonElement).dataset.tool,
    );
    expect(tools).not.toContain('spray');
    expect(tools).not.toContain('erase');
    const text = panel.element.querySelector('.jelly-toolbar')!.textContent!;
    expect(text).not.toContain('撒 Pin');
    expect(text).not.toContain('移除 Pin');
  });

  it('切到 Pin → 參數卡：模式鈕（最上方）、Pin 筆刷半徑、撒 Pin 間距；沒有舊的兩條半徑', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    expect(pinCard(panel).hidden).toBe(true);
    clickTool(panel, 'pin');
    expect(opts.onToolChange).toHaveBeenCalledWith('pin');
    const card = pinCard(panel);
    expect(card.hidden).toBe(false);
    expect(card.children[1]!.classList.contains('jelly-mode-row')).toBe(true);
    const text = card.textContent!;
    expect(text).toContain('Pin 筆刷半徑');
    expect(text).toContain('撒 Pin 間距');
    expect(panel.element.textContent).not.toContain('撒 Pin 範圍半徑');
    expect(panel.element.textContent).not.toContain('移除 Pin 範圍半徑');
  });

  it('模式鈕：放／拔，initial.toolModes.pin 決定高亮；點了回呼 onModeChange("pin", 模式)', () => {
    const opts = makeOptions({
      initial: { ...makeOptions().initial, toolModes: { grab: 'single', pin: 'remove' } },
    });
    const panel = new ControlPanel(opts);
    const buttons = [
      ...panel.element.querySelectorAll('.jelly-mode-row[data-tool="pin"] button'),
    ] as HTMLButtonElement[];
    expect(buttons.map((b) => [b.dataset.mode, b.textContent])).toEqual([
      ['place', '放'],
      ['remove', '拔'],
    ]);
    expect(highlightedModes(panel, 'pin')).toEqual(['remove']);
    modeButton(panel, 'place').click();
    expect(opts.onModeChange).toHaveBeenCalledWith('pin', 'place');
    expect(highlightedModes(panel, 'pin')).toEqual(['place']);
    // 抓取工具的模式鈕不受影響。
    expect(highlightedModes(panel, 'grab')).toEqual(['single']);
  });

  it('setToolMode("pin", …)（中鍵輪替灌回來）→ 高亮同步、不回呼', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    panel.setToolMode('pin', 'remove');
    expect(highlightedModes(panel, 'pin')).toEqual(['remove']);
    expect(opts.onModeChange).not.toHaveBeenCalled();
  });

  it('「Pin 筆刷半徑」拉霸：20–400、step 10，初始值來自 initial.pinBrushRadius，拖動觸發回呼', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, 'Pin 筆刷半徑');
    expect([input.min, input.max, input.step]).toEqual(['20', '400', '10']);
    expect(Number(input.value)).toBe(120);
    input.value = '300';
    input.dispatchEvent(new Event('input'));
    expect(opts.onPinBrushRadiusChange).toHaveBeenCalledWith(300);
  });

  it('「撒 Pin 間距」拉霸初始值來自 initial.spraySpacing，拖動觸發 onSpraySpacingChange', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const input = findRangeInputByLabel(panel, '撒 Pin 間距');
    expect(Number(input.value)).toBe(opts.initial.spraySpacing);
    input.value = '20';
    input.dispatchEvent(new Event('input'));
    expect(opts.onSpraySpacingChange).toHaveBeenCalledWith(20);
    expect(opts.onPinBrushRadiusChange).not.toHaveBeenCalled();
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

describe('ControlPanel — 大把抓取控制項（issue #113；issue #122 併進抓取工具的參數卡）', () => {
  function handfulParams(panel: ControlPanel): HTMLElement {
    return [...panel.element.querySelectorAll('.jelly-tool-params')].find((el) =>
      el.textContent?.includes('大把抓取半徑'),
    ) as HTMLElement;
  }

  it('大把抓取半徑在抓取工具的參數卡裡；切到別的工具就收起來', () => {
    const panel = new ControlPanel(makeOptions());
    expect(handfulParams(panel).hidden).toBe(false);
    expect(handfulParams(panel).querySelector('.jelly-tool-params-title')!.textContent).toBe(
      '抓取',
    );
    clickTool(panel, 'fan');
    expect(handfulParams(panel).hidden).toBe(true);
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
    expect(opts.onPinBrushRadiusChange).not.toHaveBeenCalled();
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

describe('ControlPanel — 右鍵＋滾輪調數值的拉霸同步（issue #114；issue #122 推廣）', () => {
  it('setModeValue 只動對應數值的拉霸，不觸發 onChange 回呼', () => {
    const opts = makeOptions();
    const panel = new ControlPanel(opts);
    const pinBrush = findRangeInputByLabel(panel, 'Pin 筆刷半徑');
    const handful = findRangeInputByLabel(panel, '大把抓取半徑');
    const before = handful.value;

    panel.setModeValue('pinBrushRadius', 230);
    expect([pinBrush.value, handful.value]).toEqual(['230', before]);
    panel.setModeValue('handfulRadius', 310);
    expect([pinBrush.value, handful.value]).toEqual(['230', '310']);

    expect(opts.onPinBrushRadiusChange).not.toHaveBeenCalled();
    expect(opts.onHandfulRadiusChange).not.toHaveBeenCalled();
  });
});
