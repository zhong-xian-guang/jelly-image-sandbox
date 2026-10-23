/**
 * 工具參數（issue #160，spec #158「ToolParams」）——七個工具參數的**唯一**擁有者：電風扇
 * 寬度／強度／衰減指數／頻率、Pin 筆刷半徑、撒 Pin 間距、大把抓取半徑。
 *
 * 以前同一個值在側欄拉霸、`JellySandbox`、`ToolRouter` 各存一份，靠逐參數 setter 鏈同步。
 * 現在只有這裡存：
 *
 * - 側欄拉霸寫入（`set`）、右鍵＋滾輪寫入（`step`，經 `ToolRouter.adjustActiveValue`）；
 * - `ToolRouter` 只在按下（或每一輪撒／擦）時讀值，並回報目前工具＋模式要調哪個 key；
 * - 游標標籤、Pin 筆刷圓圈、大把範圍圈讀值；
 * - 沙盒訂閱單一變更通知（`subscribe`），在那裡更新場上風扇、同步拉霸。
 *
 * `set` 照原值寫入、**不**夾值（拉霸本身已經在範圍內；測試可以刻意寫範圍外的值），`step`
 * 才依拉霸 step 增減並夾在範圍內。每次寫入都通知，即使值沒變——右鍵＋滾輪頂到上限時以前
 * 也照樣更新場上風扇（錄製中照樣錄進去），維持原行為。
 */

/** 拉霸的範圍——面板拉霸與「右鍵＋滾輪」共用同一份。 */
export interface ValueRange {
  min: number;
  max: number;
  step: number;
}

/**
 * 「按住右鍵＋滾輪」能調的數值（issue #114 的「工具半徑」由 issue #122 推廣成「目前模式
 * 的數值」）：抓取／大把的大把抓取半徑、Pin 工具兩個模式共用的 Pin 筆刷半徑（issue #123）、
 * 電風扇四個模式各自的參數（issue #125）。
 */
export type ModeValueKey =
  | 'handfulRadius'
  | 'pinBrushRadius'
  | 'fanWidth'
  | 'fanStrength'
  | 'fanFalloffExponent'
  | 'fanFrequency';

/** 七個工具參數：右鍵＋滾輪調得到的六個，加上只有拉霸的撒 Pin 間距。 */
export type ToolParamKey = ModeValueKey | 'spraySpacing';

/** 電風扇矩形的初始預設值（issue #66）。 */
export const DEFAULT_FAN_WIDTH = 150;
export const DEFAULT_FAN_STRENGTH = 4000;
/** 沿用 `SimCore.doTap` 既有的正規化距離冪次衰減慣例（`(1 − d/R)²`）。 */
export const DEFAULT_FAN_FALLOFF_EXPONENT = 2;
/** 平均每秒陣風次數（issue #67 事後檢視追加，見 `SimCore.applyFan`）。 */
export const DEFAULT_FAN_FREQUENCY = 2;

/**
 * Pin 筆刷半徑的預設值（issue #123；撒 Pin 與橡皮擦共用，GLOSSARY.md「Pin 筆刷半徑」），
 * 世界單位。先取 120，試手感後再調（spec #121）。
 */
export const DEFAULT_PIN_BRUSH_RADIUS = 120;
/** 撒 Pin 最小間距的預設值（issue #69）。 */
export const DEFAULT_SPRAY_SPACING = 36;

/**
 * 大把抓取半徑的預設值（issue #113；世界單位）。跟撒 Pin 同一個預設，拉霸範圍也相同
 * （spec #112）。
 */
export const DEFAULT_HANDFUL_RADIUS = 140;

/**
 * 電風扇四個拉霸的範圍（issue #67；issue #125 從 `JellySandbox` 搬進來，右鍵＋滾輪要夾在
 * 同一個範圍內）。事後檢視把推力模型從連續力場改成陣風——見 `SimCore.applyFan`：
 * `strength` 從「每秒加速度」變成「單次陣風的瞬間速度衝量」，範圍跟著重新校準。
 * `frequency` 是平均每秒陣風次數；下限 0.2（約 5 秒一陣，稀疏陣風）、上限 10（幾乎連續的
 * 密集陣風，配合高 `strength` 就是颶風）。寬度／衰減程度中點對應 `DEFAULT_FAN_WIDTH`／
 * `DEFAULT_FAN_FALLOFF_EXPONENT`，拉霸沒被動過時中點顯示的值要跟實際生效的一致。衰減程度
 * 下限 0.2（避免趨近 0 次方讓衰減幾乎消失、矩形內外力道落差過於突兀）、上限 5（明顯集中在
 * 風扇正前方）。
 */
export const FAN_WIDTH_RANGE: ValueRange = { min: 20, max: 280, step: 5 };
export const FAN_STRENGTH_RANGE: ValueRange = { min: 200, max: 60000, step: 200 };
export const FAN_FALLOFF_RANGE: ValueRange = { min: 0.2, max: 5, step: 0.1 };
export const FAN_FREQUENCY_RANGE: ValueRange = { min: 0.2, max: 10, step: 0.1 };

/**
 * Pin 筆刷半徑拉霸的範圍（issue #123；沿用原本撒 Pin／移除 Pin 半徑的範圍），世界座標
 * 單位。上限 400 ≈ 一般匯入果凍的尺度，一下蓋住整隻。
 */
export const PIN_BRUSH_RADIUS_RANGE: ValueRange = { min: 20, max: 400, step: 10 };

/**
 * 撒 Pin 間距滑桿的範圍（issue #69；issue #160 從 `JellySandbox` 搬進來），世界座標單位。
 * 下限 12 是「撒得很密」的實用下限——再小只是讓 Pin 疊在同一批 Particle 上，手感沒有變化、
 * 求解器卻要多扛幾十個硬約束。
 */
export const SPRAY_SPACING_RANGE: ValueRange = { min: 12, max: 120, step: 2 };

/** 大把抓取半徑拉霸的範圍（issue #113），世界單位——跟撒 Pin 一致（spec #112）。 */
export const HANDFUL_RADIUS_RANGE: ValueRange = { min: 20, max: 400, step: 10 };

/** 各工具參數的拉霸範圍——面板拉霸與「右鍵＋滾輪」共用同一份。 */
export const TOOL_PARAM_RANGES: Readonly<Record<ToolParamKey, ValueRange>> = {
  handfulRadius: HANDFUL_RADIUS_RANGE,
  pinBrushRadius: PIN_BRUSH_RADIUS_RANGE,
  spraySpacing: SPRAY_SPACING_RANGE,
  fanWidth: FAN_WIDTH_RANGE,
  fanStrength: FAN_STRENGTH_RANGE,
  fanFalloffExponent: FAN_FALLOFF_RANGE,
  fanFrequency: FAN_FREQUENCY_RANGE,
};

/** 各工具參數的預設值。 */
export const TOOL_PARAM_DEFAULTS: Readonly<Record<ToolParamKey, number>> = {
  handfulRadius: DEFAULT_HANDFUL_RADIUS,
  pinBrushRadius: DEFAULT_PIN_BRUSH_RADIUS,
  spraySpacing: DEFAULT_SPRAY_SPACING,
  fanWidth: DEFAULT_FAN_WIDTH,
  fanStrength: DEFAULT_FAN_STRENGTH,
  fanFalloffExponent: DEFAULT_FAN_FALLOFF_EXPONENT,
  fanFrequency: DEFAULT_FAN_FREQUENCY,
};

/** 四個電風扇參數的 key——沙盒據此判斷要不要即時更新場上的風扇。 */
export const FAN_PARAM_KEYS: readonly ToolParamKey[] = [
  'fanWidth',
  'fanStrength',
  'fanFalloffExponent',
  'fanFrequency',
];

/** 變更通知：哪個參數、新值多少。 */
export type ToolParamListener = (key: ToolParamKey, value: number) => void;

export class ToolParams {
  private readonly values: Record<ToolParamKey, number> = { ...TOOL_PARAM_DEFAULTS };
  private readonly listeners = new Set<ToolParamListener>();

  get(key: ToolParamKey): number {
    return this.values[key];
  }

  /** 這個參數的拉霸範圍。 */
  range(key: ToolParamKey): ValueRange {
    return TOOL_PARAM_RANGES[key];
  }

  /** 照原值寫入（拉霸用；不夾值，見檔頭說明）並通知。 */
  set(key: ToolParamKey, value: number): void {
    this.values[key] = value;
    for (const listener of this.listeners) listener(key, value);
  }

  /**
   * 往上／下走 `steps` 格拉霸 step（正 = 放大），夾在範圍內、對齊拉霸格點，寫入並通知；
   * 回傳新值。
   */
  step(key: ToolParamKey, steps: number): number {
    const value = stepValue(this.values[key], steps, TOOL_PARAM_RANGES[key]);
    this.set(key, value);
    return value;
  }

  /** 訂閱變更通知；回傳取消訂閱的函式。 */
  subscribe(listener: ToolParamListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * 數值往上／下走 `steps` 格拉霸 step，夾在範圍內（issue #114 的調半徑；issue #125 推廣）。
 * 結果對齊拉霸的格點（`min + k·step`）並捨到 step 的小數位數：電風扇衰減／頻率的 step 是
 * 0.1，連續相加會累積浮點誤差（0.2 + 0.1 = 0.30000000000000004），游標標籤會顯示出來、
 * 也會跟拉霸自己對齊後的值對不上。
 */
function stepValue(value: number, steps: number, range: ValueRange): number {
  const clamped = Math.min(range.max, Math.max(range.min, value + steps * range.step));
  const snapped = range.min + Math.round((clamped - range.min) / range.step) * range.step;
  const rounded = Number(snapped.toFixed(decimalsOf(range.step)));
  return Math.min(range.max, Math.max(range.min, rounded));
}

/** `step` 的小數位數（`0.1` → 1、`10` → 0）。 */
function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}
