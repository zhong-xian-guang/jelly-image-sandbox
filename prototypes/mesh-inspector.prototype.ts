/**
 * Mesh pipeline 視覺檢視工具（非產品程式，只在 `npm run dev` 下跑）。
 * 拖一張帶 alpha 的 PNG 進來 → 呼叫 `buildSimMesh` → 疊在原圖上畫出
 * 三角網、內部點，並列出統計數字，用來眼睛檢查網格品質與決定性。
 */

import { buildSimMesh, type BuildSimMeshParams, type SimMesh } from '../src/mesh';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stage = document.getElementById('stage')!;
const fileInput = document.getElementById('file') as HTMLInputElement;
const statsEl = document.getElementById('stats')!;
const rerunBtn = document.getElementById('rerun') as HTMLButtonElement;
const showImageEl = document.getElementById('showImage') as HTMLInputElement;
const showMeshEl = document.getElementById('showMesh') as HTMLInputElement;
const showPointsEl = document.getElementById('showPoints') as HTMLInputElement;

const controls: Record<keyof BuildSimMeshParams, HTMLInputElement> = {
  maxMaskEdge: document.getElementById('maxMaskEdge') as HTMLInputElement,
  alphaThreshold: document.getElementById('alphaThreshold') as HTMLInputElement,
  simplifyTolerance: document.getElementById('simplifyTolerance') as HTMLInputElement,
  targetParticleCount: document.getElementById('targetParticleCount') as HTMLInputElement,
  minTriangleArea: document.getElementById('minTriangleArea') as HTMLInputElement,
  minTriangleAngleDeg: document.getElementById('minTriangleAngleDeg') as HTMLInputElement,
};

let lastPngBytes: Uint8Array | null = null;
let lastImage: HTMLImageElement | null = null;

function readParams(): Partial<BuildSimMeshParams> {
  const p: Partial<BuildSimMeshParams> = {};
  for (const key of Object.keys(controls) as (keyof BuildSimMeshParams)[]) {
    const raw = controls[key].value.trim();
    if (raw !== '') p[key] = Number(raw);
  }
  return p;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function triStats(mesh: SimMesh) {
  let minArea = Infinity;
  let minAngle = Infinity;
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]!;
    const b = mesh.indices[t + 1]!;
    const c = mesh.indices[t + 2]!;
    const ax = p[a * 2]!;
    const ay = p[a * 2 + 1]!;
    const bx = p[b * 2]!;
    const by = p[b * 2 + 1]!;
    const cx = p[c * 2]!;
    const cy = p[c * 2 + 1]!;
    const area = Math.abs(((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2);
    if (area < minArea) minArea = area;
    const l1 = Math.hypot(bx - ax, by - ay);
    const l2 = Math.hypot(cx - bx, cy - by);
    const l3 = Math.hypot(ax - cx, ay - cy);
    const angA = Math.acos(clamp((l1 * l1 + l3 * l3 - l2 * l2) / (2 * l1 * l3), -1, 1));
    const angB = Math.acos(clamp((l1 * l1 + l2 * l2 - l3 * l3) / (2 * l1 * l2), -1, 1));
    minAngle = Math.min(minAngle, angA, angB, Math.PI - angA - angB);
  }
  return { minArea, minAngleDeg: (minAngle * 180) / Math.PI };
}

function meshBBox(mesh: SimMesh) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 2) {
    minX = Math.min(minX, mesh.positions[i]!);
    maxX = Math.max(maxX, mesh.positions[i]!);
    minY = Math.min(minY, mesh.positions[i + 1]!);
    maxY = Math.max(maxY, mesh.positions[i + 1]!);
  }
  return { minX, minY, maxX, maxY };
}

function run() {
  if (!lastPngBytes) return;
  const params = readParams();

  let mesh: SimMesh;
  const t0 = performance.now();
  try {
    mesh = buildSimMesh(lastPngBytes, params);
  } catch (err) {
    statsEl.innerHTML = `<span class="err">buildSimMesh 丟例外：${(err as Error).message}</span>`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const elapsed = performance.now() - t0;

  // 決定性快速檢查：再跑一次，比對 positions / indices 是否逐位元組相同。
  const again = buildSimMesh(lastPngBytes, params);
  const deterministic =
    again.positions.length === mesh.positions.length &&
    again.positions.every((v, i) => v === mesh.positions[i]) &&
    again.indices.every((v, i) => v === mesh.indices[i]);

  const particles = mesh.positions.length / 2;
  const triangles = mesh.indices.length / 3;
  const { minArea, minAngleDeg } = triStats(mesh);
  const bb = meshBBox(mesh);
  const areaFloor = params.minTriangleArea ?? 0.5;

  statsEl.innerHTML = `
    <dl>
      <dt>Particle 數</dt><dd class="${particles >= 200 && particles <= 500 ? 'ok' : 'warn'}">${particles} <small>(目標 200–500)</small></dd>
      <dt>三角形數</dt><dd>${triangles}</dd>
      <dt>最小三角形面積</dt><dd class="${minArea >= areaFloor ? 'ok' : 'warn'}">${minArea.toFixed(3)} px²</dd>
      <dt>最小內角</dt><dd>${minAngleDeg.toFixed(1)}°</dd>
      <dt>網格 bbox（mask px）</dt><dd>x [${bb.minX.toFixed(1)}, ${bb.maxX.toFixed(1)}] · y [${bb.minY.toFixed(1)}, ${bb.maxY.toFixed(1)}]</dd>
      <dt>決定性（連跑兩次）</dt><dd class="${deterministic ? 'ok' : 'err'}">${deterministic ? '✓ 逐位元組相同' : '✗ 兩次結果不同！'}</dd>
      <dt>耗時</dt><dd>${elapsed.toFixed(1)} ms</dd>
    </dl>`;

  draw(mesh);
}

function draw(mesh: SimMesh) {
  if (!lastImage) return;
  const iw = lastImage.naturalWidth;
  const ih = lastImage.naturalHeight;
  // 頂點座標系 = 降採樣 mask 像素；UV × 原圖尺寸 換回原圖像素以對齊底圖。
  const imgX = (i: number) => mesh.uv[i * 2]! * iw;
  const imgY = (i: number) => mesh.uv[i * 2 + 1]! * ih;

  const pad = 24;
  const scale = Math.min((canvas.width - pad * 2) / iw, (canvas.height - pad * 2) / ih);
  const ox = (canvas.width - iw * scale) / 2;
  const oy = (canvas.height - ih * scale) / 2;
  const sx = (i: number) => ox + imgX(i) * scale;
  const sy = (i: number) => oy + imgY(i) * scale;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0d1512';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (showImageEl.checked) {
    ctx.globalAlpha = 0.4;
    ctx.drawImage(lastImage, ox, oy, iw * scale, ih * scale);
    ctx.globalAlpha = 1;
  }

  if (showMeshEl.checked) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(64, 220, 170, 0.7)';
    ctx.beginPath();
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const ia = mesh.indices[t]!;
      const ib = mesh.indices[t + 1]!;
      const ic = mesh.indices[t + 2]!;
      ctx.moveTo(sx(ia), sy(ia));
      ctx.lineTo(sx(ib), sy(ib));
      ctx.lineTo(sx(ic), sy(ic));
      ctx.closePath();
    }
    ctx.stroke();
  }

  if (showPointsEl.checked) {
    ctx.fillStyle = 'rgba(255, 200, 90, 0.9)';
    for (let i = 0; i < mesh.positions.length / 2; i++) ctx.fillRect(sx(i) - 1.5, sy(i) - 1.5, 3, 3);
  }
}

function resize() {
  canvas.width = stage.clientWidth * devicePixelRatio;
  canvas.height = stage.clientHeight * devicePixelRatio;
  canvas.style.width = `${stage.clientWidth}px`;
  canvas.style.height = `${stage.clientHeight}px`;
}

async function loadFile(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  lastPngBytes = buf;
  const img = new Image();
  img.onload = () => {
    lastImage = img;
    resize();
    run();
  };
  img.src = URL.createObjectURL(file);
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) void loadFile(f);
});
rerunBtn.addEventListener('click', run);
for (const el of Object.values(controls)) el.addEventListener('change', run);
for (const el of [showImageEl, showMeshEl, showPointsEl]) el.addEventListener('change', run);

stage.addEventListener('dragover', (e) => {
  e.preventDefault();
  stage.classList.add('drag');
});
stage.addEventListener('dragleave', () => stage.classList.remove('drag'));
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('drag');
  const f = e.dataTransfer?.files?.[0];
  if (f) void loadFile(f);
});
window.addEventListener('resize', () => {
  resize();
  run();
});
resize();
