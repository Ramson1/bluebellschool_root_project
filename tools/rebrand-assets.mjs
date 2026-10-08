// Derive every logo / favicon / Expo icon from brand/bluebell-logo-master.png and
// overwrite the JMIS-branded copies the clone inherited.
// Run from builds/bluebell:  node tools/rebrand-assets.mjs [--preview] [--mark-box=cx,cy,side]
//
// sharp is only installed inside the JMIS workspace, so it is required by path.
// Sizes mirror what JMIS shipped, so nothing that references them has to change:
//   public/logo.png 802, logo192.png 192, logo512.png 512, logo.jpg (JPEG),
//   public/favicon.ico multi-size, Expo icon/splash 1024, android-* 432, favicon.png 64.
//
// Two compositions are used on purpose:
//   full  — the whole crest (wreath + ring text + motto), for headers, documents,
//           result cards and splash, everywhere >= 192 px where the lettering is legible
//   mark  — the centre shield cropped to a square, which stays readable at 16-64 px
//           where the crest's ring lettering is only mush
//
// A sharp instance keeps only ONE resize specification no matter how many
// .resize() calls are chained, and libvips applies it before .extend(). So fitting
// and padding are separate passes below (markCanvas), and every file is read back
// and asserted at the end.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, BRAND, PALETTE } from './guard.mjs';

const require = createRequire(join(BRAND.source.root, 'jmischool', 'package.json'));
const sharp = require('sharp');

const MASTER = join(ROOT, BRAND.logoMaster);
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const TRIM = 8;

if (!existsSync(MASTER)) {
  console.error(`missing ${MASTER} — the master logo is the source of every asset`);
  process.exit(1);
}

const APPS = BRAND.dirs;                    // 4 web apps + attendance-app, brand.json order
const ADMIN = APPS[0];
const WEB_APPS = APPS.slice(0, 4);
const EXPO = `${APPS[4]}/assets`;

const base = sharp(MASTER).flatten({ background: WHITE });
const meta = await base.metadata();
console.log(`master ${meta.width}x${meta.height}`);

// --- full crest --------------------------------------------------------------
const full = await sharp(MASTER)
  .flatten({ background: WHITE })
  .resize(meta.width, meta.height, { fit: 'contain', background: WHITE })
  .png()
  .toBuffer();

// --- centre-shield mark ------------------------------------------------------
// Bluebell's crest is a round wreath-and-ring-text emblem. Spring's fixed
// 0.78-of-height band (right for a wide banner-over-shield) would keep the
// unreadable ring lettering here, so the mark is instead a CENTRE SQUARE of the
// trimmed emblem: side = side * trimmedWidth, centred at (cx, cy) of the trimmed
// box. The defaults are Bluebell's shield centre; --mark-box lets the numbers be
// tuned against .verify/mark-preview.jpg without editing the file.
function parseMarkBox() {
  const a = process.argv.find((s) => s.startsWith('--mark-box='));
  const d = (BRAND.assets && BRAND.assets.markBox) || { cx: 0.5, cy: 0.49, side: 0.30 };
  if (!a) return { cx: d.cx, cy: d.cy, side: d.side };
  const parts = a.slice('--mark-box='.length).split(',').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n <= 0) || parts[2] > 1) {
    console.error('bad --mark-box, want --mark-box=cx,cy,side as fractions of the trimmed box (0..1)');
    process.exit(1);
  }
  return { cx: parts[0], cy: parts[1], side: parts[2] };
}

const trimmed = await sharp(MASTER).flatten({ background: WHITE }).trim({ threshold: TRIM }).png().toBuffer();
const t = await sharp(trimmed).metadata();
const box = parseMarkBox();
const S = Math.round(box.side * t.width);
const left = Math.max(0, Math.min(t.width - S, Math.round(box.cx * t.width - S / 2)));
const top = Math.max(0, Math.min(t.height - S, Math.round(box.cy * t.height - S / 2)));
// flatten->trim->extract->trim: re-trim drops the square's dead corners so the
// shield fills the mark canvas edge to edge.
const shield = await sharp(trimmed)
  .extract({ left, top, width: S, height: S })
  .trim({ threshold: TRIM })
  .png()
  .toBuffer();
const shieldMeta = await sharp(shield).metadata();
console.log(`trimmed ${t.width}x${t.height}  mark crop ${shieldMeta.width}x${shieldMeta.height} from box(${left},${top},${S})  cx=${box.cx} cy=${box.cy} side=${box.side}`);

/**
 * Fit `shield` into `size` x `size` with the artwork at most `innerRatio * size`,
 * centred on a white canvas. Two passes on purpose: one resize per pass.
 */
async function markCanvas(size, innerRatio = 0.94) {
  const inner = Math.max(8, Math.round(size * innerRatio));
  const scaled = await sharp(shield)
    .resize(inner, inner, { fit: 'inside', background: WHITE })
    .png()
    .toBuffer();
  const m = await sharp(scaled).metadata();
  const dx = Math.max(0, size - m.width);
  const dy = Math.max(0, size - m.height);
  return sharp(scaled)
    .extend({
      top: Math.ceil(dy / 2), bottom: Math.floor(dy / 2),
      left: Math.ceil(dx / 2), right: Math.floor(dx / 2),
      background: WHITE,
    })
    .flatten({ background: WHITE })
    .png()
    .toBuffer();
}

const fullSquare = async (size) => sharp(full)
  .resize(size, size, { fit: 'contain', background: WHITE })
  .flatten({ background: WHITE })
  .png()
  .toBuffer();

// --- preview mode: contact sheet of the mark at the sizes that must stay legible
if (process.argv.includes('--preview')) {
  const vdir = join(ROOT, '.verify');
  mkdirSync(vdir, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128];
  const cells = [];
  for (const s of sizes) cells.push({ s, buf: await markCanvas(s, 0.94) });
  const pad = 24; const H = 128 + 2 * pad; let x = pad;
  const imgs = [];
  for (const c of cells) {
    const m = await sharp(c.buf).metadata();
    imgs.push({ input: c.buf, left: x, top: Math.round((H - m.height) / 2) });
    x += Math.max(m.width, c.s) + pad;
  }
  await sharp({ create: { width: x, height: H, channels: 3, background: WHITE } })
    .composite(imgs).flatten({ background: WHITE }).jpeg({ quality: 92 })
    .toFile(join(vdir, 'mark-preview.jpg'));
  await sharp(shield).resize(512, 512, { fit: 'contain', background: WHITE }).flatten({ background: WHITE })
    .png().toFile(join(vdir, 'mark-512.png'));
  console.log(`\nwrote .verify/mark-preview.jpg  (mark at ${sizes.join('/')} px) and .verify/mark-512.png`);
  console.log('inspect the preview; retune with --mark-box=cx,cy,side if the shield is off-centre or clipped.');
  process.exit(0);
}

// --- ICO container (no ImageMagick on this box) ------------------------------
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type: icon
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = Buffer.alloc(16 * entries.length);
  entries.forEach((e, i) => {
    const p = i * 16;
    dir.writeUInt8(e.size === 256 ? 0 : e.size, p);
    dir.writeUInt8(e.size === 256 ? 0 : e.size, p + 1);
    dir.writeUInt8(0, p + 2);            // palette colours
    dir.writeUInt8(0, p + 3);            // reserved
    dir.writeUInt16LE(1, p + 4);         // colour planes
    dir.writeUInt16LE(32, p + 6);        // bits per pixel
    dir.writeUInt32LE(e.buf.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += e.buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

// --- adaptive-icon layers ----------------------------------------------------
const ADAPTIVE = 432;
const SAFE = 264 / ADAPTIVE;
const androidForeground = await markCanvas(ADAPTIVE, SAFE);
const androidBackground = await sharp({
  create: { width: ADAPTIVE, height: ADAPTIVE, channels: 4, background: WHITE },
}).png().toBuffer();

// Monochrome layer: ink becomes alpha so the launcher can tint the silhouette.
// greyscale().raw() alone keeps more than one channel per pixel, so the raw
// stream is forced to RGBA and indexed 4 bytes per pixel.
const monoSource = await sharp(androidForeground).greyscale().ensureAlpha().raw().toBuffer();
const monoPx = ADAPTIVE * ADAPTIVE;
const mono = Buffer.alloc(monoPx * 4);
let monoInk = 0;
for (let i = 0; i < monoPx; i++) {
  const grey = monoSource[i * 4];                 // R == G == B after greyscale
  mono[i * 4] = 0; mono[i * 4 + 1] = 0; mono[i * 4 + 2] = 0;
  const ink = Math.max(0, 255 - grey);            // dark ink -> opaque
  mono[i * 4 + 3] = ink;
  if (ink > 8) monoInk++;
}
const monoCoverage = (100 * monoInk) / monoPx;
if (monoCoverage < 2) {
  console.error(`monochrome layer is only ${monoCoverage.toFixed(1)}% ink — aborting`);
  process.exit(1);
}
const androidMonochrome = await sharp(mono, {
  raw: { width: ADAPTIVE, height: ADAPTIVE, channels: 4 },
}).png().toBuffer();

// --- write everything --------------------------------------------------------
const ICO_SIZES = [16, 24, 32, 48, 64];
const faviconIco = buildIco(await Promise.all(
  ICO_SIZES.map(async (size) => ({ size, buf: await markCanvas(size, 0.94) }))
));

const logoPng802 = await fullSquare(802);
const logoPng192 = await fullSquare(192);
const logoPng512 = await fullSquare(512);
const logoJpg = await sharp(full).flatten({ background: WHITE }).jpeg({ quality: 92 }).toBuffer();
const icon1024 = await fullSquare(1024);
const expoFavicon = await markCanvas(64, 0.94);

const writes = new Map();
for (const app of WEB_APPS) {
  writes.set(`${app}/public/logo.png`, logoPng802);
  writes.set(`${app}/public/logo.jpg`, logoJpg);
  writes.set(`${app}/public/favicon.ico`, faviconIco);
}
writes.set(`${ADMIN}/public/logo192.png`, logoPng192);
writes.set(`${ADMIN}/public/logo512.png`, logoPng512);
writes.set(`${ADMIN}/src/assets/logo.png`, logoPng802);
writes.set(`${ADMIN}/src/assets/logo.jpg`, logoJpg);

writes.set(`${EXPO}/icon.png`, icon1024);
writes.set(`${EXPO}/splash-icon.png`, icon1024);
writes.set(`${EXPO}/favicon.png`, expoFavicon);
writes.set(`${EXPO}/android-icon-foreground.png`, androidForeground);
writes.set(`${EXPO}/android-icon-background.png`, androidBackground);
writes.set(`${EXPO}/android-icon-monochrome.png`, androidMonochrome);

// Every PNG slot the apps assume is square, asserted after the write.
const SQUARE = {
  [`${ADMIN}/public/logo.png`]: 802, [`${ADMIN}/public/logo192.png`]: 192,
  [`${ADMIN}/public/logo512.png`]: 512, [`${ADMIN}/src/assets/logo.png`]: 802,
  [`${WEB_APPS[1]}/public/logo.png`]: 802, [`${WEB_APPS[2]}/public/logo.png`]: 802,
  [`${WEB_APPS[3]}/public/logo.png`]: 802,
  [`${EXPO}/icon.png`]: 1024, [`${EXPO}/splash-icon.png`]: 1024, [`${EXPO}/favicon.png`]: 64,
  [`${EXPO}/android-icon-foreground.png`]: ADAPTIVE,
  [`${EXPO}/android-icon-background.png`]: ADAPTIVE,
  [`${EXPO}/android-icon-monochrome.png`]: ADAPTIVE,
};

for (const [rel, buf] of writes) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  console.log(`${String(buf.length).padStart(8)} B  ${rel}`);
}

console.log(`\n${writes.size} assets written from ${BRAND.logoMaster}`);
console.log(`favicon.ico: ${ICO_SIZES.join('/')} px, PNG-encoded entries`);
console.log(`brand primary ${PALETTE.slots.primary.hex} (see tools/palette.json)`);
console.log(`monochrome coverage ${monoCoverage.toFixed(1)}% ink`);

let bad = 0;
for (const [rel, want] of Object.entries(SQUARE)) {
  const m = await sharp(join(ROOT, rel)).metadata();
  if (m.width !== want || m.height !== want) {
    console.error(`  x ${rel} is ${m.width}x${m.height}, expected ${want}x${want}`);
    bad++;
  }
}
// sharp cannot read a PNG-payload .ico (it expects BMP frames), so the container
// is parsed directly: every entry must be a PNG whose IHDR matches the size the
// directory claims, which also proves the offsets are right.
const icoBuf = readFileSync(join(ROOT, ADMIN, 'public', 'favicon.ico'));
const icoFrames = [];
const icoCount = icoBuf.readUInt16LE(4);
for (let i = 0; i < icoCount; i++) {
  const p = 6 + i * 16;
  const claim = icoBuf.readUInt8(p) || 256;
  const off = icoBuf.readUInt32LE(p + 12);
  const isPng = icoBuf.readUInt32BE(off) === 0x89504e47;
  const w = isPng ? icoBuf.readUInt32BE(off + 16) : 0;
  const h = isPng ? icoBuf.readUInt32BE(off + 20) : 0;
  if (!isPng || w !== claim || h !== claim) {
    console.error(`  x favicon.ico entry ${i} claims ${claim}px but holds ${isPng ? w + 'x' + h : 'a non-PNG payload'}`);
    bad++;
  } else {
    icoFrames.push(`${w}x${h}`);
  }
}
if (icoCount !== ICO_SIZES.length) {
  console.error(`  x favicon.ico holds ${icoCount} frame(s), expected ${ICO_SIZES.length}`);
  bad++;
}
if (bad) {
  console.error(`\n${bad} asset slot(s) are wrong — not a clean build`);
  process.exit(1);
}
console.log(`\nOK: every slot read back at its expected size; favicon.ico frames ${icoFrames.join(', ')}`);
