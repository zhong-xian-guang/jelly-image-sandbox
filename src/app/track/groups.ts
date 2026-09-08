/**
 * Track 群組（issue #43 / V2 T1-8，見 ADR-0008、CONTEXT.md「群組」詞條）——把已錄
 * Track 分組的具名容器，用途是逐一比較各群組單獨播放的效果。
 *
 * 這裡只放**純函式**：開啟中群組的成員聯集、「每條 Track 至少在一個群組」不變式、
 * 獨奏切換的狀態轉移。群組清單／歸屬本身存在 `JellySandbox` 記憶體（比照 `tracks`
 * 清單，`停止／重設` 保留、重新匯入 PNG 清空），UI 在 `ControlPanel`，接線在
 * `JellySandbox`——跟 `softness`／`walledBounds`／`overlay` 一樣的分工。
 *
 * 難邏輯不進 `mergeTracks`（ADR-0008）：群組歸屬只是「扁平 Track 清單」上的一個
 * 過濾條件，`playAll` 呼叫 `mergeTracks` 前先用 `tracksInEnabledGroups` 濾掉不屬於
 * 任何開啟中群組的 Track，輸入順序不變（決定性、`mergeTracks` 的「先列」語意不受
 * 影響）。
 */

/** 一個 Track 分組容器：可編輯名稱 + 開啟／關閉狀態。 */
export interface TrackGroup {
  id: string;
  name: string;
  enabled: boolean;
}

/** 預設群組的 id——永遠存在、預設開啟、不可刪除；新錄好的 Track 自動加入。 */
export const DEFAULT_GROUP_ID = 'default';
/** 預設群組顯示名稱。 */
const DEFAULT_GROUP_NAME = '預設';

/** 一份新的預設群組（`JellySandbox` 初始化與重新匯入 PNG 後重建 Track 群組時用）。 */
export function createDefaultGroup(): TrackGroup {
  return { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, enabled: true };
}

/**
 * 開啟中群組的成員 Track 聯集（issue #43）——回傳 `tracks` 中「至少屬於一個 enabled
 * 群組」的子集，**保留傳入順序**（`mergeTracks` 的「先列」＝相機軌認先列，靠這個
 * 順序）。一條 Track 同屬多個開啟中群組只會出現一次（`filter` 天然去重）。開啟中
 * 群組為空、或開啟中群組沒有任何成員時回空陣列（呼叫端據此把「▶ 播放」變灰）。
 */
export function tracksInEnabledGroups<T extends { groupIds: ReadonlySet<string> }>(
  tracks: readonly T[],
  groups: readonly TrackGroup[],
): T[] {
  const enabled = new Set(groups.filter((g) => g.enabled).map((g) => g.id));
  return tracks.filter((track) => {
    for (const id of track.groupIds) if (enabled.has(id)) return true;
    return false;
  });
}

/**
 * 套用「每條 Track 永遠至少在一個群組」不變式（issue #43）：丟掉指向已不存在群組的
 * id（例如該群組被刪了）；結果為空時退回預設群組。使用者在 `群組 ▾` 取消勾選最後
 * 一個群組、或刪除某群組導致成員掉到 0 群組時，都靠這個補回預設群組。
 */
export function withGroupInvariant(
  groupIds: Iterable<string>,
  groups: readonly TrackGroup[],
): Set<string> {
  const live = new Set(groups.map((g) => g.id));
  const next = new Set<string>();
  for (const id of groupIds) if (live.has(id)) next.add(id);
  if (next.size === 0) next.add(DEFAULT_GROUP_ID);
  return next;
}

/** 獨奏狀態：正在獨奏哪個群組，以及進入獨奏前的各群組開關狀態（供「再按還原」）。 */
export interface SoloState {
  soloId: string;
  saved: ReadonlyMap<string, boolean>;
}

/**
 * 獨奏切換（issue #43）——回傳套用後的群組陣列（全新物件）＋新的獨奏狀態：
 *
 * - 對**正在獨奏**的群組再按一次 → 依 `saved` 還原各群組開關、獨奏狀態清成 `null`。
 * - 對**別的**群組按 → 只有它開、其餘關；`saved` 沿用第一次進入獨奏時記下的那份
 *   （連續切換不同群組的獨奏對象時，「原始」開關狀態不會被中途的獨奏狀態污染）。
 * - 沒在獨奏時按 → 記下當下開關狀態當 `saved`，再只留該群組開。
 *
 * 純函式；呼叫端（`JellySandbox`）另外在使用者「手動」動過任一群組開關、或新增／
 * 刪除群組時，自行把獨奏狀態清成 `null`（還原點作廢）。
 */
export function toggleSolo(
  groups: readonly TrackGroup[],
  solo: SoloState | null,
  groupId: string,
): { groups: TrackGroup[]; solo: SoloState | null } {
  if (solo && solo.soloId === groupId) {
    return {
      groups: groups.map((g) => ({ ...g, enabled: solo.saved.get(g.id) ?? g.enabled })),
      solo: null,
    };
  }
  const saved = solo ? solo.saved : new Map(groups.map((g) => [g.id, g.enabled]));
  return {
    groups: groups.map((g) => ({ ...g, enabled: g.id === groupId })),
    solo: { soloId: groupId, saved },
  };
}
