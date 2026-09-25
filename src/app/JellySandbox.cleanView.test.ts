/**
 * 乾淨畫面 × 提示開關的整合測試（issue #139 B4；規則來自 issue #130）：走真的 `JellySandbox`
 * ＋`ControlPanel`＋`CleanView` 接線，確認「進入乾淨畫面前就關掉的提示，離開後仍維持關掉；
 * 原本開著的提示離開後回來」。純函式那一半（`visibleHints`）在 `hintVisibility.test.ts`。
 *
 * jsdom 沒有 WebGL 也沒有 2D canvas，所以：
 * - 算繪端換成記錄呼叫的替身（`JellyRenderer.create` 需要 PixiJS＋WebGL，這裡直接呼叫
 *   私有建構子把替身塞進去；`'../render'` 也 mock 掉，免得載入 PixiJS）。
 * - 內建預設果凍的貼圖改成一張用 `fast-png` 編的小方塊 PNG（`drawDefaultTexture`／
 *   `canvasToPng` 需要 2D canvas）。
 * 不呼叫 `start()`（沒有 rAF 迴圈）：這裡要看的顯示狀態都在事件當下由 `applyHintVisibility`
 * 推出去，不靠每幀更新。
 */

import { encode as encodePng } from 'fast-png';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../render', () => ({ JellyRenderer: class {} }));
vi.mock('./defaultJelly', () => ({
  drawDefaultTexture: () => document.createElement('canvas'),
  canvasToPng: () => {
    // 32×32 全不透明的方塊：夠 `buildSimMesh` 生出一塊果凍。
    const size = 32;
    const data = new Uint8Array(size * size * 4).fill(255);
    return encodePng({ width: size, height: size, data, channels: 4 });
  },
}));

import { JellySandbox } from './JellySandbox';

/** 算繪端替身：`canvas` 是真的元素（輸入層要掛監聽），其餘方法一律 no-op，只記下網格顯示開關。 */
function fakeRenderer(wireframeCalls: boolean[]): unknown {
  const canvas = document.createElement('canvas');
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'canvas') return canvas;
        if (prop === 'setWireframeVisible') return (v: boolean) => wireframeCalls.push(v);
        if (prop === 'then') return undefined;
        return () => [];
      },
    },
  );
}

type SandboxCtor = new (
  root: HTMLElement,
  renderer: unknown,
  texture: HTMLCanvasElement,
) => JellySandbox;

describe('JellySandbox — 乾淨畫面不改寫提示開關（issue #130 / #139）', () => {
  let root: HTMLDivElement;
  let sandbox: JellySandbox;
  let wireframeCalls: boolean[];

  beforeEach(() => {
    // 第一次開網頁會自動跳「?」說明浮層；這裡不關心它。
    localStorage.setItem('jelly-sandbox:help-seen', '1');
    root = document.createElement('div');
    document.body.appendChild(root);
    wireframeCalls = [];
    const Ctor = JellySandbox as unknown as SandboxCtor;
    sandbox = new Ctor(root, fakeRenderer(wireframeCalls), document.createElement('canvas'));
  });

  afterEach(() => {
    sandbox.destroy();
    document.body.replaceChildren();
    localStorage.clear();
  });

  /** 側欄上某個勾選框（依 `<label>` 文字找）。 */
  function checkbox(labelText: string): HTMLInputElement {
    const label = [...root.querySelectorAll('label')].find(
      (el) => el.textContent?.trim() === labelText,
    );
    const input = label?.querySelector('input[type="checkbox"]');
    if (!(input instanceof HTMLInputElement)) throw new Error(`找不到勾選框「${labelText}」`);
    return input;
  }

  function toggle(input: HTMLInputElement): void {
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change'));
  }

  function pinMarkersVisible(): boolean {
    const el = root.querySelector('.jelly-pin-markers');
    if (!el) throw new Error('找不到 Pin 標記層');
    return !el.classList.contains('is-hidden');
  }

  it('進入前關掉的「顯示 Pin」離開後仍關；進入前打開的「顯示網格」離開後回來', () => {
    const showPins = checkbox('顯示 Pin');
    const showWireframe = checkbox('顯示網格');
    expect(showPins.checked).toBe(true);
    expect(showWireframe.checked).toBe(false);

    toggle(showPins); // 關掉 Pin 標記
    toggle(showWireframe); // 打開網格
    expect(pinMarkersVisible()).toBe(false);
    expect(wireframeCalls.at(-1)).toBe(true);

    const enter = root.querySelector('button[aria-label="進入乾淨畫面"]');
    if (!(enter instanceof HTMLButtonElement)) throw new Error('找不到進入乾淨畫面鈕');
    enter.click();
    expect(pinMarkersVisible()).toBe(false);
    expect(wireframeCalls.at(-1)).toBe(false); // 乾淨畫面中網格被壓下

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pinMarkersVisible()).toBe(false); // 使用者關掉的仍然關著
    expect(wireframeCalls.at(-1)).toBe(true); // 使用者打開的回來
    // 開關本身沒被乾淨畫面改寫
    expect(showPins.checked).toBe(false);
    expect(showWireframe.checked).toBe(true);
  });
});
