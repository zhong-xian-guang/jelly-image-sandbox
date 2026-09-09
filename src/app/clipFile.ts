/**
 * 片段存檔（Clip file）——issue #57 / V2 T2-4，見 spec #53 與 CONTEXT.md「片段」。
 *
 * `ClipState` 是 `JellySandbox` 記憶體狀態的**可序列化投影**：一塊果凍（原始影像
 * 位元組 + 格式）、匯入當下實際餵給 `buildSimMesh` 的完整解析後參數、軟硬度／輕拍
 * 力道／邊界模式、所有 Track（含自訂名、起始、頭尾修剪、分群、相機軌起點快照）、
 * 所有群組、片段初始 Pin、流水號。`JellySandbox` 負責把記憶體狀態攤成 `ClipState`
 * （`RecordedTrack.groupIds` 的 `Set` → 陣列、`customLabel ?? label` → `name`）。
 *
 * `serializeClip` 產出帶 `version: 1` 的 JSON 字串，`image.bytes` 走 base64（編碼在
 * 本模組內，用瀏覽器 `btoa`、不依賴 Node `Buffer`）。反向的 `parseClipFile` 由
 * issue #58 補完；本檔目前只有序列化端。純函式、決定性、不碰 DOM。
 */

import type { CameraState } from '../camera';
import type { BuildSimMeshParams, ImageFormat } from '../mesh';
import type { BoundaryMode } from '../sim';
import type { Track } from './track';

/**
 * 存檔格式版本。`parseClipFile`（issue #58）只認得這個值；日後改結構才 bump，
 * 舊檔載入時據此被擋下。
 */
export const CLIP_FILE_VERSION = 1;

/** 片段裡那塊果凍的來源影像。內建預設果凍存檔當下用 `canvasToPng` 拍成 `'png'`。 */
export interface ClipImage {
  format: ImageFormat;
  /** 原始影像位元組（序列化成 base64 字串）。 */
  bytes: Uint8Array;
}

/** 軟硬度滑桿值本身（0–1，非衍生的 cellFrac/alphaSm）＋輕拍力道＋邊界模式。 */
export interface ClipSim {
  softness: number;
  tapStrength: number;
  boundary: BoundaryMode;
}

/** `RecordedTrack` 去掉衍生欄位後的可序列化形狀（`groupIds` 攤成陣列）。 */
export interface ClipTrack {
  id: string;
  kind: 'action' | 'camera';
  /** 清單顯示名稱：使用者自訂名，或未改名時的自動摘要（`JellySandbox` 建 `ClipState` 時決定）。 */
  name: string;
  startStep: number;
  inStep: number;
  outStep: number;
  steps: Track;
  /** 相機軌的錄製起點鏡頭快照；動作軌為 `null`。 */
  startCamera: CameraState | null;
  groupIds: readonly string[];
}

export interface ClipGroup {
  id: string;
  name: string;
  enabled: boolean;
}

/** 片段初始 Pin 的一點——rest 形狀下的附著座標（比照 `JellySandbox.setupPins`）。 */
export interface ClipPoint {
  x: number;
  y: number;
}

export interface ClipCounters {
  nextTrackNum: number;
  nextGroupNum: number;
}

export interface ClipState {
  image: ClipImage;
  /** 匯入當下實際餵給 `buildSimMesh` 的**解析後完整**參數（含可能被效能退路砍半的 `targetParticleCount`）。 */
  meshParams: BuildSimMeshParams;
  sim: ClipSim;
  tracks: readonly ClipTrack[];
  groups: readonly ClipGroup[];
  setupPins: readonly ClipPoint[];
  counters: ClipCounters;
}

/**
 * `ClipState` → 可下載的 JSON 字串（`version: 1`，兩格縮排讓檔案可人工檢視）。
 * `ClipState` 已是純資料投影（`JellySandbox.buildClipState` 負責攤平），所以這裡
 * 只加 `version` 外包裝、把 `image.bytes` 換成 base64；其餘欄位原樣帶過。
 * `JSON.stringify` 不改動傳入的 `clip`。
 */
export function serializeClip(clip: ClipState): string {
  const doc = {
    version: CLIP_FILE_VERSION,
    ...clip,
    image: {
      format: clip.image.format,
      bytes: bytesToBase64(clip.image.bytes),
    },
  };
  return JSON.stringify(doc, null, 2);
}

/**
 * `Date` → `YYYYMMDD-HHMMSS`（本地時間）——存檔檔名的時間戳，存多個版本不互相
 * 覆蓋（issue #57 US15）。月份 `+1`、個位數補零。
 */
export function clipFileTimestamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}`;
}

/**
 * `Uint8Array` → base64。用瀏覽器 `btoa`（避免 Node `Buffer` 依賴）；分塊呼叫
 * `String.fromCharCode` 免得大圖把引數展開撐爆呼叫堆疊。
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
