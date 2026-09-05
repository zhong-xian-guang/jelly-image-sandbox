/**
 * `JellySandbox`（issue #11 / T10，issue #13 / T12 接入 Camera，issue #12 / T11
 * 接入拖放匯入，issue #14 / T13 接入控制面板）——第一個能玩的組裝：`SimCore`
 * （模擬）+ `JellyRenderer`（算繪）+ `PointerInput`（輸入）+ `CameraInput`
 * （相機手動輸入）+ 固定步主迴圈。
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
 * 一律 `console.warn` 後放棄，不影響原本的 Jelly。匯入時把控制面板目前設定
 * （Softness、輕拍力道、Boundary 模式）重新套到新的 `SimCore`，面板不會顯示跟
 * 實際物理不一致的值。`importHint`（issue #12 追加）是常駐在角落的低調小字，
 * 提示「可以拖 PNG 進來」——`dropHint` 只在拖曳中才出現，沒有這個常駐提示的話
 * 使用者無從發現這個功能本身存在。
 *
 * **控制面板**：`ControlPanel`（同樣是薄的 DOM 接線層）建 UI、回呼往外送；實際
 * 換算邏輯都在純函式模組——Softness 曲線見 `../sim/softness`，Walled 邊界範圍見
 * `./walledBounds`，Pin 模式的輸入轉接見 `../input/pinModeRouting`（開啟 Pin 模式
 * 後，`PointerInput` 原本會發的 `grab` 改由它轉成 `pin`，直接放 Pin 而非可拖曳
 * 的 Grab；點在既有 Pin 附近則轉成 `unpin`，即「點掉特定 Pin」）。
 *
 * **Pin 的視覺提示**：`PinMarkers`（DOM 覆蓋層）每幀把 `sim.listPins()` 的世界
 * 座標投影成螢幕座標畫成小圓點；Pin 模式開啟時標記變紅脈動（提示可以點掉）、
 * 畫布游標也換成十字——兩層一起讓「現在是不是在 Pin 模式」不用低頭看面板就
 * 知道（見 `setPinMode`）。「顯示 Pin」關掉時整層藏起來、`frame()` 也跳過投影
 * 計算（見 `setPinsVisible`）；`ControlPanel` 那邊會同時鎖住 Pin 模式／清除所有
 * Pin，所見即所得。
 *
 * **牆壁邊框**（issue #9 追加）：切到 Walled 邊界時，`WalledBoundary.box`（世界
 * 座標常數）同步畫成 `JellyRenderer` 裡的一個外框（見 `setWallBounds`），撞牆
 * 時看得到界線在哪，不會覺得「明明沒碰到東西卻被彈回來」。切回 Infinite 或
 * 重新匯入圖片都會同步藏起來／重套（`applyBoundaryMode`、`replaceJelly`）。
 */

import {
  CameraInput,
  type CameraCommand,
  type CameraState,
  createCameraState,
  screenToWorld,
  updateCamera,
  worldToScreen,
} from '../camera';
import { PointerInput, routeForPinMode } from '../input';
import { buildSimMesh, type SimMesh } from '../mesh';
import { JellyRenderer } from '../render';
import {
  type Bbox,
  type BoundaryMode,
  InfiniteBoundary,
  SimCore,
  softnessToParams,
  WalledBoundary,
} from '../sim';
import { ControlPanel } from './ControlPanel';
import { createDefaultJelly } from './defaultJelly';
import { DropImportInput } from './DropImportInput';
import { FixedStepAccumulator } from './FixedStepAccumulator';
import { PinMarkers } from './PinMarkers';
import { computeWalledBounds } from './walledBounds';

const STEP_SECONDS = 1 / 60;
/** 相機平滑用的單幀時距上限（分頁切回來不會讓相機瞬移）。 */
const CAMERA_MAX_DT = 0.1;
/** 拖曳中疊在畫面上的提示層 class（樣式見 `style.css`）。 */
const DROP_HINT_ACTIVE_CLASS = 'is-active';
/**
 * 輕拍力道滑桿的範圍；中點 = `DEFAULT_SIM_PARAMS.tapStrength`（6000）——同
 * `../sim/softness` 的理由，滑桿沒被動過時中點顯示的值要跟實際生效的一致。
 */
const TAP_STRENGTH_RANGE = { min: 1000, max: 11000, step: 100 };
/** Softness 滑桿初始位置（0–1 中點 = `DEFAULT_SIM_PARAMS`，見 `../sim/softness`）。 */
const DEFAULT_SOFTNESS = 0.5;
/**
 * Pin 模式下「點掉既有 Pin」的判定半徑，螢幕像素——跟 `.jelly-pin-marker` 的
 * CSS 直徑（16px）同數量級，換算回世界座標時要除以目前相機縮放（見
 * `pinModeContext`），這樣判定範圍不會隨縮放忽大忽小。
 */
const PIN_REMOVE_RADIUS_PX = 16;

export class JellySandbox {
  private sim: SimCore;
  private renderer: JellyRenderer;
  private input: PointerInput;
  private cameraInput: CameraInput;
  private readonly dropImportInput: DropImportInput;
  private readonly controlPanel: ControlPanel;
  private readonly pinMarkers: PinMarkers;
  private readonly accumulator = new FixedStepAccumulator(STEP_SECONDS);
  private readonly root: HTMLElement;
  private readonly dropHint: HTMLDivElement;
  private readonly importHint: HTMLDivElement;

  private cameraState: CameraState;
  /** `CameraInput` 逐事件塞入，主迴圈每幀取出餵 `updateCamera` 後清空。 */
  private cameraCommands: CameraCommand[] = [];
  /** 拖放匯入進行中——擋掉重疊的第二次匯入（連續拖放兩張圖不會互相打架）。 */
  private importing = false;
  /** 目前的 Boundary 模式——`SimCore` 沒有 getter，重新匯入圖片時要靠這個重套。 */
  private boundaryMode: BoundaryMode = 'infinite';
  /** `walled` 時目前的牆壁 AABB（給 `JellyRenderer.setWallBounds` 畫外框），`infinite` 時為 `null`。 */
  private wallBox: Bbox | null = null;
  /** 控制面板「Pin 模式」開關；`attachInputHandlers` 的 `applyInput` 靠它轉接。 */
  private pinModeEnabled = false;
  /** 「顯示 Pin」開關——關閉時 `pinMarkers` 整層藏起來、跳過每幀的投影計算。 */
  private pinsVisible = true;
  /** 網格線框開關（debug 用）——`SimCore` 沒有它，重新匯入圖片時要靠這個重套。 */
  private wireframeVisible = false;

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
    this.importHint = this.createImportHint();
    root.appendChild(this.importHint);
    this.dropImportInput = new DropImportInput(root, {
      onImport: this.onDropImport,
      onDragActiveChange: (active) =>
        this.dropHint.classList.toggle(DROP_HINT_ACTIVE_CLASS, active),
    });

    this.controlPanel = new ControlPanel({
      initial: {
        boundary: this.boundaryMode,
        softness: DEFAULT_SOFTNESS,
        tapStrength: this.sim.params.tapStrength,
        pinMode: this.pinModeEnabled,
        showPins: this.pinsVisible,
        followLocked: !this.cameraState.followEnabled,
        showWireframe: this.wireframeVisible,
      },
      tapStrengthRange: TAP_STRENGTH_RANGE,
      onBoundaryChange: (mode) => this.setBoundaryMode(mode),
      onSoftnessChange: (t) => this.setSoftness(t),
      onTapStrengthChange: (strength) => this.setTapStrength(strength),
      onPinModeChange: (enabled) => this.setPinMode(enabled),
      onClearPins: () => this.sim.clearPins(),
      onShowPinsChange: (visible) => this.setPinsVisible(visible),
      onFollowLockChange: (locked) => this.setFollowLock(locked),
      onFrameJelly: () => this.frameJelly(),
      onReset: () => this.sim.reset(),
      onWireframeChange: (visible) => this.setWireframeVisible(visible),
    });
    root.appendChild(this.controlPanel.element);

    this.pinMarkers = new PinMarkers();
    root.appendChild(this.pinMarkers.element);
    this.applyPinModeCursor();
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
    this.importHint.remove();
    this.controlPanel.destroy();
    this.pinMarkers.destroy();
    this.input.destroy();
    this.cameraInput.destroy();
    this.renderer.destroy();
  }

  /** 「鎖定跟隨」開關（issue #14 控制面板接這裡）——關掉自動跟隨，手動仍可動。 */
  setFollowLock(locked: boolean): void {
    this.cameraCommands.push({ type: 'setFollow', enabled: !locked });
  }

  /**
   * 「框住果凍」按鈕（issue #14）——一次性緩動 fit 當前 bbox。純一次性動作，
   * 不碰「鎖定跟隨」狀態（`updateCamera` 的 `frame` 指令不改 `followEnabled`），
   * 按這顆鈕不會讓控制面板的「鎖定跟隨」勾選框跟實際狀態對不上。
   */
  frameJelly(): void {
    this.cameraCommands.push({ type: 'frame' });
  }

  /**
   * Boundary 切換（issue #14）：`walled` 用目前 bbox 算一個正方形邊界範圍（見
   * `./walledBounds`）、`infinite` 換回無邊界。記在 `boundaryMode`——`replaceJelly`
   * 換新 `SimCore` 時要重套，否則面板顯示的模式會跟實際物理不一致。同時把
   * `wallBox` 套到 Renderer（issue #9 追加）：撞牆時畫面上有外框可以對照，
   * 不會覺得「明明沒碰到東西卻被彈回來」。
   */
  private setBoundaryMode(mode: BoundaryMode): void {
    this.boundaryMode = mode;
    this.applyBoundaryMode(this.sim);
    this.renderer.setWallBounds(this.wallBox);
  }

  /** 套用 `boundaryMode` 到 `sim`，並同步 `wallBox`（`replaceJelly` 換新 Renderer 後要另外重套，見該處）。 */
  private applyBoundaryMode(sim: SimCore): void {
    if (this.boundaryMode === 'walled') {
      const boundary = new WalledBoundary(computeWalledBounds(sim.bbox()));
      sim.setBoundary(boundary);
      this.wallBox = boundary.box;
    } else {
      sim.setBoundary(new InfiniteBoundary());
      this.wallBox = null;
    }
  }

  /** Softness 滑桿（issue #14）：0–1 → `cellFrac` + `alphaSm`（見 `../sim/softness`）。 */
  private setSoftness(t: number): void {
    const { cellFrac, alphaSm } = softnessToParams(t);
    this.sim.params.cellFrac = cellFrac;
    this.sim.params.alphaSm = alphaSm;
    this.sim.rebuildRegions();
  }

  /** 輕拍力道滑桿（issue #14）。 */
  private setTapStrength(strength: number): void {
    this.sim.params.tapStrength = strength;
  }

  /**
   * 「Pin 模式」開關（issue #14）——`attachInputHandlers` 的 `applyInput` 靠
   * `pinModeEnabled` 轉接；這裡順便切畫布游標（十字）跟 Pin 標記的「可點掉」
   * 視覺（紅色脈動），兩者都是純粹的提示，不影響任何判定邏輯。
   */
  private setPinMode(enabled: boolean): void {
    this.pinModeEnabled = enabled;
    this.applyPinModeCursor();
    this.pinMarkers.setRemovable(enabled);
  }

  private applyPinModeCursor(): void {
    this.renderer.canvas.style.cursor = this.pinModeEnabled ? 'crosshair' : '';
  }

  /**
   * 「顯示 Pin」開關——只管標記的顯示／隱藏。`ControlPanel` 那邊已經在使用者
   * 關掉顯示時順便把「Pin 模式」的勾選框也一起強制關掉（所見即所得），這裡
   * 不用重複處理；只要單純記著這個旗標，`frame()` 每幀據此決定要不要投影更新。
   */
  private setPinsVisible(visible: boolean): void {
    this.pinsVisible = visible;
    this.pinMarkers.setVisible(visible);
  }

  /** 「顯示網格」開關（issue #14 追加，debug 用）——記在 `wireframeVisible`，`replaceJelly` 換新 `JellyRenderer` 時要重套。 */
  private setWireframeVisible(visible: boolean): void {
    this.wireframeVisible = visible;
    this.renderer.setWireframeVisible(visible);
  }

  /**
   * `removeRadius` 換算成螢幕像素、再除以目前的相機縮放（`transform.scale`）
   * 換回世界座標——這樣不管縮多近多遠，「點多靠近算點中一個 Pin」在螢幕上看
   * 起來永遠是同樣大小（跟 Pin 標記本身固定的 CSS 像素直徑一致）。原本用
   * 「bbox 對角線的固定比例」是世界座標常數，縮得越近，同一個世界半徑換算成
   * 螢幕像素就越大，會出現「明明離標記很遠，點下去卻被當成點中」的錯覺。
   */
  private pinModeContext(): { pins: ReturnType<SimCore['listPins']>; removeRadius: number } {
    return {
      pins: this.sim.listPins(),
      removeRadius: PIN_REMOVE_RADIUS_PX / this.cameraState.transform.scale,
    };
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

  /**
   * 建好新的一套（sim + renderer + camera）成功後才拆舊的——畫面不會有空檔。
   * 新 `SimCore` 一律從 `DEFAULT_SIM_PARAMS` 起家，所以要把控制面板目前設定
   * （Softness、輕拍力道、Boundary 模式）重新套上去，面板才不會顯示跟實際物理
   * 不一致的值（Pin 模式是 `JellySandbox` 層的路由旗標，不受換 `SimCore` 影響，
   * 不用重套）。
   */
  private async replaceJelly(mesh: SimMesh, texture: HTMLImageElement): Promise<void> {
    const sim = new SimCore(mesh);
    sim.params.cellFrac = this.sim.params.cellFrac;
    sim.params.alphaSm = this.sim.params.alphaSm;
    sim.params.tapStrength = this.sim.params.tapStrength;
    sim.rebuildRegions();
    this.applyBoundaryMode(sim);

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
    this.applyPinModeCursor(); // 新 canvas 是全新元素，游標樣式要重套
    this.renderer.setWireframeVisible(this.wireframeVisible); // 新 JellyRenderer 預設隱藏，要重套
    this.renderer.setWallBounds(this.wallBox); // 新 JellyRenderer 預設沒有牆框，要重套
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
      applyInput: (event) => {
        const routed = routeForPinMode(event, this.pinModeEnabled, this.pinModeContext());
        if (routed) this.sim.applyInput(routed);
      },
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

  /**
   * 常駐的匯入提示（issue #12 追加）——`jelly-drop-hint` 只在拖曳中才顯示，
   * 使用者不會知道「拖 PNG 進來可以匯入」這個功能本身存在。低調小字放在角落，
   * 不擋任何操作、拖曳時會被上面的 `jelly-drop-hint` 蓋住。
   */
  private createImportHint(): HTMLDivElement {
    const hint = document.createElement('div');
    hint.className = 'jelly-import-hint';
    hint.textContent = '拖曳一張帶透明背景的 PNG 到畫面上以匯入';
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

    if (this.pinsVisible) {
      const canvasSize = this.canvasSize();
      this.pinMarkers.update(
        this.sim.listPins().map((pin) => {
          const screen = worldToScreen(
            this.cameraState.transform,
            canvasSize,
            pin.point.x,
            pin.point.y,
          );
          return { id: String(pin.id), x: screen.x, y: screen.y };
        }),
      );
    }

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
