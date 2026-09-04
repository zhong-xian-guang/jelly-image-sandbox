/**
 * JellyRenderer（issue #10 / T9）——WebGL 每頂點 UV 三角網格算繪。
 *
 * 給 `SimMesh` 的靜態拓撲（`uv` + `indices`）與貼圖，之後每幀丟進變形後的頂點
 * `positions`（世界座標），用 PixiJS `Mesh` + `MeshGeometry`（WebGL）畫出扭曲的
 * 貼圖網格。頂點共用 → 三角形之間天然無縫。
 *
 * **只吃 `positions` 陣列**，不認得求解器（`SimCore`）。世界→螢幕變換透過
 * `setView` 傳入（T12 Camera 的輸出接這裡）。不使用 Canvas 2D 逐三角 `drawImage`。
 */

import {
  Application,
  Container,
  Mesh,
  MeshGeometry,
  Texture,
  type TextureSourceLike,
} from 'pixi.js';

import {
  containerPosition,
  createRenderBuffers,
  type RenderMesh,
  writePositions,
} from './meshBuffers';

export interface JellyRendererOptions {
  /** 畫布像素寬 / 高（CSS 像素 × resolution）。 */
  width: number;
  height: number;
  /** 靜態拓撲：`uv` + `indices`。 */
  mesh: RenderMesh;
  /** 初始頂點世界座標 `[x0, y0, ...]`。 */
  positions: ArrayLike<number>;
  /** 貼圖來源（原圖）：`HTMLImageElement` / `HTMLCanvasElement` / `ImageBitmap` / `Texture` …。 */
  texture: TextureSourceLike | Texture;
  /** 既有 canvas；不給則自建一個（`renderer.canvas` 取得）。 */
  canvas?: HTMLCanvasElement;
  /** 背景色（0xRRGGBB）與透明度。預設透明。 */
  background?: { color?: number; alpha?: number };
  /** MSAA 抗鋸齒。預設 true。 */
  antialias?: boolean;
  /** devicePixelRatio。預設 1（呼叫端自行把 width/height 乘好）。 */
  resolution?: number;
}

export class JellyRenderer {
  private readonly app: Application;
  private readonly world: Container;
  private readonly mesh: Mesh;
  private readonly geometry: MeshGeometry;
  /** 每幀就地覆寫、再交給 GPU 的頂點 buffer。 */
  private readonly positionBuffer: Float32Array;
  private view = { x: 0, y: 0, scale: 1 };
  private width: number;
  private height: number;

  private constructor(app: Application, opts: JellyRendererOptions) {
    this.app = app;
    this.width = opts.width;
    this.height = opts.height;

    const buffers = createRenderBuffers(opts.mesh, opts.positions);
    this.positionBuffer = buffers.positions;
    this.geometry = new MeshGeometry({
      positions: buffers.positions,
      uvs: buffers.uvs,
      indices: buffers.indices,
    });

    const texture = opts.texture instanceof Texture ? opts.texture : Texture.from(opts.texture);
    this.mesh = new Mesh({ geometry: this.geometry, texture });

    this.world = new Container();
    this.world.addChild(this.mesh);
    this.app.stage.addChild(this.world);

    this.applyView();
  }

  /** 非同步建立（PixiJS v8 的 `Application.init` 為 async）。 */
  static async create(opts: JellyRendererOptions): Promise<JellyRenderer> {
    const app = new Application();
    await app.init({
      canvas: opts.canvas,
      width: opts.width,
      height: opts.height,
      resolution: opts.resolution ?? 1,
      autoDensity: false,
      antialias: opts.antialias ?? true,
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
    // 同一個 Float32Array 參照回設 → PixiJS 標記 buffer dirty、下次 render 重傳 GPU。
    this.geometry.positions = this.positionBuffer;
  }

  /** 世界→螢幕變換：`screen = (world − {x,y}) · scale + 畫布中心`。 */
  setView(view: { x: number; y: number; scale: number }): void {
    this.view = { ...view };
    this.applyView();
  }

  /** 畫布尺寸改變（CSS 像素 × resolution）。 */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.app.renderer.resize(width, height);
    this.applyView();
  }

  /** 畫一幀。呼叫端主迴圈每幀呼叫一次。 */
  render(): void {
    this.app.renderer.render(this.app.stage);
  }

  /** 釋放 GPU 資源與 canvas。 */
  destroy(): void {
    this.app.destroy({ removeView: true }, { children: true });
  }

  private applyView(): void {
    const p = containerPosition(this.view, this.width, this.height);
    this.world.position.set(p.x, p.y);
    this.world.scale.set(this.view.scale);
  }
}
