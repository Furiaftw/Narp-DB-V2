/**
 * Generate PWA icons from the project's favicon.ico.
 * Extracts the largest embedded image (48×48 BGRA BMP DIB) and composites
 * it centred on an indigo (#4F46E5) background at each required size.
 * Uses only Node.js built-ins (fs, zlib) — no external dependencies.
 *
 * Usage: node scripts/generate-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { deflateSync } from 'zlib';

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG builder ───────────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([lenBuf, t, data, crcBuf]);
}

function writePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = ihdr[11] = ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.allocUnsafe(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0; // filter byte: None
    const rowBase = y * (1 + stride) + 1;
    const srcBase = y * stride;
    for (let x = 0; x < width; x++) {
      const d = rowBase + x * 4;
      const s = srcBase + x * 4;
      raw[d]     = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
      raw[d + 3] = rgba[s + 3];
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── ICO parser ────────────────────────────────────────────────────────────────
// Extracts the largest image from a .ico file.
// ICO images are BMP DIBs stored bottom-up with BGRA colour order.
// biHeight in the DIB header = 2 × actualHeight (AND mask convention).
function extractICOPixels(icoBuf) {
  const count = icoBuf.readUInt16LE(4);

  // Find the largest image by pixel area
  let bestIdx = 0, bestArea = 0;
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const w = icoBuf[off] || 256;
    const h = icoBuf[off + 1] || 256;
    if (w * h > bestArea) { bestArea = w * h; bestIdx = i; }
  }

  const dirOff  = 6 + bestIdx * 16;
  const imgW    = icoBuf[dirOff] || 256;
  const imgH    = icoBuf[dirOff + 1] || 256;
  const dataOff = icoBuf.readUInt32LE(dirOff + 12);
  const pixOff  = dataOff + 40; // skip 40-byte BITMAPINFOHEADER

  const rgba = new Uint8Array(imgW * imgH * 4);
  for (let y = 0; y < imgH; y++) {
    const srcRow = imgH - 1 - y; // BMP rows are bottom-up
    for (let x = 0; x < imgW; x++) {
      const src = pixOff + (srcRow * imgW + x) * 4;
      const dst = (y * imgW + x) * 4;
      rgba[dst]     = icoBuf[src + 2]; // B→R
      rgba[dst + 1] = icoBuf[src + 1]; // G
      rgba[dst + 2] = icoBuf[src];     // R→B
      rgba[dst + 3] = icoBuf[src + 3]; // A
    }
  }
  return { w: imgW, h: imgH, rgba };
}

// ── Compositor ────────────────────────────────────────────────────────────────
// Scales the source image to fill a padded area on an indigo background.
const BG = [0x4F, 0x46, 0xE5, 0xFF]; // indigo-600

function compositeIcon(size, src) {
  const PADDING = Math.round(size * 0.15);
  const drawW = size - PADDING * 2;
  const drawH = size - PADDING * 2;
  const out = new Uint8Array(size * size * 4);

  // Fill background
  for (let i = 0; i < size * size; i++) {
    out[i * 4]     = BG[0];
    out[i * 4 + 1] = BG[1];
    out[i * 4 + 2] = BG[2];
    out[i * 4 + 3] = BG[3];
  }

  // Nearest-neighbour scale + alpha-blend over background
  for (let dy = 0; dy < drawH; dy++) {
    for (let dx = 0; dx < drawW; dx++) {
      const sx = Math.round((dx / drawW) * (src.w - 1));
      const sy = Math.round((dy / drawH) * (src.h - 1));
      const si = (sy * src.w + sx) * 4;
      const a  = src.rgba[si + 3] / 255;

      const di = ((PADDING + dy) * size + (PADDING + dx)) * 4;
      out[di]     = Math.round(src.rgba[si]     * a + BG[0] * (1 - a));
      out[di + 1] = Math.round(src.rgba[si + 1] * a + BG[1] * (1 - a));
      out[di + 2] = Math.round(src.rgba[si + 2] * a + BG[2] * (1 - a));
      out[di + 3] = 255;
    }
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const icoPath = new URL('../public/favicon.ico', import.meta.url);
const outDir  = new URL('../public/icons',       import.meta.url);

const src = extractICOPixels(readFileSync(icoPath));
console.log(`Source: ${src.w}×${src.h} from favicon.ico`);

mkdirSync(outDir, { recursive: true });

const sizes = [
  { name: 'icon-192',        size: 192 },
  { name: 'icon-512',        size: 512 },
  { name: 'apple-touch-icon', size: 180 },
];

for (const { name, size } of sizes) {
  const pixels = compositeIcon(size, src);
  const png    = writePNG(size, size, pixels);
  writeFileSync(new URL(`${name}.png`, outDir + '/'), png);
  console.log(`  ${name}.png  ${png.length} bytes`);
}

console.log('Done — icons written to public/icons/');
