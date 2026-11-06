// Rebrand the Bluebell build into Black-Box Institution.
// Run from builds/bluebell:  node tools/rebrand-blackbox.mjs [--dry] [--text-only] [--assets-only]
//
// This is deliberately narrower than tools/rebrand.mjs: it changes only the
// VISIBLE brand — the school name, the motto/tagline and the logo assets. It
// never touches env files, Supabase config, package names, ports or the
// lowercase `bluebell_*` database identifiers (table/field names stay as they
// are, per the handover request).
//
// Rules are case-sensitive and longest-first, so `Bluebell` -> `Black-Box` can
// never reach the lowercase `bluebell_*` table names or the `bluebellschool*`
// directory names. The Bluebell placeholder tokens (BLUEBELL_*_PLACEHOLDER) are
// internal sentinels and are left alone too.
//
// The logo pass rebuilds every logo / favicon / app-icon slot from
// brand/blackbox-logo-master.png (the square Black-Box mark) so the black-box
// logo replaces the Bluebell crest on every page, screen and component.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, BRAND } from './guard.mjs';

const DRY = process.argv.includes('--dry');
const TEXT_ONLY = process.argv.includes('--text-only');
const ASSETS_ONLY = process.argv.includes('--assets-only');

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.expo', 'build', 'dist', 'release', 'coverage', '.turbo', '.swc', 'out', 'android', 'ios']);
const BIN_EXT = new Set(['.ico', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.docx', '.pdf', '.woff', '.woff2', '.ttf', '.mp4', '.wav']);
const TEXT_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt',
  '.sql', '.svg', '.yml', '.yaml', '.webmanifest',
]);

// --- visible-name rules (case-sensitive, longest phrase first) ---------------
const NAME_RULES = [
  // JMIS (source) names the earlier Bluebell pass never mapped — they were
  // shipping in the offline CBT and the admin student-record export.
  ['Jeshurun Montessori International High School', BRAND.school.name],
  ['Jeshurun Montessori International School', BRAND.school.name],
  ['Jeshurun Montessori', BRAND.school.short],
  ['Jeshurun', BRAND.school.short],
  ['Bluebell School — Bluebell International School', BRAND.school.name],
  ['Bluebell International High School', BRAND.school.name],
  ['Bluebell International School', BRAND.school.name],
  ['Bluebell High School', BRAND.school.name],
  ['Bluebell School', BRAND.school.name],
  ['BluebellSchool', BRAND.school.name],
  ['JMIS Offline CBT', 'Black-Box Offline CBT'],
  ['Bluebell', BRAND.school.short],
  // Motto / tagline.
  ['Wisdom, Integrity, Courage', BRAND.school.motto],
  ['Wisdom · Integrity · Courage', BRAND.school.levelsLine],
  ['Wisdom, Integrity and Courage', 'Discover, Design and Deliver'],
  ['Wisdom, integrity and courage', 'Discover, design and deliver'],
  // Old Bluebell contact domain/email (not table or field names) -> the known
  // Black-Box domain the project already uses for its own agency credit.
  ['bluebellschool.com', 'blackboxtech.online'],
  ['bluebellmontessorischools@gmail.com', 'info@blackboxtech.online'],
];

// --- which files carry visible branding -------------------------------------
const WALK_ROOTS = [...BRAND.dirs, 'db', 'bluebell-offline-cbt'];
// README.md is intentionally hand-maintained: it keeps the Bluebell history in
// prose, so it is NOT part of the automated pass (this keeps the tool idempotent).
const EXTRA_FILES = ['tools/brand.json', 'tools/site-content.json', 'tools/palette.json'];

function isTextFile(path) {
  const ext = extname(path).toLowerCase();
  if (BIN_EXT.has(ext)) return false;
  return TEXT_EXT.has(ext) || /(^|[\\/])\.env/.test(path);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(full);
  }
  return out;
}

const counts = new Map();
const touched = new Set();

function replaceAll(text, [from, to]) {
  if (!from || from === to) return text;
  let i = 0, n = 0;
  while ((i = text.indexOf(from, i)) !== -1) {
    text = text.slice(0, i) + to + text.slice(i + from.length);
    i += to.length; n++;
  }
  if (n) counts.set(`${from} -> ${to}`, (counts.get(`${from} -> ${to}`) || 0) + n);
  return text;
}

function rebrandText(raw) {
  let text = raw;
  for (const rule of NAME_RULES) text = replaceAll(text, rule);
  return text;
}

function runTextPass() {
  const files = [];
  for (const root of WALK_ROOTS) {
    const dir = join(ROOT, root);
    if (existsSync(dir)) files.push(...walk(dir).filter(isTextFile));
  }
  for (const rel of EXTRA_FILES) {
    const p = join(ROOT, rel);
    if (existsSync(p) && isTextFile(p)) files.push(p);
  }

  for (const full of files) {
    const raw = readFileSync(full, 'utf8');
    const out = rebrandText(raw);
    if (out !== raw) {
      touched.add(relative(ROOT, full));
      if (!DRY) writeFileSync(full, out);
    }
  }

  console.log(`${DRY ? '[dry run] ' : ''}text pass: ${touched.size} file(s) changed`);
  for (const [rule, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${rule}`);
  }
}

// --- asset pass --------------------------------------------------------------
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

// ICO container built by hand (no ImageMagick on this box); every entry is a
// PNG payload, which Windows and electron-builder both accept.
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = Buffer.alloc(16 * entries.length);
  entries.forEach((e, i) => {
    const p = i * 16;
    dir.writeUInt8(e.size === 256 ? 0 : e.size, p);
    dir.writeUInt8(e.size === 256 ? 0 : e.size, p + 1);
    dir.writeUInt8(0, p + 2);
    dir.writeUInt8(0, p + 3);
    dir.writeUInt16LE(1, p + 4);
    dir.writeUInt16LE(32, p + 6);
    dir.writeUInt32LE(e.buf.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += e.buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

async function runAssetPass(sharp) {
  const MASTER = join(ROOT, BRAND.logoMaster);
  if (!existsSync(MASTER)) {
    console.error(`missing ${MASTER} — the master logo is the source of every asset`);
    process.exit(1);
  }
  const meta = await sharp(MASTER).metadata();
  console.log(`\nasset pass: master ${meta.width}x${meta.height} (${relative(ROOT, MASTER)})`);

  const png = (size) => sharp(MASTER).flatten({ background: WHITE })
    .resize(size, size, { fit: 'contain', background: WHITE }).png().toBuffer();
  const jpg = (size) => sharp(MASTER).flatten({ background: WHITE })
    .resize(size, size, { fit: 'contain', background: WHITE }).jpeg({ quality: 92 }).toBuffer();
  const fitOn = async (size, ratio) => {
    const inner = Math.max(8, Math.round(size * ratio));
    const scaled = await sharp(MASTER).flatten({ background: WHITE })
      .resize(inner, inner, { fit: 'inside', background: WHITE }).png().toBuffer();
    const m = await sharp(scaled).metadata();
    const dx = Math.max(0, size - m.width), dy = Math.max(0, size - m.height);
    return sharp(scaled).extend({
      top: Math.ceil(dy / 2), bottom: Math.floor(dy / 2),
      left: Math.ceil(dx / 2), right: Math.floor(dx / 2), background: WHITE,
    }).flatten({ background: WHITE }).png().toBuffer();
  };

  const WEB = BRAND.dirs.slice(0, 4);
  const ADMIN = BRAND.dirs[0];
  const EXPO = BRAND.dirs[4];

  const logoSrc = { favicon: join(ROOT, BRAND.favicon), apple: join(ROOT, BRAND.appleTouch) };
  for (const [k, v] of Object.entries(logoSrc)) {
    if (!existsSync(v)) { console.error(`missing ${v} (${k})`); process.exit(1); }
  }

  const square1024 = await png(1024);
  const square512 = await png(512);
  const square192 = await png(192);
  const jpeg1024 = await jpg(1024);
  const expo64 = await png(64);
  const foreground = await fitOn(432, 0.62);
  const background = await sharp({ create: { width: 432, height: 432, channels: 4, background: WHITE } }).png().toBuffer();

  // Monochrome android layer: dark ink -> alpha so the launcher can tint it.
  const monoRaw = await sharp(foreground).greyscale().ensureAlpha().raw().toBuffer();
  const px = 432 * 432;
  const mono = Buffer.alloc(px * 4);
  let ink = 0;
  for (let i = 0; i < px; i++) {
    const grey = monoRaw[i * 4];
    mono[i * 4] = 0; mono[i * 4 + 1] = 0; mono[i * 4 + 2] = 0;
    const a = Math.max(0, 255 - grey);
    mono[i * 4 + 3] = a;
    if (a > 8) ink++;
  }
  const coverage = (100 * ink) / px;
  if (coverage < 2) { console.error(`monochrome layer only ${coverage.toFixed(1)}% ink — aborting`); process.exit(1); }
  const monochrome = await sharp(mono, { raw: { width: 432, height: 432, channels: 4 } }).png().toBuffer();

  const writes = new Map();
  for (const app of WEB) {
    writes.set(`${app}/public/logo.png`, square1024);
    writes.set(`${app}/public/logo.jpg`, jpeg1024);
    writes.set(`${app}/public/favicon.ico`, readFileSync(logoSrc.favicon));
    writes.set(`${app}/public/apple-touch-icon.png`, readFileSync(logoSrc.apple));
  }
  writes.set(`${ADMIN}/public/logo192.png`, square192);
  writes.set(`${ADMIN}/public/logo512.png`, square512);
  writes.set(`${ADMIN}/src/assets/logo.png`, square1024);
  writes.set(`${ADMIN}/src/assets/logo.jpg`, jpeg1024);
  writes.set(`${ADMIN}/app/favicon.ico`, readFileSync(logoSrc.favicon));

  // The offline CBT desktop app (a sixth tree, outside brand.dirs).
  const OFFLINE = 'bluebell-offline-cbt';
  writes.set(`${OFFLINE}/public/logo.png`, square1024);
  writes.set(`${OFFLINE}/public/logo.jpg`, jpeg1024);
  writes.set(`${OFFLINE}/public/favicon.ico`, readFileSync(logoSrc.favicon));
  writes.set(`${OFFLINE}/public/apple-touch-icon.png`, readFileSync(logoSrc.apple));
  // electron-builder pack icon (win.icon = build/icon.ico) + the source PNG.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  writes.set(`${OFFLINE}/build/icon.png`, square1024);
  writes.set(`${OFFLINE}/build/icon.ico`, buildIco(await Promise.all(
    icoSizes.map(async (size) => ({ size, buf: await png(size) })),
  )));

  writes.set(`${EXPO}/assets/icon.png`, square1024);
  writes.set(`${EXPO}/assets/splash-icon.png`, square1024);
  writes.set(`${EXPO}/assets/favicon.png`, expo64);
  writes.set(`${EXPO}/assets/android-icon-foreground.png`, foreground);
  writes.set(`${EXPO}/assets/android-icon-background.png`, background);
  writes.set(`${EXPO}/assets/android-icon-monochrome.png`, monochrome);

  for (const [rel, buf] of writes) {
    const p = join(ROOT, rel);
    if (!DRY) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); }
    console.log(`  ${String(buf.length).padStart(8)} B  ${rel}`);
  }
  console.log(`asset pass: ${writes.size} slot(s) written  (monochrome ${coverage.toFixed(1)}% ink)`);

  if (!DRY) {
    const SQUARE = {
      [`${ADMIN}/public/logo.png`]: 1024, [`${ADMIN}/public/logo192.png`]: 192, [`${ADMIN}/public/logo512.png`]: 512,
      [`${ADMIN}/src/assets/logo.png`]: 1024, [`${WEB[1]}/public/logo.png`]: 1024,
      [`${WEB[2]}/public/logo.png`]: 1024, [`${WEB[3]}/public/logo.png`]: 1024,
      [`${EXPO}/assets/icon.png`]: 1024, [`${EXPO}/assets/splash-icon.png`]: 1024, [`${EXPO}/assets/favicon.png`]: 64,
    };
    let bad = 0;
    for (const [rel, want] of Object.entries(SQUARE)) {
      const m = await sharp(join(ROOT, rel)).metadata();
      if (m.width !== want || m.height !== want) { console.error(`  x ${rel} is ${m.width}x${m.height}, expected ${want}`); bad++; }
    }
    if (bad) { console.error(`\n${bad} asset slot(s) wrong`); process.exit(1); }
    console.log('asset pass: every square slot read back at its expected size');
  }
}

// --- main --------------------------------------------------------------------
console.log(`Black-Box Institution rebrand — ${new Date().toISOString()}`);
if (!ASSETS_ONLY) runTextPass();
if (!TEXT_ONLY) {
  const require = createRequire(join(ROOT, BRAND.dirs[0], 'package.json'));
  const sharp = require('sharp');
  await runAssetPass(sharp);
}
