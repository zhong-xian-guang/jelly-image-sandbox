/**
 * 內建的預設 Jelly（issue #11 / T10）——沒有匯入圖片時就顯示它。
 *
 * 程序化畫一張方向感強的凹形貼圖（吃豆人嘴 + 眼睛 + 字），編成 PNG 後走真正的
 * `buildSimMesh` 管線 → `SimMesh`。純瀏覽器端（用到 `<canvas>`）。
 */

import { encode as encodePng } from 'fast-png';

import { buildSimMesh, type SimMesh } from '../mesh';

/** 預設貼圖尺寸（正方形邊長，px）。 */
const DEFAULT_TEXTURE_SIZE = 512;

export interface DefaultJelly {
  mesh: SimMesh;
  /** 原圖，交給 Renderer 當貼圖。 */
  texture: HTMLCanvasElement;
}

function ctx2d(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = cv.getContext('2d');
  if (!g) throw new Error('取不到 2D canvas context');
  return g;
}

/** 程序化貼圖：棋盤底 + 斜紋 + 兩眼 + 「JELLY」字，輪廓是朝右開口的凹形。 */
export function drawDefaultTexture(size = DEFAULT_TEXTURE_SIZE): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = ctx2d(cv);
  g.clearRect(0, 0, size, size);

  g.save();
  g.beginPath();
  g.moveTo(size / 2, size / 2);
  g.arc(size / 2, size / 2, size * 0.42, 0.42, Math.PI * 2 - 0.42, false);
  g.closePath();
  g.clip();

  for (let y = 0; y < size; y += 32) {
    for (let x = 0; x < size; x += 32) {
      g.fillStyle = ((x + y) / 32) % 2 ? '#2fae82' : '#7fd9b8';
      g.fillRect(x, y, 32, 32);
    }
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

/** `<canvas>` → PNG 位元組（`buildSimMesh` 的輸入）。 */
export function canvasToPng(cv: HTMLCanvasElement): Uint8Array {
  const { width, height } = cv;
  const data = ctx2d(cv).getImageData(0, 0, width, height).data;
  return encodePng({ width, height, data: new Uint8Array(data.buffer), channels: 4, depth: 8 });
}

/** 預設 Jelly：程序化貼圖 → `buildSimMesh`。 */
export function createDefaultJelly(size = DEFAULT_TEXTURE_SIZE): DefaultJelly {
  const texture = drawDefaultTexture(size);
  const mesh = buildSimMesh(canvasToPng(texture));
  return { mesh, texture };
}
