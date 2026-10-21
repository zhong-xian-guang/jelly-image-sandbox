/**
 * 背景設定的儲存層（issue #147 / 背景 T1；spec #146、ADR-0017）——Background color（背景色）
 * 與 Backdrop（背景圖）都存在這台瀏覽器的 IndexedDB，不進片段檔。
 *
 * 分兩層：
 *
 * - `AsyncKeyValueStore`：最薄的非同步 key-value 介面（`get`／`set`／`delete`）。正式環境是
 *   `openIndexedDbStore()`（值走 structured clone，Blob 可以直接存），測試注入
 *   `memoryKeyValueStore()`。轉接層本身只是幾行 IndexedDB 樣板，不寫單元測試（spec #146）。
 * - `BackgroundStore`：知道要存哪些 key、怎麼讀回驗證，以及「拿不到就不存」——比照
 *   `panelLayout`／`fanIconStyle` 的寫法，但 IndexedDB 是非同步的，失敗要等 Promise 才知道。
 *
 * **退回成只在本次有效**：itch.io 在 iframe 裡跑，IndexedDB 可能被分區或封鎖；無痕視窗、
 * 配額滿也會寫不進去。第一次寫入失敗（或一開始就沒有儲存可用）時呼叫一次 `onUnavailable`
 * 提示使用者「關掉頁面後設定不會保留」，之後不再嘗試寫入——畫面上的狀態照常運作，只是不
 * 落地。讀取失敗不提示：沒碰過背景設定的使用者不該每次開頁都看到一行警告。
 *
 * 寫入一律排進同一條佇列，依呼叫順序執行（先存圖再存清單，重新整理時清單才不會指到還沒
 * 存好的圖）；同一個 key 連續寫入時只留最後一個值（拖曳 Backdrop 每格都在改位置，不必每格
 * 都真的寫一次）。
 */

/** 最薄的非同步 key-value 儲存——IndexedDB 轉接層與測試用的記憶體版本都實作它。 */
export interface AsyncKeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** 預設背景色——跟改成可設定之前寫死的那個一樣。 */
export const DEFAULT_BACKGROUND_COLOR = '#1a1a1a';

/** 儲存不能用時給使用者的提示（只出現一次）。 */
export const BACKGROUND_STORAGE_UNAVAILABLE_NOTICE =
  '這個瀏覽器環境不能保存背景設定：關掉或重新整理頁面後，背景色與背景圖會回到預設';

const COLOR_KEY = 'backgroundColor';

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** 記憶體版本（測試用，也可當成「只在本次有效」的替身）。 */
export function memoryKeyValueStore(): AsyncKeyValueStore {
  const data = new Map<string, unknown>();
  return {
    get: async (key) => data.get(key),
    set: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
}

const IDB_NAME = 'jelly-sandbox';
const IDB_STORE = 'background';
/** IndexedDB 開不起來也不報錯（某些封鎖情境會一直懸著）時，最多等這麼久就當作不能用。 */
const IDB_OPEN_TIMEOUT_MS = 2000;

/**
 * 開這台瀏覽器的 IndexedDB；不存在、被擋、開啟失敗或逾時都回 `null`（呼叫端退回只在本次
 * 有效）。
 */
export function openIndexedDbStore(): Promise<AsyncKeyValueStore | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (store: AsyncKeyValueStore | null): void => {
      if (settled) return;
      settled = true;
      resolve(store);
    };
    const timer = setTimeout(() => finish(null), IDB_OPEN_TIMEOUT_MS);
    try {
      const request = globalThis.indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE);
      request.onsuccess = () => {
        clearTimeout(timer);
        finish(indexedDbStore(request.result));
      };
      request.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      request.onblocked = () => {
        clearTimeout(timer);
        finish(null);
      };
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

function indexedDbStore(db: IDBDatabase): AsyncKeyValueStore {
  const run = <T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const request = op(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  return {
    get: (key) => run('readonly', (s) => s.get(key)),
    set: async (key, value) => {
      await run('readwrite', (s) => s.put(value, key));
    },
    delete: async (key) => {
      await run('readwrite', (s) => s.delete(key));
    },
  };
}

export class BackgroundStore {
  private readonly store: AsyncKeyValueStore | null;
  private readonly onUnavailable: (message: string) => void;
  private persistent: boolean;
  private notified = false;
  /** 寫入佇列的尾巴——每個寫入接在它後面。 */
  private queue: Promise<void> = Promise.resolve();
  /** 已排進佇列、還沒開始寫的值（同一個 key 再寫一次就直接換掉這裡的值）。 */
  private readonly pending = new Map<string, unknown>();

  /**
   * `store` 為 `null`＝一開始就沒有儲存可用（IndexedDB 不存在或開不起來）；
   * `onUnavailable` 在第一次寫不進去時呼叫一次。
   */
  constructor(store: AsyncKeyValueStore | null, onUnavailable: (message: string) => void) {
    this.store = store;
    this.onUnavailable = onUnavailable;
    this.persistent = store !== null;
  }

  /** 設定會不會留到下次開頁（第一次寫入失敗後變成 `false`）。 */
  get isPersistent(): boolean {
    return this.persistent;
  }

  /** 上次存的背景色（`#rrggbb`）；沒存過、讀不到或內容不對回 `null`。 */
  async loadColor(): Promise<string | null> {
    const value = await this.read(COLOR_KEY);
    return typeof value === 'string' && COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
  }

  saveColor(color: string): void {
    this.write(COLOR_KEY, color);
  }

  /** 等目前排進佇列的寫入全部做完（測試與「先存完再重新整理」的驗證用）。 */
  flush(): Promise<void> {
    return this.queue;
  }

  protected async read(key: string): Promise<unknown> {
    if (!this.store) return undefined;
    try {
      return await this.store.get(key);
    } catch {
      return undefined;
    }
  }

  /** 排一個寫入；同一個 key 已經在排隊就只換掉值。 */
  protected write(key: string, value: unknown): void {
    const queued = this.pending.has(key);
    this.pending.set(key, value);
    if (queued) return;
    this.enqueue(async (store) => {
      const latest = this.pending.get(key);
      this.pending.delete(key);
      await store.set(key, latest);
    });
  }

  protected remove(key: string): void {
    this.pending.delete(key);
    this.enqueue((store) => store.delete(key));
  }

  private enqueue(op: (store: AsyncKeyValueStore) => Promise<void>): void {
    this.queue = this.queue.then(async () => {
      if (!this.persistent || !this.store) {
        this.pending.clear();
        this.markUnavailable();
        return;
      }
      try {
        await op(this.store);
      } catch {
        this.persistent = false;
        this.pending.clear();
        this.markUnavailable();
      }
    });
  }

  private markUnavailable(): void {
    this.persistent = false;
    if (this.notified) return;
    this.notified = true;
    this.onUnavailable(BACKGROUND_STORAGE_UNAVAILABLE_NOTICE);
  }
}
