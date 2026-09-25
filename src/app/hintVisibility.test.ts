import { describe, expect, it } from 'vitest';

import { ALL_HINTS_HIDDEN, visibleHints, type HintVisibility } from './hintVisibility';

/** 使用者事先關掉了 Pin 標記與風扇圖示、打開了顯示網格。 */
function intent(): HintVisibility {
  return {
    wireframe: true,
    pins: false,
    fanRange: true,
    fanIcon: false,
    formation: true,
    handfulRange: true,
  };
}

describe('visibleHints — 提示的意圖＋現算（issue #71、#130）', () => {
  it('沒被壓下 → 就是使用者的意圖', () => {
    const hints = intent();
    expect(visibleHints(hints, { playback: false, cleanView: false })).toEqual(intent());
  });

  it('乾淨畫面中 → 全部隱藏', () => {
    expect(visibleHints(intent(), { playback: false, cleanView: true })).toEqual(ALL_HINTS_HIDDEN);
  });

  it('播放中被壓下 → 全部隱藏', () => {
    expect(visibleHints(intent(), { playback: true, cleanView: false })).toEqual(ALL_HINTS_HIDDEN);
  });

  it('進出乾淨畫面不改寫意圖：離開後進入前就關掉的提示維持關掉、開著的回來', () => {
    const hints = intent();
    visibleHints(hints, { playback: false, cleanView: true });
    expect(hints).toEqual(intent());
    const after = visibleHints(hints, { playback: false, cleanView: false });
    expect(after.pins).toBe(false);
    expect(after.fanIcon).toBe(false);
    expect(after.wireframe).toBe(true);
    expect(after.formation).toBe(true);
  });

  it('乾淨畫面與播放壓下疊在一起：離開乾淨畫面後若仍在播放，照樣壓著', () => {
    expect(visibleHints(intent(), { playback: true, cleanView: true })).toEqual(ALL_HINTS_HIDDEN);
    expect(visibleHints(intent(), { playback: true, cleanView: false })).toEqual(ALL_HINTS_HIDDEN);
  });
});
