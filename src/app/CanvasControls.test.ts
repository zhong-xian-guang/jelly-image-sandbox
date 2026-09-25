import { describe, expect, it, vi } from 'vitest';

import { CameraControls, PlaybackBar } from './CanvasControls';

function contextMenu(target: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  target.dispatchEvent(event);
  return event;
}

describe('畫布控制條上按右鍵不跳原生選單（issue #138）', () => {
  it('播放控制條：按鈕、時間讀數、控制條本身都擋掉原生選單，也不觸發任何按鈕', () => {
    const opts = {
      onToggleRecording: vi.fn(),
      onPlayAll: vi.fn(),
      onTogglePause: vi.fn(),
      onReset: vi.fn(),
    };
    const bar = new PlaybackBar(opts);
    for (const target of [
      bar.element,
      ...bar.element.querySelectorAll('button'),
      bar.element.querySelector('.jelly-playback-time')!,
    ]) {
      expect(contextMenu(target).defaultPrevented).toBe(true);
    }
    for (const fn of Object.values(opts)) expect(fn).not.toHaveBeenCalled();
  });

  it('相機按鈕：按鈕、縮放讀數、外框都擋掉原生選單，也不觸發任何按鈕', () => {
    const opts = { followLocked: false, onFollowLockChange: vi.fn(), onFrameJelly: vi.fn() };
    const controls = new CameraControls(opts);
    for (const target of [
      controls.element,
      ...controls.element.querySelectorAll('button'),
      controls.element.querySelector('.jelly-zoom-readout')!,
    ]) {
      expect(contextMenu(target).defaultPrevented).toBe(true);
    }
    expect(opts.onFollowLockChange).not.toHaveBeenCalled();
    expect(opts.onFrameJelly).not.toHaveBeenCalled();
  });
});
