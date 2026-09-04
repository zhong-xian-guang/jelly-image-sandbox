/**
 * JellyRenderer 視覺檢視 harness（非產品程式，只在 `npm run dev` 下跑）。
 *
 * 程序化生一塊 Jelly（畫貼圖 → 編 PNG → `buildSimMesh`），交給 `JellyRenderer`
 * 畫成 PixiJS 貼圖網格。在畫面上拖任一頂點 → 直接改 `positions` 再 `setPositions`，
 * 看貼圖連續扭曲、三角形之間無縫。求解器沒有參與。
 */

import { encode as encodePng } from 'fast-png';

import { buildSimMesh, type SimMesh } from '../src/mesh';
import { containerPosition, JellyRenderer } from '../src/render';

const stage = document.getElementById('stage')!;
const errEl = document.getElementById('err')!;
const meshEl = document.getElementById('s-mesh')!;
const dragEl = document.getElementById('s-drag')!;
const fpsEl = document.getElementById('s-fps')!;
const backendEl = document.getElementById('s-backend')!;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const wobbleBtn = document.getElementById('wobble') as HTMLButtonElement;
const showWireEl = document.getElementById('showWire') as HTMLInputElement;

// ---- 程序化貼圖：方向感強的凹形（吃豆人嘴 + 眼睛 + 字）------------------------
function makeTexture(size = 512): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, size, size);

  g.save();
  g.beginPath();
  g.moveTo(size / 2, size / 2);
  g.arc(size / 2, size / 2, size * 0.42, 0.42, Math.PI * 2 - 0.42, false);
  g.closePath();
  g.clip();

  for (let y = 0; y < size; y += 32)
    for (let x = 0; x < size; x += 32) {
      g.fillStyle = ((x + y) / 32) % 2 ? '#2fae82' : '#7fd9b8';
      g.fillRect(x, y, 32, 32);
    }
  g.strokeStyle = 'rgba(255,255,255,.35)';
  g.lineWidth = 6;
  for (let d = -size; d < size * 2; d += 46) {
    g.beginPath();
    g.moveTo(d, 0);
    g.lineTo(d - size, size);
    g.stroke();
  }
  g.fillStyle = '#10201a';
  g.beginPath();
  g.arc(size / 2 - 40, size / 2 - 70, 26, 0, 7);
  g.fill();
  g.beginPath();
  g.arc(size / 2 + 70, size / 2 - 70, 26, 0, 7);
  g.fill();
  g.font = 'bold 92px system-ui, sans-serif';
  g.textAlign = 'center';
  g.save();
  g.translate(size / 2 + 10, size / 2 + 90);
  g.rotate(-0.08);
  g.fillText('JELLY', 0, 0);
  g.restore();
  g.restore();
  return cv;
}

function canvasToPng(cv: HTMLCanvasElement): Uint8Array {
  const { width, height } = cv;
  const data = cv.getContext('2d')!.getImageData(0, 0, width, height).data;
  return encodePng({ width, height, data: new Uint8Array(data.buffer), channels: 4, depth: 8 });
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

// ---- 狀態 -------------------------------------------------------------------
const texture = makeTexture();
let mesh: SimMesh;
try {
  mesh = buildSimMesh(canvasToPng(texture));
} catch (e) {
  errEl.innerHTML = `<span class="err">buildSimMesh 失敗：${(e as Error).message}</span>`;
  throw e;
}

const bb = meshBBox(mesh);
const view = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2, scale: 1 };
const livePos = Float64Array.from(mesh.positions);
const vertexCount = mesh.positions.length / 2;
meshEl.textContent = `${vertexCount} / ${mesh.indices.length / 3}`;

// 線框疊圖（看有沒有接縫）
const wire = document.createElement('canvas');
wire.style.cssText = 'position:absolute;inset:0;pointer-events:none';
stage.appendChild(wire);
const wireCtx = wire.getContext('2d')!;

let renderer: JellyRenderer;

function fitView(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const margin = 60;
  view.scale = Math.min(
    (w - margin) / Math.max(bb.maxX - bb.minX, 1),
    (h - margin) / Math.max(bb.maxY - bb.minY, 1),
  );
  renderer.setCamera(view);
}

function resize(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.resize(w, h);
  wire.width = w;
  wire.height = h;
  fitView();
}

const worldToScreen = (wx: number, wy: number): [number, number] => {
  const p = containerPosition(view, stage.clientWidth, stage.clientHeight);
  return [p.x + wx * view.scale, p.y + wy * view.scale];
};
const screenToWorld = (sx: number, sy: number): [number, number] => {
  const p = containerPosition(view, stage.clientWidth, stage.clientHeight);
  return [(sx - p.x) / view.scale, (sy - p.y) / view.scale];
};

function drawWire(): void {
  wireCtx.clearRect(0, 0, wire.width, wire.height);
  if (!showWireEl.checked) return;
  wireCtx.strokeStyle = 'rgba(80,230,180,0.55)';
  wireCtx.lineWidth = 1;
  wireCtx.beginPath();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t]!;
    const ib = mesh.indices[t + 1]!;
    const ic = mesh.indices[t + 2]!;
    const [ax, ay] = worldToScreen(livePos[ia * 2]!, livePos[ia * 2 + 1]!);
    const [bx, by] = worldToScreen(livePos[ib * 2]!, livePos[ib * 2 + 1]!);
    const [cx, cy] = worldToScreen(livePos[ic * 2]!, livePos[ic * 2 + 1]!);
    wireCtx.moveTo(ax, ay);
    wireCtx.lineTo(bx, by);
    wireCtx.lineTo(cx, cy);
    wireCtx.closePath();
  }
  wireCtx.stroke();
}

// ---- 拖曳頂點 --------------------------------------------------------------
let dragIndex = -1;

function pickVertex(sx: number, sy: number): number {
  let best = -1;
  let bestD = 18 * 18;
  for (let i = 0; i < vertexCount; i++) {
    const [px, py] = worldToScreen(livePos[i * 2]!, livePos[i * 2 + 1]!);
    const d = (px - sx) ** 2 + (py - sy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function pointerXY(ev: PointerEvent): [number, number] {
  const r = stage.getBoundingClientRect();
  return [ev.clientX - r.left, ev.clientY - r.top];
}

stage.addEventListener('pointerdown', (ev) => {
  const [sx, sy] = pointerXY(ev);
  dragIndex = pickVertex(sx, sy);
  if (dragIndex >= 0) stage.setPointerCapture(ev.pointerId);
  dragEl.textContent = dragIndex >= 0 ? `#${dragIndex}` : '（沒抓到）';
});
stage.addEventListener('pointermove', (ev) => {
  if (dragIndex < 0) return;
  const [sx, sy] = pointerXY(ev);
  const [wx, wy] = screenToWorld(sx, sy);
  livePos[dragIndex * 2] = wx;
  livePos[dragIndex * 2 + 1] = wy;
});
const endDrag = (): void => {
  dragIndex = -1;
  dragEl.textContent = '–';
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

resetBtn.addEventListener('click', () => livePos.set(mesh.positions));
wobbleBtn.addEventListener('click', () => {
  for (let i = 0; i < livePos.length; i++) livePos[i] += (Math.random() - 0.5) * 24;
});

// ---- 主迴圈 --------------------------------------------------------------
let frames = 0;
let fpsT0 = performance.now();

function loop(): void {
  renderer.setPositions(livePos);
  renderer.render();
  drawWire();

  frames++;
  const now = performance.now();
  if (now - fpsT0 >= 500) {
    fpsEl.textContent = ((frames * 1000) / (now - fpsT0)).toFixed(0);
    frames = 0;
    fpsT0 = now;
  }
  requestAnimationFrame(loop);
}

async function main(): Promise<void> {
  renderer = await JellyRenderer.create({
    width: stage.clientWidth,
    height: stage.clientHeight,
    mesh,
    positions: livePos,
    texture,
    background: { color: 0x101614, alpha: 1 },
  });
  stage.insertBefore(renderer.canvas, wire);
  backendEl.textContent = 'WebGL';
  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(loop);
}

void main();
