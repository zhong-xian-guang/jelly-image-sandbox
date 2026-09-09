import { encode as encodePng } from 'fast-png';
import { encode as encodeJpeg } from 'jpeg-js';
import { GifWriter } from 'omggif';
import { describe, expect, it } from 'vitest';

import {
  decodeGifAlpha,
  decodeImageAlpha,
  decodeJpegAlpha,
  decodePngAlpha,
  imageFormatToMime,
  sniffImageFormat,
} from './decodeImage';
import { MeshPipelineError } from './errors';

/** predicate → RGBA PNG（不透明 alpha 255、透明 alpha 0）。 */
function pngFrom(w: number, h: number, opaque: (x: number, y: number) => boolean): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 10;
      data[i + 1] = 20;
      data[i + 2] = 30;
      data[i + 3] = opaque(x, y) ? 255 : 0;
    }
  }
  return encodePng({ width: w, height: h, data, channels: 4, depth: 8 });
}

/** predicate → GIF（palette 索引 0 透明、1 不透明）。 */
function gifFrom(w: number, h: number, opaque: (x: number, y: number) => boolean): Uint8Array {
  const palette = [0x000000, 0x3c78c8];
  const indexed = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) indexed[y * w + x] = opaque(x, y) ? 1 : 0;
  }
  const buf = new Uint8Array(w * h + 4096);
  const gw = new GifWriter(buf, w, h, { palette });
  gw.addFrame(0, 0, w, h, indexed, { transparent: 0 });
  return buf.subarray(0, gw.end());
}

/** 全不透明 JPEG。 */
function jpegFrom(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 4).fill(128);
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
  return Uint8Array.from(encodeJpeg({ width: w, height: h, data }, 85).data);
}

const leftHalf = (w: number) => (x: number) => x < w / 2;

describe('sniffImageFormat', () => {
  it('依 magic bytes 判定 png / jpeg / gif', () => {
    expect(sniffImageFormat(pngFrom(4, 4, () => true))).toBe('png');
    expect(sniffImageFormat(jpegFrom(8, 8))).toBe('jpeg');
    expect(sniffImageFormat(gifFrom(4, 4, () => true))).toBe('gif');
  });

  it('未知 magic（RIFF/WEBP、空位元組）→ MeshPipelineError', () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(() => sniffImageFormat(webp)).toThrow(MeshPipelineError);
    expect(() => sniffImageFormat(new Uint8Array([0, 1, 2]))).toThrow(MeshPipelineError);
  });

  it('吃 ArrayBuffer 也行', () => {
    const png = pngFrom(4, 4, () => true);
    const ab = new ArrayBuffer(png.byteLength);
    new Uint8Array(ab).set(png);
    expect(sniffImageFormat(ab)).toBe('png');
  });
});

describe('imageFormatToMime', () => {
  it('對應到瀏覽器 <img> 能吃的 MIME', () => {
    expect(imageFormatToMime('png')).toBe('image/png');
    expect(imageFormatToMime('jpeg')).toBe('image/jpeg');
    expect(imageFormatToMime('gif')).toBe('image/gif');
  });
});

describe('decodeImageAlpha — 格式分派', () => {
  it('PNG：回傳正確尺寸，透明區 alpha 0、不透明區 255', () => {
    const r = decodeImageAlpha(pngFrom(20, 12, leftHalf(20)));
    expect(r.width).toBe(20);
    expect(r.height).toBe(12);
    expect(r.alpha[0]).toBe(255); // 左半
    expect(r.alpha[19]).toBe(0); // 右半
    expect(r.alpha).toEqual(decodePngAlpha(pngFrom(20, 12, leftHalf(20))).alpha);
  });

  it('JPEG：無 alpha 通道 → 整張矩形 alpha 全 255', () => {
    const r = decodeImageAlpha(jpegFrom(16, 10));
    expect(r.width).toBe(16);
    expect(r.height).toBe(10);
    expect(r.alpha).toHaveLength(160);
    expect(Array.from(r.alpha).every((a) => a === 255)).toBe(true);
  });

  it('GIF：取第一幀，透明索引 → alpha 0，其餘 255', () => {
    const r = decodeImageAlpha(gifFrom(20, 12, leftHalf(20)));
    expect(r.width).toBe(20);
    expect(r.height).toBe(12);
    expect(r.alpha[0]).toBe(255); // 左半（palette 索引 1）
    expect(r.alpha[19]).toBe(0); // 右半（透明索引 0）
    // 每個像素非 0 即 255
    expect(Array.from(r.alpha).every((a) => a === 0 || a === 255)).toBe(true);
  });

  it('同一形狀的 PNG 與 GIF → alpha 平面逐位元組相等', () => {
    const shape = (x: number, y: number) => (x - 10) ** 2 + (y - 8) ** 2 <= 36;
    const fromPng = decodeImageAlpha(pngFrom(24, 18, shape));
    const fromGif = decodeImageAlpha(gifFrom(24, 18, shape));
    expect(fromGif.alpha).toEqual(fromPng.alpha);
  });

  it('未知 magic → MeshPipelineError', () => {
    const bmp = new Uint8Array([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00]);
    expect(() => decodeImageAlpha(bmp)).toThrow(MeshPipelineError);
  });

  it('副檔名對但內容截斷 → 丟錯而非回垃圾', () => {
    // 有效 magic、其餘全 0
    expect(() => decodeJpegAlpha(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0]))).toThrow(
      MeshPipelineError,
    );
    expect(() =>
      decodeGifAlpha(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0])),
    ).toThrow(MeshPipelineError);
    // 截斷的 PNG：至少要丟錯（既有 decodePngAlpha 行為不變，錯誤型別不拘）
    expect(() =>
      decodeImageAlpha(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
      ),
    ).toThrow();
  });
});
