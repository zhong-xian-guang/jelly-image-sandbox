import { describe, expect, it } from 'vitest';

import { TrackRecorder } from './TrackRecorder';

describe('TrackRecorder', () => {
  it('錄下的事件時間戳記是相對錄製起點的 step 計數，隨 tick() 前進', () => {
    const recorder = new TrackRecorder();
    recorder.start();

    recorder.record({ type: 'grab', id: 'a', x: 0, y: 0 }); // step 0
    recorder.tick();
    recorder.tick();
    recorder.record({ type: 'moveGrab', id: 'a', x: 1, y: 1 }); // step 2
    recorder.record({ type: 'panBy', dxScreen: 5, dyScreen: 0 }); // step 2，同一 step 可以有多個事件
    recorder.tick();
    recorder.record({ type: 'release', id: 'a' }); // step 3

    const track = recorder.stop();
    expect(track).toEqual([
      { atStep: 0, event: { type: 'grab', id: 'a', x: 0, y: 0 } },
      { atStep: 2, event: { type: 'moveGrab', id: 'a', x: 1, y: 1 } },
      { atStep: 2, event: { type: 'panBy', dxScreen: 5, dyScreen: 0 } },
      { atStep: 3, event: { type: 'release', id: 'a' } },
    ]);
  });

  it('stop() 後不再接受新事件，tick() 也不再前進錄製時間軸', () => {
    const recorder = new TrackRecorder();
    recorder.start();
    recorder.record({ type: 'tap', x: 0, y: 0 });
    const track = recorder.stop();
    expect(recorder.isRecording).toBe(false);

    recorder.tick();
    recorder.record({ type: 'tap', x: 9, y: 9 });

    expect(track).toEqual([{ atStep: 0, event: { type: 'tap', x: 0, y: 0 } }]);
  });

  it('空錄製（start 後立刻 stop，沒有任何操作）回傳空 Track', () => {
    const recorder = new TrackRecorder();
    recorder.start();
    expect(recorder.stop()).toEqual([]);
  });

  it('start() 會取代進行中的錄製，時間軸從 step 0 重新算', () => {
    const recorder = new TrackRecorder();
    recorder.start();
    recorder.tick();
    recorder.tick();
    recorder.record({ type: 'tap', x: 1, y: 1 }); // 第一段錄製的 step 2

    recorder.start(); // 取代第一段，重新從 step 0 開始
    recorder.record({ type: 'tap', x: 2, y: 2 });

    expect(recorder.stop()).toEqual([{ atStep: 0, event: { type: 'tap', x: 2, y: 2 } }]);
  });
});
