// Derives the website's marketing imagery from the generated masters in
// brand/site/ and writes optimised JPEGs into every app that previews them.
//
//   node tools/build-site-images.mjs
//
// Sizes follow the clone plan: heroes 1920w, facilities/gallery/about 1200w,
// portraits 400w, all at quality 78 — the whole set stays under the weight
// ceiling in brand.json (4 MB) so Bluebell's site is populated with zero
// Supabase Storage uploads. The paths written into the seeded JSON are
// app-root relative (`/site/<name>.jpg`), which `settingFileUrl()` passes
// straight through.
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, BRAND } from './guard.mjs';

// sharp is only installed in the JMIS admin tree; resolve it from there.
const require = createRequire(join(BRAND.source.root, 'jmischool', 'package.json'));
const sharp = require('sharp');

const SRC = join(ROOT, 'brand', 'site');
const WEB = BRAND.dirs[1];   // bluebellschool-website
const ADMIN = BRAND.dirs[0]; // bluebellschool (so the admin Setting page previews work)
const TARGETS = [
  join(ROOT, WEB, 'public', 'site'),
  join(ROOT, ADMIN, 'public', 'site'),
];

const WIDTHS = { hero: 1920, facility: 1200, gallery: 1200, about: 1200, portrait: 400 };
const Q = 78;
const CEILING = BRAND.siteImageWeightCeilingBytes || 4 * 1024 * 1024;

const ext = (f) => {
  const i = f.lastIndexOf('.');
  return i < 0 ? '' : f.slice(i);
};
const widthFor = (name) => {
  for (const [key, w] of Object.entries(WIDTHS)) if (name.startsWith(key)) return w;
  return 1200;
};

const files = readdirSync(SRC).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
if (!files.length) {
  console.error(`No master images found in ${SRC}`);
  process.exit(1);
}
for (const t of TARGETS) mkdirSync(t, { recursive: true });

let total = 0;
for (const file of files) {
  const name = basename(file, ext(file));
  const width = widthFor(name);
  const buf = await sharp(join(SRC, file))
    .flatten({ background: '#ffffff' })
    .resize({ width })
    .jpeg({ quality: Q, mozjpeg: true })
    .toBuffer();
  for (const t of TARGETS) writeFileSync(join(t, `${name}.jpg`), buf);
  total += buf.length;
  console.log(`${String(buf.length).padStart(7)} B  ${String(width).padStart(4)}w  ${name}.jpg`);
}

const mb = (total / 1024 / 1024).toFixed(2);
console.log(`\n${files.length} images (${mb} MB each set) -> ${TARGETS.map((t) => t.replace(ROOT + '/', '')).join(', ')}`);
if (total > CEILING) {
  console.error(`FAIL: the set is ${mb} MB, over the ${CEILING / 1024 / 1024} MB ceiling — lower a width or quality`);
  process.exit(1);
}
console.log(`OK: within the ${(CEILING / 1024 / 1024).toFixed(1)} MB weight ceiling.`);
