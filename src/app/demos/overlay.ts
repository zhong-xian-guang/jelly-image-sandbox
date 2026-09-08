/**
 * Track 疊加播放（issue #33 / V2 T1-1，issue #36 / V2 T1-4 加相機軌，見
 * CONTEXT.md「Overlay」詞條、ADR-0007）——把「多條 Action Track ＋ 多條 Camera
 * Track ＋ 各自的起始 step 與頭尾修剪」壓成**一條**全域時間軸，交給既有的
 * `DemoRunner` 精準重播。
 *
 * 這裡刻意只認 `DemoStep[]`（時間軸），不認 `TrackRecorder`（錄製層）——疊起來的
 * 是時間軸，「這串 step 來自使用者錄的 Track」是呼叫端（`JellySandbox`）的框架。
 * 放在 `demos/` 而非 `track/`，讓 `demos/` 維持自足的低層時間軸執行層、`track/`
 * 疊在其上。
 *
 * 動作軌與相機軌共用同一套修剪／平移邏輯（相機指令沒有 `id`，前綴與 Grab 補洞
 * 對它是 no-op）；相機軌再多兩件事：
 *
 * 1. **頭尾修剪**（issue #35 / V2 T1-3）：只保留 `atStep` 落在 `[inStep, outStep]`
 *    之間的排程項，其餘丟掉；保留下來的 `atStep` 先減去 `inStep`（修掉的開頭不留
 *    空白），再照第 2 點平移。`inStep` 預設 0、`outStep` 預設無限大（不修）。
 *    `inStep > outStep`（範圍為空）時這條不貢獻任何事件（防呆，不丟例外）。橫跨
 *    修剪點的 Grab 另外補（見 `mergeTracks` 說明）：進場點重建 `grab`＋`moveGrab`、
 *    出場點補 `release`，讓播出來的抓取不會斷、也不會黏著不放。
 * 2. **平移**：每條 Track 的事件（修剪後）`atStep` 加上該 Track 的 `startStep`，
 *    落到共同的全域 step 軸上。多條 Action Track 在時間軸上可自由重疊——那正是
 *    疊出 Multi-grab 的用途。
 * 3. **id 重新映射**：每條 Track 內部用到的 `PointerId`（grab／moveGrab／
 *    release／pin／unpin／movePin 的 `id`）一律加上該 Track 專屬的 `idPrefix`。
 *    同一條 Track 內引用同一個原始 id 的事件套同一個前綴 → 條內關聯保住；不同
 *    Track 前綴不同 → 跨 Track 不再碰撞（否則 TrackA 的 `release` 會誤中 TrackB
 *    的 Grab，疊加就不是真正的同時多點抓取）。`tap` 與相機指令沒有 `id`，原樣通過。
 * 4. **相機軌硬切**（issue #36）：帶 `startCamera` 的 Track 視為相機軌——在它的
 *    （修剪、重錨後）起始 step 插一個 `setState` 絕對相機指令，把鏡頭瞬間設回
 *    錄製當下的快照，之後才放它自己的 `panBy`／`zoomBy`。這樣不管播放前鏡頭在
 *    哪、前一條相機軌把鏡頭帶到哪，重播出來的運鏡起點永遠一致。
 * 5. **相機軌不重疊（認先列）**（issue #36）：相機軌之間在全域時間軸上若有重疊，
 *    重疊區間只認**先列**那條——後列相機軌落在先列相機軌作用區間（起始 step ～
 *    修剪後最後一筆的 step）內的排程項（含硬切）一律丟掉。動作軌不受此限。
 *
 * 疊起來後依全域 `atStep` 穩定排序：同一個 step 上，先列的 Track 事件排在前、
 * 條內原順序保留（進場點重建的 `grab`／`moveGrab` 排在同條該 step 的存活事件之前、
 * 出場點補的 `release` 排在之後）—— 每次疊加結果逐格一致（issue #33 驗收條件：決定性）。
 *
 * 假設 `steps` 依 `atStep` 升冪（`TrackRecorder` 逐格 push、`scripts.ts` 亦然）；
 * 橫跨修剪點 Grab 的補洞、相機軌作用區間都靠這個順序判斷。
 */

import type { CameraState } from '../../camera';
import type { PointerId } from '../../sim';

import type { DemoEvent, DemoStep } from './types';

/** 疊加播放的一條輸入：一段相對自己起點的時間軸 + 它在全域軸上的起始 step + 專屬 id 前綴。 */
export interface OverlayTrack {
  /** 這條 Track 在全域時間軸上從第幾個固定 sim step 開始生效。 */
  startStep: number;
  /** 加在這條 Track 所有 `PointerId` 前面的前綴，需在各條之間唯一（例如 `` `t1/` ``）。 */
  idPrefix: string;
  /** 錄好的時間軸，`atStep` 相對這條 Track 自己的起點。 */
  steps: readonly DemoStep[];
  /** 頭修剪：本地時間中 `atStep < inStep` 的排程項不播。預設 0（不修頭）。 */
  inStep?: number;
  /** 尾修剪：本地時間中 `atStep > outStep` 的排程項不播。預設無限大（不修尾）。 */
  outStep?: number;
  /**
   * 帶這個欄位即視為**相機軌**（issue #36）：錄製起點的鏡頭快照。`mergeTracks`
   * 會在這條的（重錨後）起始 step 插一個 `setState` 絕對相機指令硬切進場，並讓
   * 這條相機軌在全域時間軸上「佔用」它的作用區間，後列的相機軌不得重疊。
   */
  startCamera?: CameraState;
}

/** 把 `event` 的 `PointerId`（若有）加上 `prefix`；`tap`／相機指令沒有 `id`，原樣回傳。 */
function withPrefixedId(event: DemoEvent, prefix: string): DemoEvent {
  return 'id' in event ? { ...event, id: `${prefix}${String(event.id)}` } : event;
}

/** 一個世界座標點。 */
interface XY {
  x: number;
  y: number;
}

/**
 * 掃過 `steps` 中 `keep(atStep)` 為真的排程項，回傳每個指標 id 此刻「還沒放開的
 * Grab」——`origin` 是原始 `grab` 的挑選座標（picking 靠它命中 rest 形狀上正確的
 * 材質點）、`target` 是最後一次 `grab`／`moveGrab` 的目標座標。`release`／`pin`
 *（轉成 Pin，不再是可重建的 Grab）／`unpin` 清掉。Pin 本身橫跨修剪點的重建不在
 * issue #35 範圍。
 */
function openGrabs(
  steps: readonly DemoStep[],
  keep: (atStep: number) => boolean,
): Map<PointerId, { origin: XY; target: XY }> {
  const open = new Map<PointerId, { origin: XY; target: XY }>();
  for (const { atStep, event } of steps) {
    if (!keep(atStep)) continue;
    switch (event.type) {
      case 'grab':
        open.set(event.id, { origin: { x: event.x, y: event.y }, target: { x: event.x, y: event.y } });
        break;
      case 'moveGrab': {
        const g = open.get(event.id);
        if (g) g.target = { x: event.x, y: event.y };
        break;
      }
      case 'release':
      case 'pin':
      case 'unpin':
        open.delete(event.id);
        break;
      default:
        break;
    }
  }
  return open;
}

/**
 * 把多條 `OverlayTrack` 壓成一條全域時間軸：各自套頭尾修剪、平移 `atStep`、重新
 * 映射 `id`，再依全域 `atStep` 穩定升冪排序。不改動傳入的物件（各層都是新的）。
 * 名稱沿用 ADR-0007 / issue #33 spec 指定的 `mergeTracks`。
 *
 * 頭尾修剪造成的 Grab 缺口靠兩處補：**進場點**（`inStep > 0`）仍開著的 Grab 用
 * 原始挑選座標重建一個 `grab`（命中正確的材質點——播放前會 `sim.reset()`，若改用
 * 被拖走後的目標座標 picking 會抓到 rest 形狀上另一個點），緊接同一 step 再補一個
 * `moveGrab` 把目標拉回進場當下的位置，接得上後續錄下的 `moveGrab`；**出場點**
 *（`outStep` 真的截掉了尾段時）仍開著的 Grab 補一個 `release`，否則被截掉 `release`
 * 的那條抓取會在播放結束後仍黏著果凍（「尾段不播」就不成立）。
 */
export function mergeTracks(tracks: readonly OverlayTrack[]): DemoStep[] {
  const overlaid: DemoStep[] = [];
  /** 先列相機軌已「佔用」的全域區間 `[起始 step, 作用結束 step]`（issue #36：認先列）。 */
  const claimedCameraRanges: Array<[number, number]> = [];

  for (const track of tracks) {
    const inStep = track.inStep ?? 0;
    const outStep = track.outStep ?? Number.POSITIVE_INFINITY;
    if (inStep > outStep) continue; // 修剪範圍為空 → 這條不貢獻任何事件（防呆）

    const isCamera = track.startCamera !== undefined;
    /** 相機軌：落在先列相機軌作用區間內的排程項一律丟掉（重疊區間只認先列那條）。 */
    const claimedByEarlierCamera = (globalStep: number): boolean =>
      isCamera && claimedCameraRanges.some(([lo, hi]) => globalStep >= lo && globalStep <= hi);

    const push = (atStep: number, event: DemoEvent): void => {
      if (claimedByEarlierCamera(atStep)) return;
      overlaid.push({ atStep, event: withPrefixedId(event, track.idPrefix) });
    };

    // 相機軌硬切（issue #36）：在（重錨後）起始 step 把鏡頭瞬間設回錄製起點快照，
    // 排在這條該 step 其餘事件之前。
    if (isCamera) {
      push(track.startStep, { type: 'setState', state: track.startCamera! });
    }

    // 進場點（本地 inStep → 全域 startStep）重建橫跨的 Grab，排在存活事件之前。
    // 相機軌沒有 Grab，`openGrabs` 回空 Map，這段自然略過。
    if (inStep > 0) {
      for (const [id, g] of openGrabs(track.steps, (s) => s < inStep)) {
        push(track.startStep, { type: 'grab', id, x: g.origin.x, y: g.origin.y });
        if (g.target.x !== g.origin.x || g.target.y !== g.origin.y) {
          push(track.startStep, { type: 'moveGrab', id, x: g.target.x, y: g.target.y });
        }
      }
    }

    /** 這條在全域軸上跑到的最後一個 step——相機軌用它算作用區間的結束。 */
    let lastGlobalStep = track.startStep;
    for (const step of track.steps) {
      if (step.atStep < inStep || step.atStep > outStep) continue;
      const globalStep = track.startStep + (step.atStep - inStep);
      lastGlobalStep = Math.max(lastGlobalStep, globalStep);
      push(globalStep, step.event);
    }

    // 出場點（本地 outStep → 全域 startStep + outStep − inStep）補放開仍開著的 Grab，
    // 排在該 step 存活事件之後；只在尾段真的被截掉時才補。
    if (Number.isFinite(outStep) && track.steps.some((s) => s.atStep > outStep)) {
      for (const id of openGrabs(track.steps, (s) => s <= outStep).keys()) {
        push(track.startStep + (outStep - inStep), { type: 'release', id });
      }
    }

    // 這條相機軌佔用它的作用區間；後列相機軌落在裡面的排程項會被丟掉。
    // 依 tracks 陣列順序 push，所以「先列」＝陣列在前。
    if (isCamera) {
      claimedCameraRanges.push([track.startStep, lastGlobalStep]);
    }
  }
  // Array.prototype.sort 自 ES2019 起穩定：同 atStep 維持推入順序（先列的 Track 在前、條內原順序保留）。
  return overlaid.sort((a, b) => a.atStep - b.atStep);
}
