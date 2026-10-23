/**
 * 工具參數（issue #160，`ToolParams`）的沙盒接線：走真的 `JellySandbox`（接線見
 * `sandboxTestHarness`），只測「參數變了之後誰跟著動」——場上風扇即時更新、側欄拉霸同步。
 * 夾值、step、通知本身在 `ToolParams.test.ts`；按下時讀哪個值在 `ToolRouter.test.ts`。
 */

import { encode as encodePng } from 'fast-png';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../render', () => ({ JellyRenderer: class {} }));
vi.mock('./defaultJelly', () => ({
  drawDefaultTexture: () => document.createElement('canvas'),
  canvasToPng: () => {
    const size = 32;
    const data = new Uint8Array(size * size * 4).fill(255);
    return encodePng({ width: size, height: size, data, channels: 4 });
  },
}));

import type { ToolParams, ToolRouter } from '../input';
import type { World } from '../sim';
import type { JellySandbox } from './JellySandbox';
import { createTestSandbox } from './sandboxTestHarness';

/** 測試要碰的私有成員（只讀狀態與經公開的協作者操作）。 */
interface SandboxInternals {
  world: World;
  router: ToolRouter;
  toolParams: ToolParams;
}

/** 側欄上文字為 `label` 的那條拉霸。 */
function sliderOf(root: HTMLElement, label: string): HTMLInputElement {
  const rows = Array.from(root.querySelectorAll<HTMLLabelElement>('label.jelly-control-row'));
  const row = rows.find((r) => r.firstChild?.textContent === label);
  if (!row) throw new Error(`找不到拉霸「${label}」`);
  return row.querySelector<HTMLInputElement>('input[type="range"]')!;
}

function dragSlider(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('JellySandbox — 工具參數接線（issue #160）', () => {
  let root: HTMLDivElement;
  let sandbox: JellySandbox;
  let s: SandboxInternals;

  beforeEach(() => {
    localStorage.setItem('jelly-sandbox:help-seen', '1');
    root = document.createElement('div');
    document.body.appendChild(root);
    ({ sandbox } = createTestSandbox(root));
    s = sandbox as unknown as SandboxInternals;
  });

  afterEach(() => {
    sandbox.destroy();
    document.body.replaceChildren();
    localStorage.clear();
  });

  function placeFan(): void {
    s.world.applyInput({
      type: 'setFan',
      originX: 10,
      originY: 20,
      dirX: 1,
      dirY: 0,
      length: 300,
      width: 150,
      strength: 4000,
      falloffExponent: 2,
      frequency: 2,
    });
  }

  it('拖側欄的電風扇拉霸：場上風扇即時換上新值，幾何不變', () => {
    placeFan();
    dragSlider(sliderOf(root, '風扇寬度'), 200);
    expect(s.world.fanState()).toMatchObject({
      originX: 10,
      originY: 20,
      length: 300,
      width: 200,
      strength: 4000,
    });
    expect(s.toolParams.get('fanWidth')).toBe(200);
  });

  it('右鍵＋滾輪調電風扇參數：場上風扇即時更新、側欄拉霸同步', () => {
    placeFan();
    s.router.setActiveTool('fan');
    s.router.setMode('fan', 'strength');
    expect(s.router.adjustActiveValue(2)).toEqual({ key: 'fanStrength', value: 4400 });
    expect(s.world.fanState()).toMatchObject({ originX: 10, width: 150, strength: 4400 });
    expect(sliderOf(root, '風扇強度').value).toBe('4400');
  });

  it('場上沒有風扇時調參數只改下一次放置用的值，不會憑空生出風扇', () => {
    s.toolParams.set('fanFrequency', 5);
    expect(s.world.fanState()).toBeNull();
    expect(sliderOf(root, '風扇頻率').value).toBe('5');
  });

  it('非電風扇參數（Pin 筆刷半徑、撒 Pin 間距、大把抓取半徑）也同步回拉霸', () => {
    s.toolParams.step('pinBrushRadius', 3);
    s.toolParams.step('spraySpacing', -2);
    s.toolParams.step('handfulRadius', 1);
    expect(sliderOf(root, 'Pin 筆刷半徑').value).toBe('150');
    expect(sliderOf(root, '撒 Pin 間距（越小越密）').value).toBe('32');
    expect(sliderOf(root, '大把抓取半徑').value).toBe('150');
  });
});
