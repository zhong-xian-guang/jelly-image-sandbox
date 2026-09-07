/**
 * Action Track 疊加播放（issue #33 / V2 T1-1，見 CONTEXT.md「Overlay」詞條、
 * ADR-0007）——把「多條各自單指標錄下的 Action Track ＋ 各自的起始 step」壓成
 * **一條**全域時間軸，交給既有的 `DemoRunner` 精準重播。
 *
 * 這裡刻意只認 `DemoStep[]`（時間軸），不認 `TrackRecorder`（錄製層）——合併的
 * 是時間軸，「這串 step 來自使用者錄的 Track」是呼叫端（`JellySandbox`）的框架。
 * 放在 `demos/` 而非 `track/`，讓 `demos/` 維持自足的低層時間軸執行層、`track/`
 * 疊在其上。
 *
 * 兩件事：
 *
 * 1. **平移**：每條 Track 的事件 `atStep` 加上該 Track 的 `startStep`，落到共同
 *    的全域 step 軸上。多條 Action Track 在時間軸上可自由重疊——那正是疊出
 *    Multi-grab 的用途。
 * 2. **id 重新映射**：每條 Track 內部用到的 `PointerId`（grab／moveGrab／
 *    release／pin／unpin／movePin 的 `id`）一律加上該 Track 專屬的 `idPrefix`。
 *    同一條 Track 內引用同一個原始 id 的事件套同一個前綴 → 條內關聯保住；不同
 *    Track 前綴不同 → 跨 Track 不再碰撞（否則 TrackA 的 `release` 會誤中 TrackB
 *    的 Grab，疊加就不是真正的同時多點抓取）。`tap` 與相機指令沒有 `id`，原樣通過。
 *
 * 合併後依全域 `atStep` 穩定排序：同一個 step 上，先列的 Track 事件排在前、
 * 條內原順序保留 —— 每次疊加結果逐格一致（issue #33 驗收條件：決定性）。
 */

import type { DemoEvent, DemoStep } from './types';

/** 疊加播放的一條輸入：一段相對自己起點的時間軸 + 它在全域軸上的起始 step + 專屬 id 前綴。 */
export interface OverlayTrack {
  /** 這條 Track 在全域時間軸上從第幾個固定 sim step 開始生效。 */
  startStep: number;
  /** 加在這條 Track 所有 `PointerId` 前面的前綴，需在各條之間唯一（例如 `` `t1/` ``）。 */
  idPrefix: string;
  /** 錄好的時間軸，`atStep` 相對這條 Track 自己的起點。 */
  steps: readonly DemoStep[];
}

/** 把 `event` 的 `PointerId`（若有）加上 `prefix`；`tap`／相機指令沒有 `id`，原樣回傳。 */
function withPrefixedId(event: DemoEvent, prefix: string): DemoEvent {
  return 'id' in event ? { ...event, id: `${prefix}${String(event.id)}` } : event;
}

/**
 * 把多條 `OverlayTrack` 壓成一條全域時間軸：各自平移 `atStep`、重新映射 `id`，
 * 合併後依全域 `atStep` 穩定升冪排序。不改動傳入的 step 物件。
 */
export function mergeTracks(tracks: readonly OverlayTrack[]): DemoStep[] {
  const merged: DemoStep[] = [];
  for (const track of tracks) {
    for (const step of track.steps) {
      merged.push({
        atStep: track.startStep + step.atStep,
        event: withPrefixedId(step.event, track.idPrefix),
      });
    }
  }
  // Array.prototype.sort 自 ES2019 起穩定：同 atStep 維持推入順序（先列的 Track 在前、條內原順序保留）。
  return merged.sort((a, b) => a.atStep - b.atStep);
}
