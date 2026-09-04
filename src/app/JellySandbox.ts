/**
 * `JellySandbox`（issue #11 / T10，issue #13 / T12 接入 Camera，issue #12 / T11
 * 接入拖放匯入）——第一個能玩的組裝：`SimCore`（模擬）+ `JellyRenderer`（算繪）+
 * `PointerInput`（輸入）+ `CameraInput`（相機手動輸入）+ 固定步主迴圈。
 *
 * 主迴圈用 `FixedStepAccumulator`（+ 250ms clamp）把真實時間切成 60Hz 固定步推進
 * 求解器；每幀再用**真實**幀時距（clamp 到 100ms）呼叫純函式 `updateCamera` 推進
 * 相機（平滑是視覺的、不進物理）。所有影響模擬的輸入都經 `PointerInput` →
 * `sim.applyInput`；所有相機手動輸入都經 `CameraInput` → 收集成 `CameraCommand[]`
 * 每幀餵給 `updateCamera`（ADR-0005：兩條輸入流都不繞過各自的窄介面）。
 *
 * picking／算繪都吃 `cameraState.transform`——相機平移／縮放後仍命中正確的表面點。
 *
 * **拖放匯入**：`DropImportInput`（薄的接線層，對照 `PointerInput`/`CameraInput`）
 * 挑出拖放的 PNG 檔案、讀成位元組後回呼 `importPng` → `buildSimMesh` → 換一套新的
 * `SimCore` + `JellyRenderer`（拓撲變了、舊 Mesh geometry 沒法沿用）。新 Renderer
 * 先建好、確定成功了才拆舊的，畫面不會有空檔；解碼／建網格失敗（非圖片、壞檔）
 * 一律 `console.warn` 後放棄，不影響原本的 Jelly。
 */

import {
  CameraInput,
  type CameraCommand,
  type CameraState,
  createCameraState,
  screenToWorld,
  updateCamera,
} from '../camera';
import { PointerInput } from '../input';
import { buildSimMesh, type SimMesh } from '../mesh';
import { JellyRenderer } from '../render';
import { SimCore } from '../sim';
import { createDefaultJelly } from './defaultJelly';
import { DropImportInput } from './DropImportInput';
import { FixedStepAccumulator } from './FixedStepAccumulator';

const STEP_SECONDS = 1 / 60;
/** 相機平滑用的單幀時距上限（分頁切回來不會讓相機瞬移）。 */
const CAMERA_MAX_DT = 0.1;
/** 拖曳中疊在畫面上的提示層 class（樣式見 `style.css`）。 */
const DROP_HINT_ACTIVE_CLASS = 'is-active';

export class JellySandbox {
  private sim: SimCore;
  private renderer: JellyRenderer;
  private input: PointerInput;
  private cameraInput: CameraInput;
  private readonly dropImportInput: DropImportInput;
  private readonly accumulator = new FixedStepAccumulator(STEP_SECONDS);
  private readonly root: HTMLElement;
  private readonly dropHint: HTMLDivElement;

  private cameraState: CameraState;
  /** `CameraInput` 逐事件塞入，主迴圈每幀取出餵 `updateCamera` 後清空。 */
  private cameraCommands: CameraCommand[] = [];
  /** 拖放匯入進行中——擋掉重疊的第二次匯入（連續拖放兩張圖不會互相打架）。 */
  private importing = false;

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

    ({ input: this.input, cameraInput: this.cameraInput } = this.attachInputHandlers(
      renderer.canvas,
    ));

    this.renderer.setCamera(this.cameraState.transform);
    window.addEventListener('resize', this.onResize);

    this.dropHint = this.createDropHint();
    root.appendChild(this.dropHint);
    this.dropImportInput = new DropImportInput(root, {
      onImport: this.onDropImport,
      onDragActiveChange: (active) =>
        this.dropHint.classList.toggle(DROP_HINT_ACTIVE_CLASS, active),
    });
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
      {
        width: root.clientWidth,
        height: root.clientHeight,
      },
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
    this.dropImportInput.destroy();
    this.dropHint.remove();
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

  /**
   * `DropImportInput` 挑到 PNG 位元組後的回呼：`buildSimMesh` → 解碼貼圖 →
   * 換掉整套 `SimCore` + `JellyRenderer`。任何一步失敗（非圖片、壞檔、貼圖
   * 解碼失敗）都在這個共用 try/catch 裡 `console.warn` 後放棄，原本的 Jelly
   * 不受影響（issue #12 驗收條件：「忽略、不崩」）。`importing` 擋掉重疊呼叫。
   */
  private onDropImport = (pngBytes: Uint8Array): void => {
    if (this.importing) return;
    this.importing = true;
    this.importPng(pngBytes)
      .catch((err: unknown) => console.warn('[jelly] PNG 匯入失敗，已略過', err))
      .finally(() => {
        this.importing = false;
      });
  };

  private async importPng(pngBytes: Uint8Array): Promise<void> {
    const mesh: SimMesh = buildSimMesh(pngBytes);
    const texture = await decodeTextureImage(pngBytes);
    await this.replaceJelly(mesh, texture);
  }

  /** 建好新的一套（sim + renderer + camera）成功後才拆舊的——畫面不會有空檔。 */
  private async replaceJelly(mesh: SimMesh, texture: HTMLImageElement): Promise<void> {
    const sim = new SimCore(mesh);
    const renderer = await JellyRenderer.create({
      width: this.root.clientWidth,
      height: this.root.clientHeight,
      mesh,
      positions: sim.positions,
      texture,
      background: { color: 0x1a1a1a, alpha: 1 },
    });

    this.input.destroy();
    this.cameraInput.destroy();
    this.renderer.destroy();
    this.root.appendChild(renderer.canvas); // dropHint 用 position:absolute + z-index，DOM 順序不影響疊放

    this.sim = sim;
    this.renderer = renderer;
    this.cameraState = createCameraState(
      { centroid: sim.centroid(), bbox: sim.bbox() },
      this.canvasSize(),
    );
    this.cameraCommands = [];
    ({ input: this.input, cameraInput: this.cameraInput } = this.attachInputHandlers(
      renderer.canvas,
    ));
    this.renderer.setCamera(this.cameraState.transform);
  }

  /** `PointerInput` + `CameraInput` 都吃同一組 project／hitTest；重新匯入後換綁到新 canvas。 */
  private attachInputHandlers(canvas: HTMLCanvasElement): {
    input: PointerInput;
    cameraInput: CameraInput;
  } {
    const project = (sx: number, sy: number) =>
      screenToWorld(this.cameraState.transform, this.canvasSize(), sx, sy);
    const hitTest = (world: { x: number; y: number }) => this.sim.pick(world.x, world.y) != null;

    const input = new PointerInput(canvas, {
      screenToWorld: project,
      hitTest,
      applyInput: (event) => this.sim.applyInput(event),
    });
    const cameraInput = new CameraInput(canvas, {
      screenToWorld: project,
      hitTest,
      emit: (cmd) => this.cameraCommands.push(cmd),
    });
    return { input, cameraInput };
  }

  private createDropHint(): HTMLDivElement {
    const hint = document.createElement('div');
    hint.className = 'jelly-drop-hint';
    hint.textContent = '放開以匯入這張圖片';
    return hint;
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
      this.canvasSize(),
      cmds,
      Math.min(Math.max(elapsed, 0), CAMERA_MAX_DT),
    );

    this.renderer.setPositions(this.sim.positions);
    this.renderer.setCamera(this.cameraState.transform);
    this.renderer.render();

    this.rafId = requestAnimationFrame(this.frame);
  };

  private onResize = (): void => {
    // 畫布尺寸交給 Renderer；相機下一幀的 `updateCamera` 會用新畫布尺寸重新 fit。
    this.renderer.resize(this.root.clientWidth, this.root.clientHeight);
  };

  private canvasSize(): { width: number; height: number } {
    return { width: this.root.clientWidth, height: this.root.clientHeight };
  }
}

/** PNG 位元組 → `HTMLImageElement`（Renderer 的貼圖來源）。走 Blob URL，載入完即釋放。 */
function decodeTextureImage(pngBytes: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([pngBytes as BlobPart], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('圖片解碼失敗'));
    };
    img.src = url;
  });
}
