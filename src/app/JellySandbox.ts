/**
 * `JellySandbox`（issue #11 / T10）——第一個能玩的組裝：
 * `SimCore`（模擬）+ `JellyRenderer`（算繪）+ `PointerInput`（輸入）+ 固定步主迴圈。
 *
 * 主迴圈用 `FixedStepAccumulator`（+ 250ms clamp）把真實時間切成 60Hz 固定步推進
 * 求解器，每幀從求解器讀 `positions` 交給 Renderer 重繪。所有影響模擬的輸入都經
 * `PointerInput` → `sim.applyInput`，這裡不繞過（ADR-0005）。
 *
 * Camera 尚未實作（T12）——暫用「一次性 fit 到 Jelly 靜止 bbox」的固定變換，
 * resize 時重算。
 */

import { PointerInput } from '../input';
import { JellyRenderer, type CameraTransform, screenToWorld } from '../render';
import { type Bbox, SimCore } from '../sim';
import { createDefaultJelly } from './defaultJelly';
import { FixedStepAccumulator } from './FixedStepAccumulator';

const STEP_SECONDS = 1 / 60;
const FIT_MARGIN_PX = 80;

export class JellySandbox {
  private readonly sim: SimCore;
  private readonly renderer: JellyRenderer;
  private readonly input: PointerInput;
  private readonly accumulator = new FixedStepAccumulator(STEP_SECONDS);
  private readonly root: HTMLElement;
  /** Jelly 靜止 bbox（fit 用）。 */
  private readonly restBounds: Bbox;
  /** T12 Camera 之前的暫代變換；`fit()` 會改 `scale`。 */
  private readonly camera: CameraTransform;

  private rafId = 0;
  private lastFrameMs = 0;

  private constructor(root: HTMLElement, sim: SimCore, renderer: JellyRenderer, restBounds: Bbox) {
    this.root = root;
    this.sim = sim;
    this.renderer = renderer;
    this.restBounds = restBounds;
    this.camera = {
      x: (restBounds.minX + restBounds.maxX) / 2,
      y: (restBounds.minY + restBounds.maxY) / 2,
      scale: 1,
    };

    this.input = new PointerInput(renderer.canvas, {
      screenToWorld: (sx, sy) =>
        screenToWorld(this.camera, this.root.clientWidth, this.root.clientHeight, sx, sy),
      applyInput: (event) => this.sim.applyInput(event),
    });

    this.fit();
    window.addEventListener('resize', this.onResize);
  }

  /** 建立預設 Jelly 並組裝好；呼叫 `start()` 開始跑。 */
  static async create(root: HTMLElement): Promise<JellySandbox> {
    const { mesh, texture } = createDefaultJelly();
    const sim = new SimCore(mesh);
    const restBounds = sim.bbox(); // 建構當下 current == rest

    const renderer = await JellyRenderer.create({
      width: root.clientWidth,
      height: root.clientHeight,
      mesh,
      positions: sim.positions,
      texture,
      background: { color: 0x1a1a1a, alpha: 1 },
    });
    root.appendChild(renderer.canvas);

    return new JellySandbox(root, sim, renderer, restBounds);
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
    this.renderer.destroy();
  }

  private frame = (nowMs: number): void => {
    const steps = this.accumulator.advance((nowMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = nowMs;
    for (let i = 0; i < steps; i++) this.sim.step(STEP_SECONDS);

    this.renderer.setPositions(this.sim.positions);
    this.renderer.render();

    this.rafId = requestAnimationFrame(this.frame);
  };

  private onResize = (): void => this.fit();

  /** 把 Jelly 靜止 bbox 縮放置中進畫布（T12 Camera 之前的暫代）。 */
  private fit(): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    this.renderer.resize(w, h);
    const { minX, minY, maxX, maxY } = this.restBounds;
    this.camera.scale = Math.min(
      (w - FIT_MARGIN_PX) / Math.max(maxX - minX, 1),
      (h - FIT_MARGIN_PX) / Math.max(maxY - minY, 1),
    );
    this.renderer.setCamera(this.camera);
  }
}
