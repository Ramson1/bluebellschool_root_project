// Sample the Bluebell crest and report its dominant brand colours.
//   node tools/sample-palette.mjs [path-to-logo]   (default: brand.json logoMaster)
// sharp is only installed inside the JMIS workspace, so it is required by path.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT, BRAND } from './guard.mjs';
const require = createRequire(join(BRAND.source.root, 'jmischool', 'package.json'));
const sharp = require('sharp');

const SRC = process.argv[2] || join(ROOT, BRAND.logoMaster);
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { channels, width, height } = info;
console.log(`${SRC}: ${width}x${height}, channels=${channels}, pixels=${data.length / channels}`);

const toHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return { h, s, l };
};

// Quantise to 8-bit-per-channel buckets and count every pixel that carries colour.
const buckets = new Map();
let neutral = 0, coloured = 0;
for (let i = 0; i < data.length; i += channels) {
  const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
  if (a < 128) continue;
  const { h, s, l } = toHsl(r, g, b);
  if (s < 0.18 || l > 0.92 || l < 0.08) { neutral++; continue; }   // white/grey/black ground
  coloured++;
  const fam = h < 20 ? 'red/orange' : h < 45 ? 'gold/amber' : h < 75 ? 'yellow'
    : h < 165 ? 'green' : h < 200 ? 'cyan' : h < 260 ? 'blue' : h < 330 ? 'violet' : 'red';
  // 16-level bucket per channel keeps near-identical shades together
  const key = `${fam}|#${[r, g, b].map((v) => (v >> 4).toString(16)).join('')}`;
  const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, fam };
  e.n++; e.r += r; e.g += g; e.b += b;
  buckets.set(key, e);
}

const hex = (e) => '#' + [e.r, e.g, e.b].map((v) => Math.round(v / e.n).toString(16).padStart(2, '0')).join('');
const agg = new Map();
for (const e of buckets.values()) {
  const t = (agg.get(e.fam) || 0) + e.n;
  agg.set(e.fam, t);
}
console.log(`\ncoloured pixels: ${coloured}  neutral: ${neutral}`);
console.log('\nhue families:');
for (const [fam, n] of [...agg].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(100 * n / coloured).toFixed(1).padStart(5)}%  ${fam}`);
}

console.log('\ntop saturated shades overall:');
for (const e of [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 18)) {
  const t = hex(e), { h, s, l } = toHsl(e.r / e.n, e.g / e.n, e.b / e.n);
  console.log(`  ${(100 * e.n / coloured).toFixed(2).padStart(5)}%  ${t}  hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)  ${e.fam}`);
}

// Per-family leadership: the single richest representative shade of each brand colour.
console.log('\nper-family dominant shade (mean of its pixels, weighted by bucket size):');
for (const [fam, total] of [...agg].sort((a, b) => b[1] - a[1])) {
  const list = [...buckets.values()].filter((e) => e.fam === fam).sort((a, b) => b.n - a.n);
  const top = list[0];
  const t = hex(top), { h, s, l } = toHsl(top.r / top.n, top.g / top.n, top.b / top.n);
  const exact = top.r / top.n, exactg = top.g / top.n, exactb = top.b / top.n;
  const raw = '#' + [exact, exactg, exactb].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  console.log(`  ${fam.padEnd(11)} ${((100 * total) / coloured).toFixed(1).padStart(5)}%  lead=${raw} hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)  variants=${list.length}`);
  for (const e of list.slice(0, 4)) {
    const { l } = toHsl(e.r / e.n, e.g / e.n, e.b / e.n);
    console.log(`      ${hex(e)}  ${((100 * e.n) / coloured).toFixed(2).padStart(5)}%  lightness=${(l * 100).toFixed(0)}%`);
  }
}
