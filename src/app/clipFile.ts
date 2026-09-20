/**
 * 片段存檔（Clip file）——issue #57 / V2 T2-4（序列化端）、issue #58 / V2 T2-5
 * （反序列化端），見 spec #53 與 CONTEXT.md「片段」。
 *
 * `ClipState` 是 `JellySandbox` 記憶體狀態的**可序列化投影**（issue #95 / V3 T3-2 升成
 * **v2**，ADR-0013）：來源圖庫 `sources`（`sourceId` → 原始影像位元組 + 格式，多塊共用
 * 同一張只存一份）、Scene 清單（每塊的 `jellyId`／`sourceId`／匯入當下實際餵給
 * `buildSimMesh` 的完整解析後參數／匯入尺寸／擺放 `offset`）、軟硬度／輕拍力道／邊界
 * 模式／重力、所有 Track（含自訂名、起始、頭尾修剪、分群、相機軌起點快照；動作軌裡可
 * 有帶 `sourceId` 的 `spawn` 事件）、所有群組、片段初始 Pin、四個流水號。`JellySandbox`
 * 負責把記憶體狀態攤成 `ClipState`（`RecordedTrack.groupIds` 的 `Set` → 陣列、
 * `customLabel ?? label` → `name`），或反向把 `ClipState` 灌回記憶體狀態（`applyClipState`）。
 *
 * `serializeClip` 產出帶 `version: 2` 的 JSON 字串，每張來源圖的 `bytes` 走 base64（編碼在
 * 本模組內，用瀏覽器 `btoa`、不依賴 Node `Buffer`）。`parseClipFile` 是反向：解析＋
 * 結構驗證，壞檔（非 JSON／版本不符／必要欄位缺或型別錯／Scene 或 `spawn` 事件引用
 * 不存在的 `sourceId`）丟具名的 `ClipFileError`，不做部分還原；後來才加的**可選欄位**
 * （`sim.gravity`）缺失時補預設值——呼叫端（`JellySandbox.onLoadClip`）接住後場景完全
 * 不動（比照圖片匯入失敗）。**v1 檔（V2 時期存的，頂層 `image`／`meshParams`／
 * `importSize`）照常載入**：遷移成「一塊 Jelly 的 Scene」——`sources = { 'src/1': image }`、
 * `scene = [{ 'jelly/1', 'src/1', meshParams, importSize ?? null, offset (0, 0) }]`、
 * 兩個新流水號 = 2；`offset (0, 0)` 讓網格跟 v1 一樣留在 mask 原點，Track 座標零誤差
 * 對上。寫檔永遠是 v2。兩者都是純函式、決定性、不碰 DOM。
 */

import type { CameraState } from '../camera';
import type { BuildSimMeshParams, ImageFormat } from '../mesh';
import { type BoundaryMode, BOUNDARY_MODES, type SceneEntry } from '../sim';
import type { DemoEvent, DemoStep } from './demos/types';
import type { Track } from './track';

/**
 * 存檔格式版本。`serializeClip` 永遠寫這個值；`parseClipFile` 認得它與
 * `LEGACY_CLIP_FILE_VERSION`（v1，讀入時遷移）。改結構才 bump；向後相容的新增欄位
 * （缺失時有明確預設值，如 `sim.gravity`）**不** bump。
 */
export const CLIP_FILE_VERSION = 2;
/** V2 時期（issue #57–#91）的格式：單塊果凍，`image`／`meshParams`／`importSize` 在頂層。 */
const LEGACY_CLIP_FILE_VERSION = 1;

/** 一張來源影像（`sources` 的值）。內建預設果凍在啟動時用 `canvasToPng` 拍成 `'png'` 註冊。 */
export interface ClipImage {
  format: ImageFormat;
  /** 原始影像位元組（序列化成 base64 字串）。 */
  bytes: Uint8Array;
}

/** 軟硬度滑桿值本身（0–1，非衍生的 cellFrac/alphaSm）＋輕拍力道＋邊界模式＋重力。 */
export interface ClipSim {
  softness: number;
  tapStrength: number;
  boundary: BoundaryMode;
  /**
   * 重力拉霸值（issue #91 / V3 T2-1；ADR-0012），世界單位／s²、≥ 0。加此欄位之前存的
   * 舊檔沒有它，解析時 → 0（俯視無重力，重播結果不變）；`version` 維持 1。
   */
  gravity: number;
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
  /** 下一塊 Jelly 的流水號（`jelly/<N>`，issue #95）。v1 檔遷移後 = 2。 */
  nextJellyNum: number;
  /** 下一張來源圖的流水號（`src/<N>`，issue #95）。v1 檔遷移後 = 2。 */
  nextSourceNum: number;
}

export interface ClipState {
  /**
   * 來源圖庫（issue #95）：`sourceId` → 影像。未被任何 Scene 條目或 Track 事件引用的來源
   * 仍保留（「最近匯入的圖」= 最大的 `sourceId`，切換片段後生成工具才找得到它）。
   */
  sources: Readonly<Record<string, ClipImage>>;
  /**
   * Scene（ADR-0013）：片段第 0 步就存在的每塊 Jelly——`meshParams` 是匯入當下實際餵給
   * `buildSimMesh` 的**解析後完整**參數（含可能被效能退路砍半的 `targetParticleCount`）；
   * `importSize`（issue #88）為 `null` = 未縮放（從 v1 舊檔遷移、尚未重建的塊，網格維持
   * mask 像素座標）；`offset` 是加到網格座標上的平移量。
   */
  scene: readonly SceneEntry[];
  sim: ClipSim;
  tracks: readonly ClipTrack[];
  groups: readonly ClipGroup[];
  setupPins: readonly ClipPoint[];
  counters: ClipCounters;
}

/**
 * `ClipState` → 可下載的 JSON 字串（`version: 2`，兩格縮排讓檔案可人工檢視）。
 * `ClipState` 已是純資料投影（`JellySandbox.buildClipState` 負責攤平），所以這裡
 * 只加 `version` 外包裝、把每張來源圖的 `bytes` 換成 base64；其餘欄位原樣帶過。
 * `JSON.stringify` 不改動傳入的 `clip`。
 */
export function serializeClip(clip: ClipState): string {
  const sources: Record<string, { format: ImageFormat; bytes: string }> = {};
  for (const [id, image] of Object.entries(clip.sources)) {
    sources[id] = { format: image.format, bytes: bytesToBase64(image.bytes) };
  }
  const doc = { version: CLIP_FILE_VERSION, ...clip, sources };
  return JSON.stringify(doc, null, 2);
}

/** `parseClipFile` 解析／驗證失敗時丟出——帶一句可直接顯示的說明（見各 `require*`／`parse*`）。 */
export class ClipFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipFileError';
  }
}

const KNOWN_IMAGE_FORMATS = new Set(['png', 'jpeg', 'gif']);
const MESH_PARAM_KEYS = [
  'maxMaskEdge',
  'alphaThreshold',
  'simplifyTolerance',
  'targetParticleCount',
  'minTriangleArea',
  'minTriangleAngleDeg',
  'refineMinAngleDeg',
  'refineMaxAreaFactor',
  'refineMaxPasses',
] as const satisfies readonly (keyof BuildSimMeshParams)[];

/**
 * `.json` 片段檔文字 → `ClipState`（issue #58）：`JSON.parse` → 逐欄位結構驗證
 * （型別、已知的列舉值）→ `image.bytes` base64 解回 `Uint8Array`。任何一步不合格
 * 就丟 `ClipFileError`（帶可直接顯示的說明），**不做部分還原**——呼叫端接住後
 * 整份丟棄，原本的場景不受影響。
 *
 * 不深入驗證 `steps` 裡每個 `InputEvent`／`CameraCommand` 變體的每個欄位（那是
 * `sim`／`camera` 模組自己的型別，這裡只確認外殼：`atStep` 是數字、`event` 是帶
 * 字串 `type` 的物件）——壞掉的個別事件重播時本來就會被 `SimCore.applyInput`／
 * `updateCamera` 忽略，不影響「壞檔擋在載入前」這個把關目的。
 */
export function parseClipFile(text: string): ClipState {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ClipFileError('這不是合法的 JSON 檔案');
  }
  const root = requireObject(doc, '片段檔案');
  const shared = {
    sim: parseSim(root.sim),
    tracks: parseTracks(root.tracks),
    groups: parseGroups(root.groups),
    setupPins: parsePoints(root.setupPins, 'setupPins'),
  };
  let clip: ClipState;
  if (root.version === LEGACY_CLIP_FILE_VERSION) {
    // v1 → 一塊 Jelly 的 Scene（見檔頭）。
    const legacyCounters = requireObject(root.counters, 'counters');
    clip = {
      ...shared,
      sources: { 'src/1': parseImage(root.image, 'image') },
      scene: [
        {
          jellyId: 'jelly/1',
          sourceId: 'src/1',
          meshParams: parseMeshParams(root.meshParams, 'meshParams'),
          importSize: parseImportSize(root.importSize, 'importSize'),
          offset: { x: 0, y: 0 },
        },
      ],
      counters: {
        nextTrackNum: requireNumber(legacyCounters.nextTrackNum, 'counters.nextTrackNum'),
        nextGroupNum: requireNumber(legacyCounters.nextGroupNum, 'counters.nextGroupNum'),
        nextJellyNum: 2,
        nextSourceNum: 2,
      },
    };
  } else if (root.version === CLIP_FILE_VERSION) {
    clip = {
      ...shared,
      sources: parseSources(root.sources),
      scene: parseScene(root.scene),
      counters: parseCounters(root.counters),
    };
  } else {
    throw new ClipFileError(`不支援的片段版本：${String(root.version)}`);
  }
  checkSourceReferences(clip);
  return clip;
}

/** Scene 條目與 Track 裡的 `spawn` 事件引用的 `sourceId` 都必須在 `sources` 裡——載入後生成時才找得到圖。 */
function checkSourceReferences(clip: ClipState): void {
  const check = (sourceId: unknown, field: string): void => {
    if (typeof sourceId !== 'string' || !(sourceId in clip.sources)) {
      throw new ClipFileError(`欄位「${field}」引用了不存在的來源圖：${String(sourceId)}`);
    }
  };
  clip.scene.forEach((entry, i) => check(entry.sourceId, `scene[${i}].sourceId`));
  clip.tracks.forEach((track, t) => {
    track.steps.forEach((step, i) => {
      if (step.event.type === 'spawn') {
        check(step.event.sourceId, `tracks[${t}].steps[${i}].event.sourceId`);
      }
    });
  });
}

function requireObject(v: unknown, field: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ClipFileError(`欄位「${field}」缺失或格式不對`);
  }
  return v as Record<string, unknown>;
}

function requireArray(v: unknown, field: string): unknown[] {
  if (!Array.isArray(v)) throw new ClipFileError(`欄位「${field}」不是陣列`);
  return v;
}

function requireNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ClipFileError(`欄位「${field}」不是數字`);
  }
  return v;
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new ClipFileError(`欄位「${field}」不是字串`);
  return v;
}

function requireBoolean(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new ClipFileError(`欄位「${field}」不是布林值`);
  return v;
}

function parseImage(v: unknown, field: string): ClipImage {
  const obj = requireObject(v, field);
  const format = requireString(obj.format, `${field}.format`);
  if (!KNOWN_IMAGE_FORMATS.has(format)) {
    throw new ClipFileError(`欄位「${field}.format」不是已知格式：${format}`);
  }
  return {
    format: format as ImageFormat,
    bytes: base64ToBytes(requireString(obj.bytes, `${field}.bytes`), `${field}.bytes`),
  };
}

function parseSources(v: unknown): Record<string, ClipImage> {
  const obj = requireObject(v, 'sources');
  const out: Record<string, ClipImage> = {};
  for (const [id, image] of Object.entries(obj)) out[id] = parseImage(image, `sources.${id}`);
  return out;
}

function parseMeshParams(v: unknown, field: string): BuildSimMeshParams {
  const obj = requireObject(v, field);
  const out = {} as Record<(typeof MESH_PARAM_KEYS)[number], number>;
  for (const key of MESH_PARAM_KEYS) out[key] = requireNumber(obj[key], `${field}.${key}`);
  return out;
}

/** 欄位缺失（v1 舊檔）或 `null` → `null`（未縮放）；存在則必須是正數。 */
function parseImportSize(v: unknown, field: string): number | null {
  if (v === undefined || v === null) return null;
  const n = requireNumber(v, field);
  if (n <= 0) throw new ClipFileError(`欄位「${field}」必須是正數`);
  return n;
}

function parseSceneEntry(v: unknown, field: string): SceneEntry {
  const obj = requireObject(v, field);
  return {
    jellyId: requireString(obj.jellyId, `${field}.jellyId`),
    sourceId: requireString(obj.sourceId, `${field}.sourceId`),
    meshParams: parseMeshParams(obj.meshParams, `${field}.meshParams`),
    importSize: parseImportSize(obj.importSize, `${field}.importSize`),
    offset: parsePoint(obj.offset, `${field}.offset`),
  };
}

function parseScene(v: unknown): SceneEntry[] {
  return requireArray(v, 'scene').map((e, i) => parseSceneEntry(e, `scene[${i}]`));
}

function isBoundaryMode(v: string): v is BoundaryMode {
  return (BOUNDARY_MODES as readonly string[]).includes(v);
}

function parseSim(v: unknown): ClipSim {
  const obj = requireObject(v, 'sim');
  const boundary = requireString(obj.boundary, 'sim.boundary');
  if (!isBoundaryMode(boundary)) {
    throw new ClipFileError(`欄位「sim.boundary」不是已知值：${boundary}`);
  }
  return {
    softness: requireNumber(obj.softness, 'sim.softness'),
    tapStrength: requireNumber(obj.tapStrength, 'sim.tapStrength'),
    boundary,
    gravity: parseGravity(obj.gravity),
  };
}

/** 欄位缺失（舊檔）→ 0；存在則必須是 ≥ 0 的數字（`null` 也算型別錯）。 */
function parseGravity(v: unknown): number {
  if (v === undefined) return 0;
  const n = requireNumber(v, 'sim.gravity');
  if (n < 0) throw new ClipFileError('欄位「sim.gravity」不可為負數');
  return n;
}

function parseCameraState(v: unknown, field: string): CameraState {
  const obj = requireObject(v, field);
  const transform = requireObject(obj.transform, `${field}.transform`);
  return {
    transform: {
      x: requireNumber(transform.x, `${field}.transform.x`),
      y: requireNumber(transform.y, `${field}.transform.y`),
      scale: requireNumber(transform.scale, `${field}.transform.scale`),
    },
    followEnabled: requireBoolean(obj.followEnabled, `${field}.followEnabled`),
    sinceManualSeconds: requireNumber(obj.sinceManualSeconds, `${field}.sinceManualSeconds`),
    framing: requireBoolean(obj.framing, `${field}.framing`),
  };
}

/**
 * `spawn`／`remove`（issue #95）是第一批帶巢狀結構的 Track 事件——`spawn` 的 `meshParams`／
 * `offset` 重播時直接進 `meshProvider`，壞欄位不在這裡擋就會到播放中途才炸，所以這兩種
 * 走完整驗證；其餘事件維持只驗外殼（見 `parseClipFile` 說明）。
 */
function parseDemoStep(v: unknown, field: string): DemoStep {
  const obj = requireObject(v, field);
  const raw = requireObject(obj.event, `${field}.event`);
  const type = requireString(raw.type, `${field}.event.type`);
  let event: DemoEvent;
  if (type === 'spawn') {
    event = { type, ...parseSceneEntry(raw, `${field}.event`) };
  } else if (type === 'remove') {
    event = { type, jellyId: requireString(raw.jellyId, `${field}.event.jellyId`) };
  } else {
    event = raw as unknown as DemoEvent;
  }
  return { atStep: requireNumber(obj.atStep, `${field}.atStep`), event };
}

function parseTrackSteps(v: unknown, field: string): Track {
  return requireArray(v, field).map((s, i) => parseDemoStep(s, `${field}[${i}]`));
}

function parseStringArray(v: unknown, field: string): string[] {
  return requireArray(v, field).map((s, i) => requireString(s, `${field}[${i}]`));
}

function parseTrack(v: unknown, field: string): ClipTrack {
  const obj = requireObject(v, field);
  const kind = requireString(obj.kind, `${field}.kind`);
  if (kind !== 'action' && kind !== 'camera') {
    throw new ClipFileError(`欄位「${field}.kind」不是已知值：${kind}`);
  }
  const startCameraRaw = obj.startCamera;
  return {
    id: requireString(obj.id, `${field}.id`),
    kind,
    name: requireString(obj.name, `${field}.name`),
    startStep: requireNumber(obj.startStep, `${field}.startStep`),
    inStep: requireNumber(obj.inStep, `${field}.inStep`),
    outStep: requireNumber(obj.outStep, `${field}.outStep`),
    steps: parseTrackSteps(obj.steps, `${field}.steps`),
    startCamera:
      startCameraRaw === null ? null : parseCameraState(startCameraRaw, `${field}.startCamera`),
    groupIds: parseStringArray(obj.groupIds, `${field}.groupIds`),
  };
}

function parseTracks(v: unknown): ClipTrack[] {
  return requireArray(v, 'tracks').map((t, i) => parseTrack(t, `tracks[${i}]`));
}

function parseGroup(v: unknown, field: string): ClipGroup {
  const obj = requireObject(v, field);
  return {
    id: requireString(obj.id, `${field}.id`),
    name: requireString(obj.name, `${field}.name`),
    enabled: requireBoolean(obj.enabled, `${field}.enabled`),
  };
}

function parseGroups(v: unknown): ClipGroup[] {
  return requireArray(v, 'groups').map((g, i) => parseGroup(g, `groups[${i}]`));
}

function parsePoint(v: unknown, field: string): ClipPoint {
  const obj = requireObject(v, field);
  return { x: requireNumber(obj.x, `${field}.x`), y: requireNumber(obj.y, `${field}.y`) };
}

function parsePoints(v: unknown, field: string): ClipPoint[] {
  return requireArray(v, field).map((p, i) => parsePoint(p, `${field}[${i}]`));
}

function parseCounters(v: unknown): ClipCounters {
  const obj = requireObject(v, 'counters');
  return {
    nextTrackNum: requireNumber(obj.nextTrackNum, 'counters.nextTrackNum'),
    nextGroupNum: requireNumber(obj.nextGroupNum, 'counters.nextGroupNum'),
    nextJellyNum: requireNumber(obj.nextJellyNum, 'counters.nextJellyNum'),
    nextSourceNum: requireNumber(obj.nextSourceNum, 'counters.nextSourceNum'),
  };
}

/**
 * base64 → `Uint8Array`（`bytesToBase64` 的反向）。瀏覽器 `atob` 對非法 base64
 * 字元丟 `DOMException`，這裡一律轉成具名 `ClipFileError`。
 */
function base64ToBytes(b64: string, field: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new ClipFileError(`欄位「${field}」不是合法的 base64`);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
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
