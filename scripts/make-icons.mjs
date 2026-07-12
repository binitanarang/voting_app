/* Generates the PWA icons (a small leaderboard-bars mark in the Mara palette)
   without any image dependencies — raw RGBA → zlib → PNG.
   Replace client/public/icon-*.png with real brand icons any time. */
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public');
fs.mkdirSync(OUT, { recursive: true });

const INK = [0x14, 0x10, 0x0a];
const OCHRE = [0xb8, 0x86, 0x2f];
const IVORY = [0xf2, 0xec, 0xe0];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1)); // filter byte + RGBA per row
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = draw(x / size, y / size);
      const i = row + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* Three ascending bars (a tiny leaderboard) on an ink field, ochre/ivory. */
function draw(u, v) {
  const bars = [
    { x0: 0.22, x1: 0.34, h: 0.42, color: OCHRE },
    { x0: 0.44, x1: 0.56, h: 0.62, color: IVORY },
    { x0: 0.66, x1: 0.78, h: 0.30, color: OCHRE },
  ];
  const baseline = 0.76;
  for (const b of bars) {
    if (u >= b.x0 && u <= b.x1 && v <= baseline && v >= baseline - b.h) return b.color;
  }
  if (v > baseline && v < baseline + 0.012) return IVORY; // hairline baseline
  return INK;
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(path.join(OUT, name), png(size, draw));
  console.log(`wrote ${name} (${size}×${size})`);
}
