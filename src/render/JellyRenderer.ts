/**
 * JellyRenderer（issue #10 / T9）——WebGL 每頂點 UV 三角網格算繪（Texture mesh）。
 *
 * 給 `SimMesh` 的靜態拓撲（`uv` + `indices`）與貼圖，之後每幀丟進變形後的頂點
 * `positions`（世界座標），用 PixiJS `Mesh` + `MeshGeometry`（WebGL）畫出扭曲的
 * 貼圖網格。頂點共用 → 三角形之間天然無縫。
 *
 * **只吃 `positions` 陣列**，不認得求解器（`SimCore`）。世界→螢幕變換透過
 * `setCamera` 傳入（T12 Camera 的輸出接這裡）。不使用 Canvas 2D 逐三角 `drawImage`。
 *
 * **網格線框**（debug 用，issue #14 追加）：`setWireframeVisible(true)` 疊一層
 * 半透明線框，逐三角形邊畫在貼圖之上，跟著同一份 `positions` 變形——診斷網格
 * 相關問題（sliver、翻面、Region 邊界）時可以直接看到三角化長什麼樣子。邊的
 * 拓撲（`computeWireframeEdges`）只在建構時算一次；預設隱藏，不影響一般畫面。
 *
 * **邊界外框**（issue #9 追加；issue #92 擴成三態）：`setBoundaryFrame(frame)` 畫出
 * 目前邊界的界線，讓撞牆／落地有畫面上看得到的線可以對照，不會覺得「明明沒碰到
 * 東西卻被彈回來」。`{ kind: 'box' }` 畫 Walled 的 AABB 外框；`{ kind: 'floor' }` 畫
 * 一條橫跨可視範圍的水平地板線（左右無限，畫多長由 `floorLineSpan` 依相機算，
 * 縮放／平移／resize 時重畫）；`null`（Infinite 模式）整層藏起來。幾何都是世界座
 * 標常數（`WalledBoundary.box`／`FloorBoundary.floorY`，不隨 Jelly 變形），只在邊界
 * 模式切換時重設。它**不是**提示，不受「播放時隱藏提示」影響。
 */

import {
  Application,
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  Texture,
  type TextureSourceLike,
} from 'pixi.js';

import {
  type CameraTransform,
  computeWireframeEdges,
  containerPosition,
  createTextureBuffers,
  floorLineSpan,
  type TextureMesh,
  writePositions,
} from './meshBuffers';

/** Walled 邊界的 AABB。跟 `../sim` 的 `Bbox` 結構相同，這裡獨立宣告——Renderer 不認得求解器（見檔頭）。 */
export interface WallBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 邊界外框的幾何（issue #92）：`box` = Walled 的 AABB、`floor` = 地板的世界 y
 * （左右無限延伸）。`null` = Infinite、不畫。
 */
export type BoundaryFrame = ({ kind: 'box' } & WallBounds) | { kind: 'floor'; y: number };

export interface JellyRendererOptions {
  /** 畫布寬 / 高（CSS 像素）。 */
  width: number;
  height: number;
  /** 靜態拓撲：`uv` + `indices`。 */
  mesh: TextureMesh;
  /** 初始頂點世界座標 `[x0, y0, ...]`。 */
  positions: ArrayLike<number>;
  /** 貼圖來源（原圖）：`HTMLImageElement` / `HTMLCanvasElement` / `ImageBitmap` / `Texture` …。 */
  texture: TextureSourceLike | Texture;
  /** 背景色（0xRRGGBB）與透明度。預設透明。 */
  background?: { color?: number; alpha?: number };
  /** 繪製解析度；預設裝置像素比（`autoDensity` 開，呼叫端只給 CSS 尺寸）。 */
  resolution?: number;
}

export class JellyRenderer {
  private readonly app: Application;
  private readonly world: Container;
  private readonly mesh: Mesh;
  private readonly geometry: MeshGeometry;
  /** 每幀就地覆寫、再交給 GPU 的頂點 buffer。 */
  private readonly positionBuffer: Float32Array;
  /** 每三角形三邊去重後的頂點索引對，建構時算一次（拓撲固定）。 */
  private readonly wireframeEdges: Uint32Array;
  private readonly wireframe: Graphics;
  private readonly boundaryFrame: Graphics;
  /** 目前邊界外框的幾何；`null` = Infinite（`boundaryFrame` 隱藏）。 */
  private boundary: BoundaryFrame | null = null;
  private camera: CameraTransform = { x: 0, y: 0, scale: 1 };
  private width: number;
  private height: number;

  private constructor(app: Application, opts: JellyRendererOptions) {
    this.app = app;
    this.width = opts.width;
    this.height = opts.height;

    const buffers = createTextureBuffers(opts.mesh, opts.positions);
    this.positionBuffer = buffers.positions;
    this.geometry = new MeshGeometry({
      positions: buffers.positions,
      uvs: buffers.uvs,
      indices: buffers.indices,
    });
    this.wireframeEdges = computeWireframeEdges(buffers.indices);

    const texture = opts.texture instanceof Texture ? opts.texture : Texture.from(opts.texture);
    this.mesh = new Mesh({ geometry: this.geometry, texture });

    this.wireframe = new Graphics();
    this.wireframe.visible = false;

    this.boundaryFrame = new Graphics();
    this.boundaryFrame.visible = false;

    this.world = new Container();
    this.world.addChild(this.mesh);
    this.world.addChild(this.wireframe); // 疊在貼圖之上
    this.world.addChild(this.boundaryFrame); // 最上層——邊框不該被網格線蓋住
    this.app.stage.addChild(this.world);

    this.applyCamera();
  }

  /** 非同步建立（PixiJS v8 的 `Application.init` 為 async）。 */
  static async create(opts: JellyRendererOptions): Promise<JellyRenderer> {
    const app = new Application();
    await app.init({
      width: opts.width,
      height: opts.height,
      resolution: opts.resolution ?? globalThis.devicePixelRatio ?? 1,
      autoDensity: true,
      antialias: true,
      preference: 'webgl', // itch.io / file:// 環境 WebGPU 常不可用
      backgroundColor: opts.background?.color ?? 0x000000,
      backgroundAlpha: opts.background?.alpha ?? 0,
      autoStart: false, // 由呼叫端主迴圈驅動 render()
    });
    return new JellyRenderer(app, opts);
  }

  /** PixiJS 建立／使用中的 canvas。掛進 DOM 用這個。 */
  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  /** 逐幀：更新變形後的頂點世界座標（長度須等於初始 `positions`）。 */
  setPositions(positions: ArrayLike<number>): void {
    writePositions(this.positionBuffer, positions);
    // 同一個 Float32Array 參照回設 → PixiJS 標記 buffer dirty、下次 render 重傳 GPU
    // （bufferSubData，不重配 GPU buffer）。
    this.geometry.positions = this.positionBuffer;
    if (this.wireframe.visible) this.redrawWireframe();
  }

  /** 世界→螢幕變換：`screen = (world − {x,y}) · scale + 畫布中心`。 */
  setCamera(camera: CameraTransform): void {
    this.camera = { ...camera };
    this.applyCamera();
    // 線框／邊框寬度都用 camera.scale 換算成固定螢幕像素（見 redrawWireframe、
    // redrawBoundaryFrame），縮放改變時要重畫一次，不然要等到下一次 setPositions /
    // setBoundaryFrame 才會用新的 scale；地板線的長度也跟著相機平移／縮放走。
    if (this.wireframe.visible) this.redrawWireframe();
    if (this.boundaryFrame.visible) this.redrawBoundaryFrame();
  }

  /** 網格線框開關（debug 用）。開啟時立即畫一次，不用等下一次 `setPositions`。 */
  setWireframeVisible(visible: boolean): void {
    this.wireframe.visible = visible;
    if (visible) this.redrawWireframe();
  }

  /**
   * 邊界外框（issue #9；issue #92 三態）：`box` 畫 Walled 的 AABB 外框、`floor` 畫
   * 地板線；`null`（Infinite 模式）整層藏起來。幾何是世界座標常數，只有邊界模式
   * 切換時才會變，不用每幀呼叫——呼叫端（`JellySandbox`）只在切換時重套一次。
   */
  setBoundaryFrame(frame: BoundaryFrame | null): void {
    this.boundary = frame;
    this.boundaryFrame.visible = frame != null;
    if (frame) this.redrawBoundaryFrame();
  }

  /** 畫布尺寸改變（CSS 像素）。地板線長度依畫布寬算，跟著重畫。 */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.app.renderer.resize(width, height);
    this.applyCamera();
    if (this.boundaryFrame.visible) this.redrawBoundaryFrame();
  }

  /** 畫一幀。呼叫端主迴圈每幀呼叫一次。 */
  render(): void {
    this.app.renderer.render(this.app.stage);
  }

  /** 釋放 GPU 資源與 canvas。 */
  destroy(): void {
    this.app.destroy({ removeView: true }, { children: true });
  }

  private applyCamera(): void {
    const p = containerPosition(this.camera, this.width, this.height);
    this.world.position.set(p.x, p.y);
    this.world.scale.set(this.camera.scale);
  }

  /**
   * 逐邊畫線：座標直接讀 `positionBuffer`（跟主網格同一份，天然同步變形）。
   * 線寬除以 `camera.scale`——`wireframe` 跟主網格一起被 `world.scale` 縮放，
   * 除掉那個縮放才能讓線框不管怎麼縮放都維持約 1 個螢幕像素粗。
   */
  private redrawWireframe(): void {
    this.wireframe.clear();
    const buf = this.positionBuffer;
    for (let i = 0; i < this.wireframeEdges.length; i += 2) {
      const a = this.wireframeEdges[i]!;
      const b = this.wireframeEdges[i + 1]!;
      this.wireframe.moveTo(buf[2 * a]!, buf[2 * a + 1]!);
      this.wireframe.lineTo(buf[2 * b]!, buf[2 * b + 1]!);
    }
    this.wireframe.stroke({ width: 1 / (this.camera.scale || 1), color: 0xff00ff, alpha: 0.85 });
  }

  /**
   * 畫 `boundary` 的界線：`box` 是矩形外框，`floor` 是橫跨可視範圍（`floorLineSpan`）
   * 的水平線。線寬同 `redrawWireframe` 除以 `camera.scale`，縮放不管多近多遠邊框線
   * 都維持約 3 個螢幕像素粗、清楚可辨；兩態共用同一組線寬顏色。
   */
  private redrawBoundaryFrame(): void {
    const frame = this.boundary;
    if (!frame) return;
    this.boundaryFrame.clear();
    if (frame.kind === 'box') {
      const { minX, minY, maxX, maxY } = frame;
      this.boundaryFrame.rect(minX, minY, maxX - minX, maxY - minY);
    } else {
      const { minX, maxX } = floorLineSpan(this.camera, this.width);
      this.boundaryFrame.moveTo(minX, frame.y).lineTo(maxX, frame.y);
    }
    this.boundaryFrame.stroke({
      width: 3 / (this.camera.scale || 1),
      color: 0x33aaff,
      alpha: 0.85,
    });
  }
}
