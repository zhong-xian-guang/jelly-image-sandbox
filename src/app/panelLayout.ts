/**
 * 側欄版面狀態（issue #128 / V4 U1；spec #127「側欄」）——各分區展開與否、整個側欄
 * 收起與否。只存在瀏覽器自己的 `localStorage`，不進片段檔。
 *
 * `localStorage` 在 itch.io 的 iframe、無痕視窗、被封鎖網站資料時可能不存在，連
 * 存取 `window.localStorage` 本身都可能丟 `SecurityError`，所以每一次讀寫都包
 * try/catch；讀不到、內容壞掉或缺欄位，一律退回預設（只有物理展開、側欄展開）。
 */

/** 側欄分區，照側欄由上到下的順序（工具列＋工具卡常駐在最上方，不算分區）。 */
export const PANEL_SECTION_IDS = [
  'import',
  'clip',
  'physics',
  'view',
  'demo',
  'record',
  'dev',
] as const;

export type PanelSectionId = (typeof PANEL_SECTION_IDS)[number];

export interface PanelLayout {
  expanded: Record<PanelSectionId, boolean>;
  sidebarCollapsed: boolean;
}

export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  expanded: {
    import: false,
    clip: false,
    physics: true,
    view: false,
    demo: false,
    record: false,
    dev: false,
  },
  sidebarCollapsed: false,
};

export const PANEL_LAYOUT_STORAGE_KEY = 'jelly-sandbox:panel-layout';

/** `Storage` 用得到的那兩個方法——測試可以塞記憶體版本或丟錯的假儲存。 */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** 取瀏覽器的 `localStorage`；拿不到（不存在或存取丟錯）就回 `null`。 */
export function browserStorage(): KeyValueStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadPanelLayout(storage: KeyValueStorage | null): PanelLayout {
  const layout: PanelLayout = {
    expanded: { ...DEFAULT_PANEL_LAYOUT.expanded },
    sidebarCollapsed: DEFAULT_PANEL_LAYOUT.sidebarCollapsed,
  };
  let raw: string | null = null;
  try {
    raw = storage?.getItem(PANEL_LAYOUT_STORAGE_KEY) ?? null;
  } catch {
    return layout;
  }
  if (raw === null) return layout;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return layout;
  }
  if (!isRecord(parsed)) return layout;

  if (isRecord(parsed.expanded)) {
    for (const id of PANEL_SECTION_IDS) {
      const value = parsed.expanded[id];
      if (typeof value === 'boolean') layout.expanded[id] = value;
    }
  }
  if (typeof parsed.sidebarCollapsed === 'boolean') {
    layout.sidebarCollapsed = parsed.sidebarCollapsed;
  }
  return layout;
}

export function savePanelLayout(storage: KeyValueStorage | null, layout: PanelLayout): void {
  try {
    storage?.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // 存不進去就算了：這一頁照樣用記憶體裡的狀態，只是重新整理後回到預設。
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
