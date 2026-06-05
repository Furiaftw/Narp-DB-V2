/**
 * Generates minimal PNG icons for the NARP DB PWA.
 * Indigo (#4F46E5) background, white "N" lettermark.
 * Run once: node scripts/generate-icons.mjs
 * Requires Node 18+ (built-in zlib).
 */
import { createDeflateRaw } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { promisify } from 'util';

const deflate = promisify(createDeflateRaw().constructor
  ? (buf, cb) => { const d = createDeflateRaw(); const chunks = []; d.on('data', c => chunks.push(c)); d.on('end', () => cb(null, Buffer.concat(chunks))); d.on('error', cb); d.end(buf); }
  : null);

// Simpler: use zlib.deflateRaw directly
import zlib from 'zlib';
const deflateRaw = promisify(zlib.deflateRaw);

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBytes, data]);
  return Buffer.concat([u32be(data.length), typeBytes, data, u32be(crc32(crcInput))]);
}

async function makePng(size, bgR, bgG, bgB) {
  // IHDR
  const ihdr = Buffer.concat([u32be(size), u32be(size), Buffer.from([8, 2, 0, 0, 0])]);

  // Build RGBA rows: indigo background, draw a simple "N" in white
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte + RGB
    row[0] = 0; // None filter
    for (let x = 0; x < size; x++) {
      row[1 + x * 3] = bgR;
      row[1 + x * 3 + 1] = bgG;
      row[1 + x * 3 + 2] = bgB;
    }

    // Draw white "N" glyph (scaled to icon size)
    const pad = Math.round(size * 0.2);
    const thick = Math.max(2, Math.round(size * 0.12));
    const top = pad, bottom = size - pad;
    const left = pad, right = size - pad;

    for (let x = left; x < left + thick && x < size; x++) {
      if (y >= top && y < bottom) {
        row[1 + x * 3] = 255; row[1 + x * 3 + 1] = 255; row[1 + x * 3 + 2] = 255;
      }
    }
    for (let x = right - thick; x < right && x < size; x++) {
      if (y >= top && y < bottom) {
        row[1 + x * 3] = 255; row[1 + x * 3 + 1] = 255; row[1 + x * 3 + 2] = 255;
      }
    }
    // Diagonal stroke of "N"
    const progress = (y - top) / (bottom - top);
    const diagX = Math.round(left + thick + progress * (right - thick - left - thick));
    for (let dx = 0; dx < thick && diagX + dx < size; dx++) {
      if (diagX + dx >= 0 && y >= top && y < bottom) {
        row[1 + (diagX + dx) * 3] = 255;
        row[1 + (diagX + dx) * 3 + 1] = 255;
        row[1 + (diagX + dx) * 3 + 2] = 255;
      }
    }

    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  const compressed = await deflateRaw(raw);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('public/icons', { recursive: true });

// Indigo-600: #4F46E5 = rgb(79, 70, 229)
const [r, g, b] = [79, 70, 229];

const [png192, png512, pngTouch] = await Promise.all([
  makePng(192, r, g, b),
  makePng(512, r, g, b),
  makePng(180, r, g, b),
]);

writeFileSync('public/icons/icon-192.png', png192);
writeFileSync('public/icons/icon-512.png', png512);
writeFileSync('public/icons/apple-touch-icon.png', pngTouch);

console.log('Icons written to public/icons/');
