/**
 * `JellySandbox`（issue #11 / T10，issue #13 / T12 接入 Camera）——第一個能玩的組裝：
 * `SimCore`（模擬）+ `JellyRenderer`（算繪）+ `PointerInput`（輸入）+ `CameraInput`
 * （相機手動輸入）+ 固定步主迴圈。
 *
 * 主迴圈用 `FixedStepAccumulator`（+ 250ms clamp）把真實時間切成 60Hz 固定步推進
 * 求解器；每幀再用**真實**幀時距（clamp 到 100ms）呼叫純函式 `updateCamera` 推進
 * 相機（平滑是視覺的、不進物理）。所有影響模擬的輸入都經 `PointerInput` →
 * `sim.applyInput`；所有相機手動輸入都經 `CameraInput` → 收集成 `CameraCommand[]`
 * 每幀餵給 `updateCamera`（ADR-0005：兩條輸入流都不繞過各自的窄介面）。
 *
 * picking／算繪都吃 `cameraState.transform`——相機平移／縮放後仍命中正確的表面點。
 */

import {
  CameraInput,
  type CameraCommand,
  type CameraState,
  createCameraState,
  updateCamera,
} from '../camera';
import { PointerInput } from '../input';
import { JellyRenderer, screenToWorld } from '../render';
import { SimCore } from '../sim';
import { createDefaultJelly } from './defaultJelly';
import { FixedStepAccumulator } from './FixedStepAccumulator';

const STEP_SECONDS = 1 / 60;
/** 相機平滑用的單幀時距上限（分頁切回來不會讓相機瞬移）。 */
const CAMERA_MAX_DT = 0.1;

export class JellySandbox {
  private readonly sim: SimCore;
  private readonly renderer: JellyRenderer;
  private readonly input: PointerInput;
  private readonly cameraInput: CameraInput;
  private readonly accumulator = new FixedStepAccumulator(STEP_SECONDS);
  private readonly root: HTMLElement;

  private cameraState: CameraState;
  /** `CameraInput` 逐事件塞入，主迴圈每幀取出餵 `updateCamera` 後清空。 */
  private cameraCommands: CameraCommand[] = [];

  private rafId = 0;
  private lastFrameMs = 0;

  private constructor(
    root: HTMLElement,
    sim: SimCore,
    renderer: JellyRenderer,
    cameraState: CameraState,
  ) {
    this.root = root;
    this.sim = sim;
    this.renderer = renderer;
    this.cameraState = cameraState;

    const project = (sx: number, sy: number) =>
      screenToWorld(
        this.cameraState.transform,
        this.root.clientWidth,
        this.root.clientHeight,
        sx,
        sy,
      );
    const hitTest = (world: { x: number; y: number }) => this.sim.pick(world.x, world.y) != null;

    this.input = new PointerInput(renderer.canvas, {
      screenToWorld: project,
      hitTest,
      applyInput: (event) => this.sim.applyInput(event),
    });
    this.cameraInput = new CameraInput(renderer.canvas, {
      screenToWorld: project,
      hitTest,
      emit: (cmd) => this.cameraCommands.push(cmd),
    });

    this.renderer.setCamera(this.cameraState.transform);
    window.addEventListener('resize', this.onResize);
  }

  /** 建立預設 Jelly 並組裝好；呼叫 `start()` 開始跑。 */
  static async create(root: HTMLElement): Promise<JellySandbox> {
    const { mesh, texture } = createDefaultJelly();
    const sim = new SimCore(mesh);

    const renderer = await JellyRenderer.create({
      width: root.clientWidth,
      height: root.clientHeight,
      mesh,
      positions: sim.positions,
      texture,
      background: { color: 0x1a1a1a, alpha: 1 },
    });
    root.appendChild(renderer.canvas);

    const cameraState = createCameraState(
      { centroid: sim.centroid(), bbox: sim.bbox() },
      { width: root.clientWidth, height: root.clientHeight },
    );
    return new JellySandbox(root, sim, renderer, cameraState);
  }

  start(): void {
    if (this.rafId) return;
    this.lastFrameMs = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  destroy(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.input.destroy();
    this.cameraInput.destroy();
    this.renderer.destroy();
  }

  /** 「鎖定跟隨」開關（issue #14 控制面板接這裡）——關掉自動跟隨，手動仍可動。 */
  setFollowLock(locked: boolean): void {
    this.cameraCommands.push({ type: 'setFollow', enabled: !locked });
  }

  /** 「框住果凍」按鈕（issue #14）——一次性緩動 fit 當前 bbox 後恢復跟隨。 */
  frameJelly(): void {
    this.cameraCommands.push({ type: 'frame' });
  }

  private frame = (nowMs: number): void => {
    const elapsed = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;

    const steps = this.accumulator.advance(elapsed);
    for (let i = 0; i < steps; i++) this.sim.step(STEP_SECONDS);

    const cmds = this.cameraCommands;
    this.cameraCommands = [];
    this.cameraState = updateCamera(
      this.cameraState,
      { centroid: this.sim.centroid(), bbox: this.sim.bbox() },
      { width: this.root.clientWidth, height: this.root.clientHeight },
      cmds,
      Math.min(Math.max(elapsed, 0), CAMERA_MAX_DT),
    );

    this.renderer.setPositions(this.sim.positions);
    this.renderer.setCamera(this.cameraState.transform);
    this.renderer.render();

    this.rafId = requestAnimationFrame(this.frame);
  };

  private onResize = (): void => {
    // 畫布尺寸交給 Renderer；相機下一幀的 `updateCamera` 會用新 viewport 重新 fit。
    this.renderer.resize(this.root.clientWidth, this.root.clientHeight);
  };
}
