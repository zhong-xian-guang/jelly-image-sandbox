import { describe, expect, it } from 'vitest';

import { coveredInsets, visibleRect, type ClientRect } from './fitInsets';

/** 1280×720 的畫布容器，貼齊視窗左上。 */
const CANVAS: ClientRect = { left: 0, top: 0, right: 1280, bottom: 720 };

/** 實測的預設版面（issue #129 回報）：側欄 12–322、匯入提示 y 636–660、控制條 y 668–708。 */
const SIDEBAR: ClientRect = { left: 12, top: 12, right: 322, bottom: 684 };
const HINT: ClientRect = { left: 458, top: 636, right: 821, bottom: 660 };
const BAR: ClientRect = { left: 428, top: 668, right: 851, bottom: 708 };
const CAMERA: ClientRect = { left: 1052, top: 668, right: 1268, bottom: 708 };

describe('coveredInsets — 畫布被介面蓋住的邊（issue #138）', () => {
  it('底部扣到最上面那一塊的上緣，左邊扣到側欄右緣', () => {
    expect(coveredInsets(CANVAS, { bottom: [BAR, CAMERA, HINT], left: [SIDEBAR] })).toEqual({
      top: 0,
      right: 0,
      bottom: 720 - 636,
      left: 322,
    });
  });

  it('看不到的（null）不算：乾淨畫面全部藏起來＝四邊都是 0', () => {
    expect(coveredInsets(CANVAS, { bottom: [null, null, null], left: [null] })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(coveredInsets(CANVAS, { bottom: [BAR, null], left: [null] })).toEqual({
      top: 0,
      right: 0,
      bottom: 720 - 668,
      left: 0,
    });
  });

  it('座標以畫布容器為準（容器不在視窗左上時照樣對）', () => {
    const canvas: ClientRect = { left: 100, top: 50, right: 900, bottom: 650 };
    const bar: ClientRect = { left: 300, top: 600, right: 700, bottom: 640 };
    const panel: ClientRect = { left: 110, top: 60, right: 300, bottom: 400 };
    expect(coveredInsets(canvas, { bottom: [bar], left: [panel] })).toEqual({
      top: 0,
      right: 0,
      bottom: 50,
      left: 200,
    });
  });

  it('夾在 0 到畫布尺寸之間（跑到畫布外的不算負數，也不超過整張畫布）', () => {
    const below: ClientRect = { left: 0, top: 800, right: 100, bottom: 820 };
    const huge: ClientRect = { left: -50, top: -100, right: 5000, bottom: 900 };
    expect(coveredInsets(CANVAS, { bottom: [below], left: [] }).bottom).toBe(0);
    const clamped = coveredInsets(CANVAS, { bottom: [huge], left: [huge] });
    expect(clamped.bottom).toBe(720);
    expect(clamped.left).toBe(1280);
  });
});

describe('visibleRect', () => {
  it('沒有排版框（display:none／不在文件裡）＝ null', () => {
    const el = document.createElement('div');
    expect(visibleRect(el)).toBeNull();
  });
});
