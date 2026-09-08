import { describe, expect, it } from 'vitest';

import {
  createDefaultGroup,
  DEFAULT_GROUP_ID,
  type SoloState,
  type TrackGroup,
  toggleSolo,
  tracksInEnabledGroups,
  withGroupInvariant,
} from './groups';

/** 一條只帶「群組歸屬」的最小 Track（`tracksInEnabledGroups` 只看 `groupIds`）。 */
function track(id: string, ...groupIds: string[]): { id: string; groupIds: ReadonlySet<string> } {
  return { id, groupIds: new Set(groupIds) };
}

function group(id: string, enabled: boolean, name = id): TrackGroup {
  return { id, name, enabled };
}

describe('createDefaultGroup', () => {
  it('id = default、預設開啟', () => {
    expect(createDefaultGroup()).toEqual({ id: DEFAULT_GROUP_ID, name: '預設', enabled: true });
  });
});

describe('tracksInEnabledGroups', () => {
  it('只回傳至少屬於一個開啟中群組的 Track，並保留傳入順序', () => {
    const groups = [group('default', true), group('g1', false), group('g2', true)];
    const tracks = [
      track('t1', 'g1'), // 只在關閉的 g1 → 不播
      track('t2', 'default'), // 在開啟的 default → 播
      track('t3', 'g1', 'g2'), // 也在開啟的 g2 → 播
    ];
    expect(tracksInEnabledGroups(tracks, groups).map((t) => t.id)).toEqual(['t2', 't3']);
  });

  it('一條 Track 同屬多個開啟中群組只出現一次（多對多去重）', () => {
    const groups = [group('g1', true), group('g2', true)];
    const tracks = [track('t1', 'g1', 'g2')];
    expect(tracksInEnabledGroups(tracks, groups).map((t) => t.id)).toEqual(['t1']);
  });

  it('所有群組都關 → 空聯集', () => {
    const groups = [group('default', false), group('g1', false)];
    expect(tracksInEnabledGroups([track('t1', 'default', 'g1')], groups)).toEqual([]);
  });

  it('開啟中群組存在、但沒有任何 Track 屬於它 → 空聯集', () => {
    const groups = [group('default', false), group('g1', true)];
    // 兩條 Track 都只在關閉的 default，開啟的 g1 沒有成員。
    expect(tracksInEnabledGroups([track('t1', 'default'), track('t2', 'default')], groups)).toEqual(
      [],
    );
  });

  it('沒有任何 Track → 空聯集', () => {
    expect(tracksInEnabledGroups([], [group('default', true)])).toEqual([]);
  });
});

describe('withGroupInvariant', () => {
  it('丟掉指向已不存在群組的 id', () => {
    const groups = [group('default', true), group('g1', true)];
    expect([...withGroupInvariant(['g1', 'ghost'], groups)]).toEqual(['g1']);
  });

  it('結果為空 → 退回預設群組', () => {
    const groups = [group('default', true), group('g1', true)];
    expect([...withGroupInvariant(['ghost'], groups)]).toEqual([DEFAULT_GROUP_ID]);
    expect([...withGroupInvariant([], groups)]).toEqual([DEFAULT_GROUP_ID]);
  });

  it('全部有效 → 原樣保留', () => {
    const groups = [group('default', true), group('g1', true), group('g2', true)];
    expect([...withGroupInvariant(['default', 'g2'], groups)].sort()).toEqual(['default', 'g2']);
  });
});

describe('toggleSolo', () => {
  const base = () => [group('default', true), group('g1', true), group('g2', false)];

  it('沒在獨奏時對某群組按 → 只留它開、其餘關，並記下原始開關狀態', () => {
    const { groups, solo } = toggleSolo(base(), null, 'g1');
    expect(groups.map((g) => [g.id, g.enabled])).toEqual([
      ['default', false],
      ['g1', true],
      ['g2', false],
    ]);
    expect(solo?.soloId).toBe('g1');
    expect([...(solo?.saved ?? [])].sort()).toEqual([
      ['default', true],
      ['g1', true],
      ['g2', false],
    ]);
  });

  it('對正在獨奏的群組再按一次 → 還原原始開關狀態、獨奏清空', () => {
    const first = toggleSolo(base(), null, 'g1');
    const second = toggleSolo(first.groups, first.solo, 'g1');
    expect(second.groups.map((g) => [g.id, g.enabled])).toEqual([
      ['default', true],
      ['g1', true],
      ['g2', false],
    ]);
    expect(second.solo).toBeNull();
  });

  it('獨奏中改按另一個群組 → 換獨奏對象，但「原始」開關狀態不被中途獨奏狀態污染', () => {
    const first = toggleSolo(base(), null, 'g1');
    const switched = toggleSolo(first.groups, first.solo, 'g2');
    expect(switched.groups.map((g) => [g.id, g.enabled])).toEqual([
      ['default', false],
      ['g1', false],
      ['g2', true],
    ]);
    // 再按 g2 還原 → 回到最初的 base()，不是 g1 獨奏後的狀態
    const restored = toggleSolo(switched.groups, switched.solo, 'g2');
    expect(restored.groups.map((g) => [g.id, g.enabled])).toEqual([
      ['default', true],
      ['g1', true],
      ['g2', false],
    ]);
    expect(restored.solo).toBeNull();
  });

  it('不改動傳入的群組陣列（回傳全新物件）', () => {
    const input = base();
    const snapshot = input.map((g) => ({ ...g }));
    toggleSolo(input, null, 'g1');
    expect(input).toEqual(snapshot);
  });

  it('saved 是唯讀快照，還原時用它覆蓋當下狀態', () => {
    const solo: SoloState = {
      soloId: 'g1',
      saved: new Map([
        ['default', true],
        ['g1', true],
        ['g2', false],
      ]),
    };
    const groups = [group('default', false), group('g1', true), group('g2', false)];
    const { groups: restored, solo: cleared } = toggleSolo(groups, solo, 'g1');
    expect(restored.map((g) => [g.id, g.enabled])).toEqual([
      ['default', true],
      ['g1', true],
      ['g2', false],
    ]);
    expect(cleared).toBeNull();
  });
});
