/**
 * JellyRenderer（issue #10 / T9；issue #95 / V3 T3-2 改成多網格）——WebGL 每頂點 UV 三角
 * 網格算繪（Texture mesh）。
 *
 * 場上每塊 Jelly 一個 PixiJS `Mesh` + `MeshGeometry`：`addJelly(id, mesh, positions,
 * texture)` 給靜態拓撲（`uv` + `indices`）、初始頂點與貼圖；之後每幀 `setPositions(id,
 * positions)` 丟進變形後的世界座標頂點。頂點共用 → 三角形之間天然無縫。
 * `removeJelly(id)` 釋放那塊的幾何（貼圖可能被別塊共用，不釋放）。**繪製順序依
 * `setJellyOrder(ids)` 給的順序**（後面的疊在上面）——呼叫端（`JellySandbox`）每幀用
 * `World.jellies()` 的 id 序列 diff 同步新增／移除／順序（後生成在上，ADR-0013）。
 *
 * **只吃 `positions` 陣列**，不認得求解器（`SimCore`／`World`）。世界→螢幕變換透過
 * `setCamera` 傳入（T12 Camera 的輸出接這裡）。不使用 Canvas 2D 逐三角 `drawImage`。
 *
 * **網格線框**（debug 用，issue #14 追加）：`setWireframeVisible(true)` 疊一層半透明
 * 線框，逐塊逐三角形邊畫在貼圖之上，跟著同一份 `positions` 變形——診斷網格相關問題
 * （sliver、翻面、Region 邊界）時可以直接看到三角化長什麼樣子。每塊的邊拓撲
 * （`computeWireframeEdges`）只在 `addJelly` 時算一次；預設隱藏，不影響一般畫面。
 *
 * **邊界外框**（issue #9 追加；issue #92 擴成三態）：`setBoundaryFrame(frame)` 畫出
 * 目前邊界的界線，讓撞牆／落地有畫面上看得到的線可以對照，不會覺得「明明沒碰到
 * 東西卻被彈回來」。`{ kind: 'walled' }` 畫 AABB 外框；`{ kind: 'floor' }` 畫一條橫跨
 * 可視範圍的水平地板線（左右無限，畫多長由 `visibleWorldSpanX` 依相機算，
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

import { visibleWorldSpanX } from '../camera/project';
import {
  type CameraTransform,
  computeWireframeEdges,
  containerPosition,
  createTextureBuffers,
  type TextureMesh,
  writePositions,
} from './meshBuffers';

/**
 * 邊界外框的幾何（issue #92）：`walled` = AABB 四邊（跟 `../sim` 的 `Bbox` 結構相同，
 * 這裡獨立宣告——Renderer 不認得求解器，見檔頭）、`floor` = 地板的世界 y（左右無限
 * 延伸）。`null` = Infinite、不畫。
 */
export type BoundaryFrame =
  | { kind: 'walled'; minX: number; minY: number; maxX: number; maxY: number }
  | { kind: 'floor'; y: number };

/** 地板線往可視範圍外多畫的倍數——平移一格內不會先看到線的盡頭才等重畫。 */
const FLOOR_LINE_OVERSCAN = 2;

export interface JellyRendererOptions {
  /** 畫布寬 / 高（CSS 像素）。 */
  width: number;
  height: number;
  /** 背景色（0xRRGGBB）與透明度。預設透明。 */
  background?: { color?: number; alpha?: number };
  /** 繪製解析度；預設裝置像素比（`autoDensity` 開，呼叫端只給 CSS 尺寸）。 */
  resolution?: number;
}

/** 一塊 Jelly 在算繪端的資源。 */
interface JellyEntry {
  mesh: Mesh;
  geometry: MeshGeometry;
  /** 每幀就地覆寫、再交給 GPU 的頂點 buffer。 */
  positionBuffer: Float32Array;
  /** 每三角形三邊去重後的頂點索引對，`addJelly` 時算一次（拓撲固定）。 */
  wireframeEdges: Uint32Array;
}

export class JellyRenderer {
  private readonly app: Application;
  private readonly world: Container;
  /** 所有 Jelly 的 `Mesh` 都掛在這層，子節點順序 = 繪製順序（`setJellyOrder`）。 */
  private readonly jellyLayer: Container;
  private readonly jellies = new Map<string, JellyEntry>();
  private readonly wireframe: Graphics;
  private readonly frameGraphics: Graphics;
  /** 目前邊界外框的幾何；`null` = Infinite（`frameGraphics` 隱藏）。 */
  private frame: BoundaryFrame | null = null;
  /**
   * 線框需要重畫（某塊位置更新／塊集合變了／相機縮放變了）。多塊時每幀會對每塊各
   * `setPositions` 一次，線框只在 `render()` 時重畫一次，不逐塊重畫。
   */
  private wireframeDirty = true;
  private camera: CameraTransform = { x: 0, y: 0, scale: 1 };
  private width: number;
  private height: number;

  private constructor(app: Application, opts: JellyRendererOptions) {
    this.app = app;
    this.width = opts.width;
    this.height = opts.height;

    this.jellyLayer = new Container();

    this.wireframe = new Graphics();
    this.wireframe.visible = false;

    this.frameGraphics = new Graphics();
    this.frameGraphics.visible = false;

    this.world = new Container();
    this.world.addChild(this.jellyLayer);
    this.world.addChild(this.wireframe); // 疊在所有貼圖之上
    this.world.addChild(this.frameGraphics); // 最上層——邊框不該被網格線蓋住
    this.app.stage.addChild(this.world);

    this.applyCamera();
  }

  /** 非同步建立（PixiJS v8 的 `Application.init` 為 async）。建好時場上沒有任何塊。 */
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

  // ---- jellies ----------------------------------------------------------------

  /**
   * 新增一塊：靜態拓撲 + 初始頂點世界座標 `[x0, y0, ...]` + 貼圖來源（原圖：
   * `HTMLImageElement` / `HTMLCanvasElement` / `ImageBitmap` / `Texture` …；多塊可共用
   * 同一張）。掛在目前繪製順序的最上面；已存在同 `id` 時丟錯（呼叫端先 diff）。
   */
  addJelly(
    id: string,
    mesh: TextureMesh,
    positions: ArrayLike<number>,
    texture: TextureSourceLike | Texture,
  ): void {
    if (this.jellies.has(id)) throw new Error(`JellyRenderer：id「${id}」已存在`);
    const buffers = createTextureBuffers(mesh, positions);
    const geometry = new MeshGeometry({
      positions: buffers.positions,
      uvs: buffers.uvs,
      indices: buffers.indices,
    });
    const tex = texture instanceof Texture ? texture : Texture.from(texture);
    const pixiMesh = new Mesh({ geometry, texture: tex });
    this.jellyLayer.addChild(pixiMesh);
    this.jellies.set(id, {
      mesh: pixiMesh,
      geometry,
      positionBuffer: buffers.positions,
      wireframeEdges: computeWireframeEdges(buffers.indices),
    });
    this.wireframeDirty = true;
  }

  /** 移除一塊並釋放它的幾何（貼圖不釋放——可能被別塊共用）。不存在 → no-op。 */
  removeJelly(id: string): void {
    const entry = this.jellies.get(id);
    if (!entry) return;
    this.jellies.delete(id);
    this.jellyLayer.removeChild(entry.mesh);
    entry.mesh.destroy({ texture: false, textureSource: false });
    this.wireframeDirty = true;
  }

  hasJelly(id: string): boolean {
    return this.jellies.has(id);
  }

  /** 目前有哪些塊（依繪製順序，先畫的在前）。 */
  jellyIds(): string[] {
    const ids: string[] = [];
    for (const child of this.jellyLayer.children) {
      for (const [id, entry] of this.jellies) if (entry.mesh === child) ids.push(id);
    }
    return ids;
  }

  /**
   * 重排繪製順序：`ids` 依「先畫 → 後畫」排列（後面的疊在上面），必須剛好涵蓋目前
   * 所有塊——呼叫端每幀用 `World.jellies()` 的順序餵，後生成在上（ADR-0013）。
   */
  setJellyOrder(ids: readonly string[]): void {
    if (ids.length !== this.jellies.size) {
      throw new Error(
        `JellyRenderer.setJellyOrder：給了 ${ids.length} 個 id，場上有 ${this.jellies.size} 塊`,
      );
    }
    ids.forEach((id, index) => {
      const entry = this.jellies.get(id);
      if (!entry) throw new Error(`JellyRenderer.setJellyOrder：沒有「${id}」這塊`);
      this.jellyLayer.setChildIndex(entry.mesh, index);
    });
  }

  /** 逐幀：更新某塊變形後的頂點世界座標（長度須等於 `addJelly` 時的 `positions`）。 */
  setPositions(id: string, positions: ArrayLike<number>): void {
    const entry = this.jellies.get(id);
    if (!entry) throw new Error(`JellyRenderer.setPositions：沒有「${id}」這塊`);
    writePositions(entry.positionBuffer, positions);
    // 同一個 Float32Array 參照回設 → PixiJS 標記 buffer dirty、下次 render 重傳 GPU
    // （bufferSubData，不重配 GPU buffer）。
    entry.geometry.positions = entry.positionBuffer;
    this.wireframeDirty = true;
  }

  // ---- camera / overlays --------------------------------------------------------

  /** 世界→螢幕變換：`screen = (world − {x,y}) · scale + 畫布中心`。 */
  setCamera(camera: CameraTransform): void {
    this.camera = { ...camera };
    this.applyCamera();
    // 線框／邊框寬度都用 camera.scale 換算成固定螢幕像素（見 redrawWireframe、
    // redrawBoundaryFrame），縮放改變時要重畫一次，不然要等到下一次 setPositions /
    // setBoundaryFrame 才會用新的 scale；地板線的長度也跟著相機平移／縮放走。
    this.wireframeDirty = true;
    if (this.frameGraphics.visible) this.redrawBoundaryFrame();
  }

  /** 網格線框開關（debug 用）。開啟時下一次 `render()` 就畫，不用等下一次 `setPositions`。 */
  setWireframeVisible(visible: boolean): void {
    this.wireframe.visible = visible;
    this.wireframeDirty = true;
  }

  /**
   * 邊界外框（issue #9；issue #92 三態）：`walled` 畫 AABB 外框、`floor` 畫地板線；
   * `null`（Infinite 模式）整層藏起來。幾何是世界座標常數，只有邊界模式切換時才會
   * 變，不用每幀呼叫——呼叫端（`JellySandbox`）只在切換時重套一次。
   */
  setBoundaryFrame(frame: BoundaryFrame | null): void {
    this.frame = frame;
    this.frameGraphics.visible = frame != null;
    if (frame) this.redrawBoundaryFrame();
  }

  /** 畫布尺寸改變（CSS 像素）。地板線長度依畫布寬算，跟著重畫。 */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.app.renderer.resize(width, height);
    this.applyCamera();
    if (this.frameGraphics.visible) this.redrawBoundaryFrame();
  }

  /** 畫一幀。呼叫端主迴圈每幀呼叫一次；線框看得到又有變動時先重畫一次。 */
  render(): void {
    if (this.wireframe.visible && this.wireframeDirty) this.redrawWireframe();
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
   * 逐塊逐邊畫線：座標直接讀各塊的 `positionBuffer`（跟主網格同一份，天然同步變形）。
   * 線寬除以 `camera.scale`——`wireframe` 跟主網格一起被 `world.scale` 縮放，
   * 除掉那個縮放才能讓線框不管怎麼縮放都維持約 1 個螢幕像素粗。
   */
  private redrawWireframe(): void {
    this.wireframeDirty = false;
    this.wireframe.clear();
    for (const entry of this.jellies.values()) {
      const buf = entry.positionBuffer;
      const edges = entry.wireframeEdges;
      for (let i = 0; i < edges.length; i += 2) {
        const a = edges[i]!;
        const b = edges[i + 1]!;
        this.wireframe.moveTo(buf[2 * a]!, buf[2 * a + 1]!);
        this.wireframe.lineTo(buf[2 * b]!, buf[2 * b + 1]!);
      }
    }
    this.wireframe.stroke({ width: 1 / (this.camera.scale || 1), color: 0xff00ff, alpha: 0.85 });
  }

  /**
   * 畫 `frame` 的界線：`walled` 是矩形外框，`floor` 是橫跨可視範圍（`visibleWorldSpanX`
   * 外擴 `FLOOR_LINE_OVERSCAN` 倍）的水平線。線寬同 `redrawWireframe` 除以
   * `camera.scale`，縮放不管多近多遠邊框線都維持約 3 個螢幕像素粗、清楚可辨；兩態
   * 共用同一組線寬顏色。
   */
  private redrawBoundaryFrame(): void {
    const frame = this.frame;
    if (!frame) return;
    this.frameGraphics.clear();
    if (frame.kind === 'walled') {
      const { minX, minY, maxX, maxY } = frame;
      this.frameGraphics.rect(minX, minY, maxX - minX, maxY - minY);
    } else {
      const { minX, maxX } = visibleWorldSpanX(this.camera, this.width, FLOOR_LINE_OVERSCAN);
      this.frameGraphics.moveTo(minX, frame.y).lineTo(maxX, frame.y);
    }
    this.frameGraphics.stroke({
      width: 3 / (this.camera.scale || 1),
      color: 0x33aaff,
      alpha: 0.85,
    });
  }
}
