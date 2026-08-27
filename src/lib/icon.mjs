/**
 * Minimaler Icon-Generator (SVG + PNG) ohne externe Abhängigkeiten.
 * Erzeugt ein schlichtes Buch-/Tagebuch-Symbol in der Akzentfarbe.
 */

import zlib from 'node:zlib';

function hexToRgb(hex) {
  const clean = String(hex || '#c2683a').replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function svg(accent) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="${accent}"/>
  <g fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M16 18.5A4.5 4.5 0 0 1 20.5 14H47a2 2 0 0 1 2 2v30a2 2 0 0 1-2 2H20.5A4.5 4.5 0 0 0 16 52.5z"/>
    <path d="M26 14v34"/>
    <path d="M33 25h9"/>
    <path d="M33 33h9"/>
  </g>
</svg>
`;
}

/* ---------------------------------------------------------------- PNG ---- */

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Zeichnet das Icon pixelweise (abgerundetes Quadrat + Buch-Glyphe). */
function png(size, accent) {
  const { r, g, b } = hexToRgb(accent);
  const radius = size * 0.22;
  const raw = Buffer.alloc(size * (size * 4 + 1));

  const inRoundedRect = (x, y) => {
    const rx = Math.min(x, size - 1 - x);
    const ry = Math.min(y, size - 1 - y);
    if (rx >= radius || ry >= radius) return true;
    const dx = radius - rx;
    const dy = radius - ry;
    return dx * dx + dy * dy <= radius * radius;
  };

  // Glyphe in relativen Koordinaten (0..1)
  const s = (v) => v * size;
  const strokes = [
    // Buchruecken
    { x0: 0.25, y0: 0.2, x1: 0.25, y1: 0.8, w: 0.055 },
    // Deckel oben / unten
    { x0: 0.25, y0: 0.2, x1: 0.76, y1: 0.2, w: 0.055 },
    { x0: 0.25, y0: 0.8, x1: 0.76, y1: 0.8, w: 0.055 },
    { x0: 0.76, y0: 0.2, x1: 0.76, y1: 0.8, w: 0.055 },
    // Mittelfalz
    { x0: 0.42, y0: 0.2, x1: 0.42, y1: 0.8, w: 0.045 },
    // Zeilen
    { x0: 0.52, y0: 0.4, x1: 0.68, y1: 0.4, w: 0.045 },
    { x0: 0.52, y0: 0.53, x1: 0.68, y1: 0.53, w: 0.045 }
  ];

  const distanceToSegment = (px, py, x0, y0, x1, y1) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSquared = dx * dx + dy * dy;
    let t = lengthSquared === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const cx = x0 + t * dx;
    const cy = y0 + t * dy;
    return Math.hypot(px - cx, py - cy);
  };

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // Filter: none
    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 4;
      const inside = inRoundedRect(x, y);

      let glyph = 0;
      if (inside) {
        for (const stroke of strokes) {
          const d = distanceToSegment(x + 0.5, y + 0.5, s(stroke.x0), s(stroke.y0), s(stroke.x1), s(stroke.y1));
          const half = s(stroke.w) / 2;
          const alpha = Math.max(0, Math.min(1, (half + 0.6 - d) / 1.2));
          glyph = Math.max(glyph, alpha);
        }
      }

      const edge = inside ? 1 : 0;
      raw[offset] = Math.round(r + (255 - r) * glyph);
      raw[offset + 1] = Math.round(g + (255 - g) * glyph);
      raw[offset + 2] = Math.round(b + (255 - b) * glyph);
      raw[offset + 3] = edge ? 255 : 0;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

export const makeIcon = { svg, png };
