/**
 * `JellySandbox` 整合測試共用的接線（`JellySandbox.*.test.ts`）——不是產品程式碼。
 *
 * jsdom 沒有 WebGL 也沒有 2D canvas，所以算繪端換成記錄呼叫的替身（`JellyRenderer.create` 需要
 * PixiJS＋WebGL，這裡直接呼叫私有建構子把替身塞進去），背景儲存換成記憶體版本。每個測試檔
 * 還要自己 `vi.mock('../render')` 與 `vi.mock('./defaultJelly')`（`vi.mock` 只對寫它的那個檔案
 * 生效）。不呼叫 `start()`（沒有 rAF 迴圈）。
 */

import { BackdropBoard } from './BackdropBoard';
import { BackgroundStore, memoryKeyValueStore } from './backgroundStore';
import { JellySandbox } from './JellySandbox';

type SandboxCtor = new (
  root: HTMLElement,
  renderer: unknown,
  texture: HTMLCanvasElement,
  background: { store: BackgroundStore; color: string; backdrops: BackdropBoard },
) => JellySandbox;

/**
 * 算繪端替身：`canvas` 是真的元素（輸入層要掛監聽），其餘方法一律 no-op；`calls` 記下每個方法
 * 收到的參數（依方法名）。
 */
function fakeRenderer(calls: Map<string, unknown[][]>): unknown {
  const canvas = document.createElement('canvas');
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'canvas') return canvas;
        if (prop === 'then') return undefined;
        return (...args: unknown[]) => {
          const name = String(prop);
          if (!calls.has(name)) calls.set(name, []);
          calls.get(name)!.push(args);
          return [];
        };
      },
    },
  );
}

/** 在 `root` 裡建一個沙盒（內建預設果凍一塊、背景色預設）。 */
export function createTestSandbox(root: HTMLElement): {
  sandbox: JellySandbox;
  rendererCalls: Map<string, unknown[][]>;
} {
  const rendererCalls = new Map<string, unknown[][]>();
  const store = new BackgroundStore(memoryKeyValueStore(), () => {});
  const Ctor = JellySandbox as unknown as SandboxCtor;
  const sandbox = new Ctor(root, fakeRenderer(rendererCalls), document.createElement('canvas'), {
    store,
    color: '#1a1a1a',
    backdrops: new BackdropBoard(store),
  });
  return { sandbox, rendererCalls };
}
