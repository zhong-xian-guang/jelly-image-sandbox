/**
 * Jelly 互撞 prototype 的頁面殼（issue #94 / V3 T3-1）。拋棄式，非產品程式，只在
 * `npm run dev` 下跑：`/prototypes/jelly-collision.prototype.html`。
 *
 * 邏輯全在 `jelly-collision.core.prototype.ts`；這裡只做：兩種形狀（真實
 * `buildSimMesh` 管線）、生成／清空／四個情境、拖曳、Canvas 2D 畫圖、量測顯示。
 */

import { canvasToPng, drawDefaultTexture } from '../src/app';
import { BOUNDARY_FRICTION } from '../src/app/boundaryGeometry';
import { buildSimMesh, scaleMeshToLongestEdge, type SimMesh } from '../src/mesh';
import { WalledBoundary } from '../src/sim';
import {
  DEFAULT_COLLISION,
  SplitSimCore,
  stepWorld,
  type Algorithm,
  type CollisionParams,
  type CollisionStats,
} from './jelly-collision.core.prototype';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const cv = $<HTMLCanvasElement>('cv');
const stage = $('stage');
const ctx = cv.getContext('2d')!;
const errEl = $('err');

// ---- 世界 ---------------------------------------------------------------------------

/** 有牆桌面（世界單位 = mask px）。地板在 maxY，牆有 A 包的摩擦常數。 */
const WORLD = { minX: 0, minY: 0, maxX: 1600, maxY: 1000 };
const walls = new WalledBoundary({ ...WORLD, friction: BOUNDARY_FRICTION });
/** 每塊最長邊縮到這麼大（B 包的匯入尺寸），10 塊才堆得進桌面。 */
const JELLY_SIZE = 200;
const DT = 1 / 60;

type ShapeId = 'jelly' | 'brick';
const shapes = new Map<ShapeId, SimMesh>();

function drawBrick(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e0a04a';
  g.beginPath();
  g.roundRect(8, 8, 496, 240, 40);
  g.fill();
  return c;
}

function buildShapes(): void {
  shapes.set('jelly', scaleMeshToLongestEdge(buildSimMesh(canvasToPng(drawDefaultTexture())), JELLY_SIZE));
  shapes.set('brick', scaleMeshToLongestEdge(buildSimMesh(canvasToPng(drawBrick())), JELLY_SIZE));
}

function meshBBox(m: SimMesh) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < m.positions.length; i += 2) {
    minX = Math.min(minX, m.positions[i]!);
    maxX = Math.max(maxX, m.positions[i]!);
    minY = Math.min(minY, m.positions[i + 1]!);
    maxY = Math.max(maxY, m.positions[i + 1]!);
  }
  return { minX, minY, maxX, maxY };
}

interface JellyEntry {
  sim: SplitSimCore;
  shape: ShapeId;
  hue: number;
}
const jellies: JellyEntry[] = [];
let nextId = 1;
const params: CollisionParams = { ...DEFAULT_COLLISION };
let gravity = 3000;
let gravityOn = true;
let collideOn = true;
let substeps = 4;

/** 生成一塊：以 (cx, cy) 為 bbox 中心，rest = 形狀網格平移後的座標。回傳 id。 */
function spawn(shape: ShapeId, cx: number, cy: number): number {
  const base = shapes.get(shape)!;
  const bb = meshBBox(base);
  const dx = cx - (bb.minX + bb.maxX) / 2;
  const dy = cy - (bb.minY + bb.maxY) / 2;
  const positions = new Float32Array(base.positions.length);
  for (let i = 0; i < positions.length; i += 2) {
    positions[i] = base.positions[i]! + dx;
    positions[i + 1] = base.positions[i + 1]! + dy;
  }
  const mesh: SimMesh = { positions, indices: base.indices, uv: base.uv, restAreas: base.restAreas };
  const id = nextId++;
  const sim = new SplitSimCore(id, mesh, { gravity: gravityOn ? gravity : 0 });
  sim.setBoundary(walls);
  jellies.push({ sim, shape, hue: (id * 67) % 360 });
  return id;
}

function shapeHalfHeight(shape: ShapeId): number {
  const bb = meshBBox(shapes.get(shape)!);
  return (bb.maxY - bb.minY) / 2;
}

function clearAll(): void {
  jellies.length = 0;
  pileTimer = null;
  for (const id of [...grabs.keys()]) grabs.delete(id);
}

function setGravityAll(): void {
  for (const b of jellies) b.sim.params.gravity = gravityOn ? gravity : 0;
}

// ---- 情境 -----------------------------------------------------------------------------

let pileTimer: { remaining: number; countdown: number; x: number } | null = null;
/** 情境 ④ 掉什麼：純磚（會堆成一疊）、純果凍（圓的會滾開）、交替。 */
let pileShape: ShapeId | 'mix' = 'brick';
/** 情境 ① 上面那塊的 x 偏移（掃描用，console 可改）。 */
let stackOffset = 10;
const FLOOR = WORLD.maxY;
const MID_X = (WORLD.minX + WORLD.maxX) / 2;

const scenarios: Record<string, () => void> = {
  stack() {
    clearAll();
    gravityOn = true;
    syncToggles();
    const hb = shapeHalfHeight('brick');
    spawn('brick', MID_X, FLOOR - hb - 1);
    spawn('brick', MID_X + stackOffset, FLOOR - 3 * hb - 3);
  },
  drop() {
    clearAll();
    gravityOn = true;
    syncToggles();
    const hb = shapeHalfHeight('brick');
    spawn('brick', MID_X, FLOOR - hb - 1);
    spawn('jelly', MID_X, FLOOR - 700);
  },
  dropFloor() {
    clearAll();
    gravityOn = true;
    syncToggles();
    spawn('jelly', MID_X, FLOOR - 700);
  },
  ram() {
    clearAll();
    gravityOn = false;
    syncToggles();
    spawn('jelly', MID_X - 300, 500);
    spawn('brick', MID_X + 150, 500);
  },
  pile() {
    clearAll();
    gravityOn = true;
    syncToggles();
    pileTimer = { remaining: 10, countdown: 0, x: MID_X };
  },
};

/** 情境 ④ 的定序生成：每 0.25 s 一塊、x 依固定序列左右偏（決定性，不用亂數）。 */
const PILE_OFFSETS = [0, 25, -20, 15, -25, 20, -10, 25, -15, 5];
function tickPile(dt: number): void {
  if (!pileTimer) return;
  pileTimer.countdown -= dt;
  if (pileTimer.countdown > 0) return;
  const k = 10 - pileTimer.remaining;
  spawn(pileShape === 'mix' ? (k % 2 === 0 ? 'brick' : 'jelly') : pileShape, pileTimer.x + PILE_OFFSETS[k]!, 120);
  pileTimer.remaining--;
  pileTimer.countdown = 0.25;
  if (pileTimer.remaining <= 0) pileTimer = null;
}

// ---- 相機（固定：桌面 letterbox 進 canvas） ---------------------------------------------

let scale = 1;
let ox = 0;
let oy = 0;
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = Math.min(w / (WORLD.maxX - WORLD.minX), h / (WORLD.maxY - WORLD.minY)) * 0.96;
  ox = (w - (WORLD.maxX - WORLD.minX) * scale) / 2;
  oy = (h - (WORLD.maxY - WORLD.minY) * scale) / 2;
}
const toWorld = (sx: number, sy: number) => ({
  x: (sx - ox) / scale + WORLD.minX,
  y: (sy - oy) / scale + WORLD.minY,
});
const toScreenX = (x: number) => (x - WORLD.minX) * scale + ox;
const toScreenY = (y: number) => (y - WORLD.minY) * scale + oy;

// ---- 輸入 -------------------------------------------------------------------------------

const grabs = new Map<number, JellyEntry>();
let cursor = { x: MID_X, y: 300 };

stage.addEventListener('pointerdown', (e) => {
  const p = toWorld(e.offsetX, e.offsetY);
  cursor = p;
  if (e.button === 2) {
    spawn(shapeSel.value as ShapeId, p.x, p.y);
    return;
  }
  if (e.button !== 0) return;
  // 依 id 倒序（最後生成在最上面）：第一個成功建立 Grab 的塊拿走這個指標。
  for (const b of [...jellies].sort((x, y) => y.sim.id - x.sim.id)) {
    const before = b.sim.grabCount;
    b.sim.applyInput({ type: 'grab', id: e.pointerId, x: p.x, y: p.y });
    if (b.sim.grabCount > before) {
      grabs.set(e.pointerId, b);
      stage.setPointerCapture(e.pointerId);
      break;
    }
  }
});
stage.addEventListener('pointermove', (e) => {
  const p = toWorld(e.offsetX, e.offsetY);
  cursor = p;
  const b = grabs.get(e.pointerId);
  if (b) b.sim.applyInput({ type: 'moveGrab', id: e.pointerId, x: p.x, y: p.y });
});
const endGrab = (e: PointerEvent) => {
  const b = grabs.get(e.pointerId);
  if (!b) return;
  b.sim.applyInput({ type: 'release', id: e.pointerId });
  grabs.delete(e.pointerId);
};
stage.addEventListener('pointerup', endGrab);
stage.addEventListener('pointercancel', endGrab);
stage.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.key === 's' || e.key === 'S') spawn(shapeSel.value as ShapeId, cursor.x, cursor.y);
});

// ---- 面板 ------------------------------------------------------------------------------

const shapeSel = $<HTMLSelectElement>('shape');
const gravityOnEl = $<HTMLInputElement>('gravityOn');
const collideOnEl = $<HTMLInputElement>('collideOn');
const algEl = $<HTMLSelectElement>('algorithm');
const wireEl = $<HTMLInputElement>('wire');
const markPenEl = $<HTMLInputElement>('markPen');

function bindRange(id: string, get: () => number, set: (v: number) => void): void {
  const input = $<HTMLInputElement>(id);
  const out = input.nextElementSibling as HTMLOutputElement;
  const show = () => (out.value = String(get()));
  input.value = String(get());
  show();
  input.addEventListener('input', () => {
    set(Number(input.value));
    show();
  });
}
bindRange('gravity', () => gravity, (v) => ((gravity = v), setGravityAll()));
bindRange('impactAbsorb', () => params.impactAbsorb, (v) => (params.impactAbsorb = v));
bindRange('rounds', () => params.rounds, (v) => (params.rounds = v));
bindRange('particleShare', () => params.particleShare, (v) => (params.particleShare = v));
bindRange('friction', () => params.friction, (v) => (params.friction = v));
bindRange('skin', () => params.skin, (v) => (params.skin = v));
bindRange('gridCell', () => params.gridCell, (v) => (params.gridCell = v));
bindRange('particleRadius', () => params.particleRadius, (v) => (params.particleRadius = v));
bindRange('substeps', () => substeps, (v) => (substeps = v));
gravityOnEl.addEventListener('change', () => ((gravityOn = gravityOnEl.checked), setGravityAll()));
collideOnEl.addEventListener('change', () => (collideOn = collideOnEl.checked));
const surfaceOnlyEl = $<HTMLInputElement>('surfaceOnly');
surfaceOnlyEl.addEventListener('change', () => (params.surfaceOnly = surfaceOnlyEl.checked));
algEl.addEventListener('change', () => (params.algorithm = algEl.value as Algorithm));
const frictionModeEl = $<HTMLSelectElement>('frictionMode');
const passesEl = $<HTMLSelectElement>('passes');
frictionModeEl.addEventListener('change', () => (params.frictionMode = frictionModeEl.value as CollisionParams['frictionMode']));
passesEl.addEventListener('change', () => (params.passes = passesEl.value as CollisionParams['passes']));
const orderEl = $<HTMLSelectElement>('order');
const normalModeEl = $<HTMLSelectElement>('normalMode');
orderEl.addEventListener('change', () => (params.order = orderEl.value as CollisionParams['order']));
normalModeEl.addEventListener('change', () => (params.normalMode = normalModeEl.value as CollisionParams['normalMode']));
function syncToggles(): void {
  gravityOnEl.checked = gravityOn;
  collideOnEl.checked = collideOn;
  algEl.value = params.algorithm;
  frictionModeEl.value = params.frictionMode;
  passesEl.value = params.passes;
  orderEl.value = params.order;
  normalModeEl.value = params.normalMode;
  surfaceOnlyEl.checked = params.surfaceOnly;
  setGravityAll();
}
const pileShapeEl = $<HTMLSelectElement>('pileShape');
pileShapeEl.addEventListener('change', () => (pileShape = pileShapeEl.value as ShapeId | 'mix'));
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-scenario]')) {
  btn.addEventListener('click', () => scenarios[btn.dataset.scenario!]!());
}
/** spec 草案 vs. 本 prototype 推薦組合，一鍵切換（人工驗證兩者對照用）。 */
const PRESETS: Record<string, Partial<CollisionParams>> = {
  spec: {
    algorithm: 'pbd-tri',
    frictionMode: 'velocity',
    normalMode: 'winding',
    impactAbsorb: 0,
    skin: 0,
    rounds: 1,
    particleShare: 0.5,
    friction: 0.3,
    passes: 'both',
    order: 'after',
    surfaceOnly: false,
  },
  recommended: { ...DEFAULT_COLLISION },
};
function applyPreset(name: string): void {
  Object.assign(params, PRESETS[name]!);
  syncToggles();
  for (const id of ['rounds', 'particleShare', 'friction', 'skin', 'impactAbsorb'] as const) {
    const input = $<HTMLInputElement>(id);
    input.value = String(params[id]);
    (input.nextElementSibling as HTMLOutputElement).value = input.value;
  }
}
$('presetSpec').addEventListener('click', () => applyPreset('spec'));
$('presetRecommended').addEventListener('click', () => applyPreset('recommended'));
$('clear').addEventListener('click', clearAll);
$('pause').addEventListener('click', () => {
  paused = !paused;
  $('pause').textContent = paused ? '▶ 繼續' : '❚❚ 暫停';
});
$('step').addEventListener('click', () => (stepOnce = 1));
$('spawnTop').addEventListener('click', () => spawn(shapeSel.value as ShapeId, MID_X, 120));

// ---- 量測 ------------------------------------------------------------------------------

class Avg {
  private buf: number[] = [];
  push(v: number): void {
    this.buf.push(v);
    if (this.buf.length > 60) this.buf.shift();
  }
  get value(): number {
    return this.buf.length ? this.buf.reduce((a, b) => a + b, 0) / this.buf.length : 0;
  }
}
const avgRaf = new Avg();
const avgSim = new Avg();
const avgCol = new Avg();
const avgPairs = new Avg();
const avgTests = new Avg();
const avgContacts = new Avg();
const stats = {
  raf: 0,
  sim: 0,
  col: 0,
  pairs: 0,
  tests: 0,
  contacts: 0,
  penetrating: 0,
  corrX: 0,
  corrY: 0,
  maxDepth: 0,
  tBounds: 0,
  tGrid: 0,
  tPairs: 0,
  ke: 0,
  stretch: 0,
};

const fmt = (v: number, d = 2) => v.toFixed(d);
function updatePanel(): void {
  stats.raf = avgRaf.value;
  stats.sim = avgSim.value;
  stats.col = avgCol.value;
  stats.pairs = avgPairs.value;
  stats.tests = avgTests.value;
  stats.contacts = avgContacts.value;
  const n = jellies.reduce((s, b) => s + b.sim.count, 0);
  $('s-count').textContent = `${jellies.length} / ${n}`;
  $('s-raf').textContent = `${fmt(stats.raf, 1)} ms（${fmt(1000 / Math.max(stats.raf, 0.01), 0)} fps）`;
  $('s-sim').textContent = `${fmt(stats.sim)} ms`;
  $('s-col').textContent = `${fmt(stats.col)} ms`;
  $('s-pairs').textContent = fmt(stats.pairs / substeps, 1);
  $('s-tests').textContent = `${fmt(stats.tests, 0)} / ${fmt(stats.contacts, 0)}`;
  const pen = $('s-pen');
  pen.textContent = String(stats.penetrating);
  pen.className = stats.penetrating > 0 ? 'warn' : 'ok';
  $('s-depth').textContent = fmt(stats.maxDepth, 1);
  $('s-colparts').textContent = `${fmt(stats.tBounds)} / ${fmt(stats.tGrid)} / ${fmt(stats.tPairs)} ms`;
  const ke = $('s-ke');
  ke.textContent = stats.ke.toExponential(2);
  ke.className = stats.ke < 1e3 ? 'ok' : '';
  const st = $('s-stretch');
  st.textContent = fmt(stats.stretch);
  st.className = stats.stretch > 2 ? 'warn' : '';
}

// ---- 畫 ---------------------------------------------------------------------------------

const penetrating: number[] = [];
function draw(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  ctx.clearRect(0, 0, w, h);
  // 桌面
  ctx.strokeStyle = '#3a5a4e';
  ctx.lineWidth = 2;
  ctx.strokeRect(toScreenX(WORLD.minX), toScreenY(WORLD.minY), (WORLD.maxX - WORLD.minX) * scale, (WORLD.maxY - WORLD.minY) * scale);
  ctx.fillStyle = '#1c2a24';
  ctx.fillRect(toScreenX(WORLD.minX), toScreenY(WORLD.maxY), (WORLD.maxX - WORLD.minX) * scale, 6);

  const sorted = [...jellies].sort((x, y) => x.sim.id - y.sim.id);
  const sims = sorted.map((b) => b.sim);
  let penCount = 0;
  let ke = 0;
  let stretch = 0;
  for (const b of sorted) {
    const sim = b.sim;
    const pos = sim.positions;
    const tris = sim.triangles;
    // 三角形一次 fill（nonzero），半透明 → 重疊處變深。
    ctx.beginPath();
    for (let t = 0; t < tris.length; t += 3) {
      ctx.moveTo(toScreenX(pos[2 * tris[t]!]!), toScreenY(pos[2 * tris[t]! + 1]!));
      ctx.lineTo(toScreenX(pos[2 * tris[t + 1]!]!), toScreenY(pos[2 * tris[t + 1]! + 1]!));
      ctx.lineTo(toScreenX(pos[2 * tris[t + 2]!]!), toScreenY(pos[2 * tris[t + 2]! + 1]!));
      ctx.closePath();
    }
    ctx.fillStyle = `hsla(${b.hue}, 70%, 55%, 0.6)`;
    ctx.fill();
    if (wireEl.checked) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    // 輪廓
    ctx.beginPath();
    for (const e of sim.contour) {
      ctx.moveTo(toScreenX(pos[2 * e.a]!), toScreenY(pos[2 * e.a + 1]!));
      ctx.lineTo(toScreenX(pos[2 * e.b]!), toScreenY(pos[2 * e.b + 1]!));
    }
    ctx.strokeStyle = `hsl(${b.hue}, 80%, 80%)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // id
    const c = sim.centroid();
    ctx.fillStyle = '#fff';
    ctx.font = '12px system-ui';
    ctx.fillText(`#${sim.id}`, toScreenX(c.x) - 8, toScreenY(c.y) + 4);

    if (markPenEl.checked) {
      penetrating.length = 0;
      sim.penetrating(sims, penetrating);
      penCount += penetrating.length;
      ctx.fillStyle = '#ff3b30';
      for (const i of penetrating) {
        ctx.beginPath();
        ctx.arc(toScreenX(pos[2 * i]!), toScreenY(pos[2 * i + 1]!), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ke += sim.kineticEnergy();
    stretch = Math.max(stretch, sim.stretchStats().max);
  }
  // Grab 把手
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  for (const [id, b] of grabs) {
    const p = b.sim.attachPoint(id);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(toScreenX(p.x), toScreenY(p.y), 7, 0, Math.PI * 2);
    ctx.stroke();
  }
  stats.penetrating = penCount;
  stats.ke = ke;
  stats.stretch = stretch;
}

// ---- 主迴圈 ------------------------------------------------------------------------------

let last = performance.now();
let acc = 0;
let frameNo = 0;
let paused = false;
let stepOnce = 0;
function frame(now: number): void {
  const rafDt = now - last;
  last = now;
  avgRaf.push(rafDt);
  if (paused) acc = stepOnce > 0 ? DT * stepOnce : 0;
  else acc = Math.min(acc + rafDt / 1000, DT * 3);
  stepOnce = 0;
  const t0 = performance.now();
  const colStats: CollisionStats = { pairs: 0, tests: 0, contacts: 0, ms: 0, corrX: 0, corrY: 0, maxDepth: 0, tBounds: 0, tGrid: 0, tPairs: 0 };
  let stepped = false;
  while (acc >= DT) {
    acc -= DT;
    stepped = true;
    tickPile(DT);
    const sims = jellies.map((b) => b.sim);
    const st = stepWorld(sims, DT, substeps, params, collideOn);
    colStats.pairs += st.pairs;
    colStats.tests += st.tests;
    colStats.contacts += st.contacts;
    colStats.ms += st.ms;
    colStats.corrX += st.corrX;
    colStats.corrY += st.corrY;
    if (st.maxDepth > colStats.maxDepth) colStats.maxDepth = st.maxDepth;
    colStats.tBounds += st.tBounds;
    colStats.tGrid += st.tGrid;
    colStats.tPairs += st.tPairs;
  }
  stats.tBounds = colStats.tBounds;
  stats.tGrid = colStats.tGrid;
  stats.tPairs = colStats.tPairs;
  if (stepped) {
    stats.corrX = colStats.corrX;
    stats.corrY = colStats.corrY;
    stats.maxDepth = colStats.maxDepth;
  }
  avgSim.push(performance.now() - t0);
  avgCol.push(colStats.ms);
  avgPairs.push(colStats.pairs);
  avgTests.push(colStats.tests);
  avgContacts.push(colStats.contacts);
  draw();
  if (++frameNo % 10 === 0) updatePanel();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();

// 網格建構是同步的（真實管線 1–3 s），先讓瀏覽器畫出「建網格中」再開始。
setTimeout(() => {
  try {
    buildShapes();
  } catch (e) {
    errEl.textContent = `buildSimMesh 失敗：${(e as Error).message}`;
    throw e;
  }
  $('building').remove();
  scenarios['stack']!();
  requestAnimationFrame(frame);
}, 30);

// Playwright／console 用。
(globalThis as any).__proto = {
  jellies,
  spawn,
  clearAll,
  scenarios,
  params,
  stats,
  get paused() {
    return paused;
  },
  set paused(v: boolean) {
    paused = v;
  },
  step(frames = 1) {
    stepOnce = frames;
  },
  get pileShape() {
    return pileShape;
  },
  set pileShape(v: ShapeId | 'mix') {
    pileShape = v;
  },
  get stackOffset() {
    return stackOffset;
  },
  set stackOffset(v: number) {
    stackOffset = v;
  },
  get substeps() {
    return substeps;
  },
  set substeps(v: number) {
    substeps = v;
  },
  get gravityOn() {
    return gravityOn;
  },
  set gravityOn(v: boolean) {
    gravityOn = v;
    syncToggles();
  },
  get collideOn() {
    return collideOn;
  },
  set collideOn(v: boolean) {
    collideOn = v;
    syncToggles();
  },
};
