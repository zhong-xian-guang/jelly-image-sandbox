import { describe, expect, it } from 'vitest';

import type { CameraState } from '../../camera';
import { TrackRecorder } from './TrackRecorder';

/** 一份最小合法的相機狀態，當錄製起點快照用。 */
const SNAPSHOT: CameraState = {
  transform: { x: 12, y: -3, scale: 2 },
  followEnabled: false,
  framing: false,
  sinceManualSeconds: 2,
};

describe('TrackRecorder', () => {
  it('stop() 把混合事件序列依種類拆成 action／camera 兩份，各自相對錄製起點', () => {
    const recorder = new TrackRecorder();
    recorder.start('both');

    recorder.record({ type: 'grab', id: 'a', x: 0, y: 0 }); // step 0
    recorder.record({ type: 'panBy', dxScreen: 5, dyScreen: 0 }); // step 0
    recorder.tick();
    recorder.tick();
    recorder.record({ type: 'moveGrab', id: 'a', x: 1, y: 1 }); // step 2
    recorder.record({ type: 'zoomBy', factor: 1.2, pivotScreen: { x: 0, y: 0 } }); // step 2
    recorder.tick();
    recorder.record({ type: 'release', id: 'a' }); // step 3

    const { action, camera } = recorder.stop();
    expect(action).toEqual([
      { atStep: 0, event: { type: 'grab', id: 'a', x: 0, y: 0 } },
      { atStep: 2, event: { type: 'moveGrab', id: 'a', x: 1, y: 1 } },
      { atStep: 3, event: { type: 'release', id: 'a' } },
    ]);
    expect(camera).toEqual([
      { atStep: 0, event: { type: 'panBy', dxScreen: 5, dyScreen: 0 } },
      { atStep: 2, event: { type: 'zoomBy', factor: 1.2, pivotScreen: { x: 0, y: 0 } } },
    ]);
  });

  it('錄製目標為 action 時只回傳 action 那份，camera 那份為空（相機操作即時生效但不錄）', () => {
    const recorder = new TrackRecorder();
    recorder.start('action');
    recorder.record({ type: 'grab', id: 'a', x: 0, y: 0 });
    recorder.record({ type: 'panBy', dxScreen: 5, dyScreen: 0 });

    const { action, camera } = recorder.stop();
    expect(action).toEqual([{ atStep: 0, event: { type: 'grab', id: 'a', x: 0, y: 0 } }]);
    expect(camera).toEqual([]);
  });

  it('錄製目標為 camera 時只回傳 camera 那份，action 那份為空', () => {
    const recorder = new TrackRecorder();
    recorder.start('camera');
    recorder.record({ type: 'grab', id: 'a', x: 0, y: 0 });
    recorder.record({ type: 'frame' });

    const { action, camera } = recorder.stop();
    expect(action).toEqual([]);
    expect(camera).toEqual([{ atStep: 0, event: { type: 'frame' } }]);
  });

  it('start() 預設目標為 both，兩份都回傳', () => {
    const recorder = new TrackRecorder();
    recorder.start();
    recorder.record({ type: 'tap', x: 0, y: 0 });
    recorder.record({ type: 'setFollow', enabled: false });

    const { action, camera } = recorder.stop();
    expect(action).toEqual([{ atStep: 0, event: { type: 'tap', x: 0, y: 0 } }]);
    expect(camera).toEqual([{ atStep: 0, event: { type: 'setFollow', enabled: false } }]);
  });

  it('空錄製（start 後立刻 stop，沒有任何操作）兩份都空', () => {
    const recorder = new TrackRecorder();
    recorder.start('both');
    expect(recorder.stop()).toEqual({ action: [], camera: [], startCamera: null });
  });

  it('stop() 後不再接受新事件，tick() 也不再前進錄製時間軸', () => {
    const recorder = new TrackRecorder();
    recorder.start('both');
    recorder.record({ type: 'tap', x: 0, y: 0 });
    const first = recorder.stop();
    expect(recorder.isRecording).toBe(false);

    recorder.tick();
    recorder.record({ type: 'tap', x: 9, y: 9 });

    // stop() 後的 record()/tick() 都沒生效——重新 stop() 拿到的還是同一份內容。
    expect(first).toEqual({
      action: [{ atStep: 0, event: { type: 'tap', x: 0, y: 0 } }],
      camera: [],
      startCamera: null,
    });
    expect(recorder.stop()).toEqual(first);
  });

  it('start() 會取代進行中的錄製，時間軸從 step 0 重新算', () => {
    const recorder = new TrackRecorder();
    recorder.start('both');
    recorder.tick();
    recorder.tick();
    recorder.record({ type: 'tap', x: 1, y: 1 }); // 第一段錄製的 step 2

    recorder.start('both'); // 取代第一段，重新從 step 0 開始
    recorder.record({ type: 'tap', x: 2, y: 2 });

    expect(recorder.stop()).toEqual({
      action: [{ atStep: 0, event: { type: 'tap', x: 2, y: 2 } }],
      camera: [],
      startCamera: null,
    });
  });

  it('clearPins 落在 action 份、不在 camera 份（issue #51）', () => {
    const recorder = new TrackRecorder();
    recorder.start('both');
    recorder.record({ type: 'pin', id: 'p', x: 0, y: 0 });
    recorder.record({ type: 'clearPins' });
    recorder.record({ type: 'panBy', dxScreen: 1, dyScreen: 0 });

    const { action, camera } = recorder.stop();
    expect(action).toEqual([
      { atStep: 0, event: { type: 'pin', id: 'p', x: 0, y: 0 } },
      { atStep: 0, event: { type: 'clearPins' } },
    ]);
    expect(camera).toEqual([{ atStep: 0, event: { type: 'panBy', dxScreen: 1, dyScreen: 0 } }]);
  });

  it('錄製目標為 camera 時 clearPins 不進任何一份（只錄運鏡，issue #51）', () => {
    const recorder = new TrackRecorder();
    recorder.start('camera');
    recorder.record({ type: 'clearPins' });
    recorder.record({ type: 'frame' });

    const { action, camera } = recorder.stop();
    expect(action).toEqual([]);
    expect(camera).toEqual([{ atStep: 0, event: { type: 'frame' } }]);
  });

  describe('起點鏡頭快照 startCamera（issue #36 / V2 T1-4）', () => {
    it('start() 帶進來的快照原樣夾帶在 stop() 回傳裡', () => {
      const recorder = new TrackRecorder();
      recorder.start('camera', SNAPSHOT);
      recorder.record({ type: 'panBy', dxScreen: 3, dyScreen: 0 });
      expect(recorder.stop().startCamera).toBe(SNAPSHOT);
    });

    it('沒帶 startCamera 時為 null', () => {
      const recorder = new TrackRecorder();
      recorder.start('camera');
      expect(recorder.stop().startCamera).toBeNull();
    });

    it('start() 取代進行中的錄製時，快照也換成新的（沒帶則清成 null）', () => {
      const recorder = new TrackRecorder();
      recorder.start('both', SNAPSHOT);
      recorder.start('both'); // 取代，這次沒帶快照
      expect(recorder.stop().startCamera).toBeNull();
    });
  });
});
