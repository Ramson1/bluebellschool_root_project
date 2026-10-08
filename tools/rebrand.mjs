// Rebrand the JMIS clone into Bluebell International School.
// Run from builds/bluebell:  node tools/rebrand.mjs [--dry]
//
// Everything is a deterministic, ordered text pass over source files only:
// node_modules / .next / .git / .expo / build output are never touched, and
// binary assets are skipped (they are handled by tools/rebrand-assets.mjs).
//
// Identity comes from tools/brand.json, colour from tools/palette.json, and the
// Supabase triple from tools/backend.json when the keys have been supplied -
// until then the code-level ref becomes BLUEBELL_SUPABASE_REF_PLACEHOLDER, which
// is greppable and boots, so this pass can run long before the project exists.
//
// Rules are case-sensitive and longest-first on purpose: `JMIS` -> `Bluebell`
// must never reach the lowercase `bluebell_*` table names, which stay as they are
// because Bluebell gets its own database project.
//
// It prints a per-rule hit count plus the touched-file list, and flags any brand
// green it could not map, so nothing is silently half-renamed. Re-running with
// --dry afterwards must report 0 files changed (idempotence gate).

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { ROOT, BRAND, PALETTE, APPS, PORTS, ATTENDANCE_WEB_PORT, JMIS_REF, backend, DRY, assertNotForbidden, ORIGINS } from './guard.mjs';


const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.expo', 'build', 'dist', 'coverage', '.turbo', '.swc']);
const TEXT_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt',
  '.sql', '.svg', '.yml', '.yaml', '.gitignore', '.babelrc', '.eslintrc', '.editorconfig',
]);

// --- Supabase backend -------------------------------------------------------
const BE = backend();
assertNotForbidden(BE.ref, 'resolved backend');
if (BE.keysPending) {
  console.log('NOTE: tools/backend.json not found — writing BLUEBELL_*_PLACEHOLDER refs.');
  console.log('      Run tools/set-backend.mjs once Bluebell\'s project exists.\n');
}

// --- naming -----------------------------------------------------------------
// Order matters: the longest phrases first, and JMISchool before JMIS so the
// trailing "chool" is not orphaned into "Bluebellchool".
const NAMES = [
  ['Jeshurun Montessori International High School', 'Bluebell International High School'],
  ['Jeshurun Montessori International School', BRAND.school.name],
  ['Jeshurun Montessori', BRAND.school.short],
  ['Jeshurun High School', 'Bluebell High School'],
  ['Jeshurun', BRAND.school.short],
  ['Rhema Expert Solutions School Management System', `${BRAND.school.name} Management System`],
  ['Rhema E.S.', BRAND.school.name],
  ['JMISchool', 'BluebellSchool'],
  ['JMIS School', 'Bluebell School'],
  ['J.M.I.S.', BRAND.school.short],
  ['J.M.I.S', BRAND.school.short],
  ['JMIS', BRAND.school.short],
  ['JMIC', BRAND.school.short],
  ['jmischool', 'bluebellschool'],
  ['Jmischool', 'Bluebellschool'],
  [JMIS_REF, BE.ref],
];

// Literal copy the ordered name pass cannot express on its own. Anything not
// known about Bluebell becomes a greppable placeholder rather than an invention.
const PHRASES = [
  // JMIS's campus line is meaningless here; a placeholder keeps it visible in
  // every exported lesson plan / document until Bluebell's address is supplied.
  ['Abuja-Ode · Jebba-Oko · Oyo State', 'BLUEBELL_LOCATION_PLACEHOLDER'],
  // The printable result cards hard-code the source school's own contact block.
  ['Everlasting Grace Estate, besides Princess Favour Hotel, Eze T.O.A Ejekwu Road, Atali Rivers State', 'BLUEBELL_ADDRESS_PLACEHOLDER'],
  ['+2349137184534, +2349078808642', 'BLUEBELL_PHONE_PLACEHOLDER'],
  ['jeshurunmontessori@gmail.com', 'BLUEBELL_EMAIL_PLACEHOLDER'],
  // A staff-form example email carried the source school's own domain (spelled
  // with a doubled s, so the `jmischool` name rule never reached it).
  ['jmisschool.edu.ng', 'BLUEBELL_DOMAIN_PLACEHOLDER'],
  ['finis cricine pendet', 'BLUEBELL_MOTTO_PLACEHOLDER'],
  // Payments are the one string that must never cross schools: the source
  // build's public key routes Bluebell's school fees into JMIS's merchant account.
  ['FLWPUBK-9188e6b6d39bd8428fbca0a96d1ae8c9-X', 'BLUEBELL_FLUTTERWAVE_PUBLIC_KEY_PLACEHOLDER'],
  // The hero badge states the source school's year range, which is not
  // Bluebell's; the crest's own ribbon wording replaces it.
  ['Creche • Nursery • Primary • Secondary', BRAND.school.levelsLine],
  // The public site's meta description carries the same year range.
  ['a nurturing, values-driven education from Creche to Secondary',
    'a values-driven international school education built on Wisdom, Integrity and Courage'],
];

// --- palette ----------------------------------------------------------------
const HEX = PALETTE.greenToBlue.map(([from, to]) => [from, to]);
const RGBA = [];
for (const [from, to] of PALETTE.rgbaGreenToBlue) {
  RGBA.push([from, to]);
  RGBA.push([from.replace(/ /g, ''), to.replace(/ /g, '')]);
}
const KEEP_GREEN = new Set(PALETTE.keepGreen.map((h) => h.toLowerCase()));

const counts = new Map();
const touched = new Set();
const leftovers = new Set();

function bump(rule, n = 1) {
  counts.set(rule, (counts.get(rule) || 0) + n);
}

function isTextFile(path) {
  const ext = extname(path).toLowerCase();
  if (['.ico', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.docx', '.pdf', '.woff', '.woff2', '.ttf', '.mp4'].includes(ext)) return false;
  return TEXT_EXT.has(ext) || ext === '.env' || /(^|[\\/])\.env/.test(path);
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

function replaceAll(text, [from, to]) {
  if (!from || from === to) return text;
  let i = 0, n = 0;
  while ((i = text.indexOf(from, i)) !== -1) {
    text = text.slice(0, i) + to + text.slice(i + from.length);
    i += to.length; n++;
  }
  if (n) bump(`${from} -> ${to}`, n);
  return text;
}

function rebrandText(raw) {
  let text = raw;
  for (const rule of NAMES) text = replaceAll(text, rule);
  for (const rule of PHRASES) text = replaceAll(text, rule);

  for (const [from, to] of HEX) {
    const re = new RegExp(`${from}\\b`, 'gi');
    const n = (text.match(re) || []).length;
    if (n) { text = text.replace(re, to); bump(`${from} -> ${to} (colour)`, n); }
  }
  for (const [from, to] of RGBA) {
    const body = from.split(',').map((p) => p.trim()).join(', *');
    const re = new RegExp(`rgba\\( *${body}`, 'g');
    const n = (text.match(re) || []).length;
    if (n) { text = text.replace(re, `rgba(${to}`); bump(`rgba(${from}) (colour)`, n); }
  }

  // Flag any green-dominant hex that survived: a brand colour nobody mapped.
  for (const m of text.matchAll(/#[0-9a-f]{6}\b/gi)) {
    const h = m[0].toLowerCase();
    const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    if (g > r + 18 && g > b + 18 && !KEEP_GREEN.has(h)) leftovers.add(h);
  }
  return text;
}

// --- 1. text pass over every source file ------------------------------------
const files = [];
for (const app of APPS) {
  const dir = join(ROOT, app);
  if (existsSync(dir)) files.push(...walk(dir).filter(isTextFile));
}

for (const full of files) {
  const raw = readFileSync(full, 'utf8');
  const out = rebrandText(raw);
  if (out !== raw) {
    touched.add(relative(ROOT, full));
    if (!DRY) writeFileSync(full, out);
  }
}

// --- 2. package.json: name + dev port ---------------------------------------
for (const [app, port] of Object.entries(PORTS)) {
  const p = join(ROOT, app, 'package.json');
  if (!existsSync(p)) continue;
  const pkg = JSON.parse(readFileSync(p, 'utf8'));
  pkg.name = app;
  const dev = pkg.scripts?.dev || 'next dev';
  pkg.scripts.dev = dev.includes('-p ') ? dev.replace(/-p \d+/, `-p ${port}`) : `${dev} -p ${port}`;
  if (pkg.scripts.start) {
    pkg.scripts.start = pkg.scripts.start.includes('-p ')
      ? pkg.scripts.start.replace(/-p \d+/, `-p ${port}`)
      : `next start -p ${port}`;
  }
  bump(`${app}: dev port ${port}`, 1);
  if (!DRY) writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
}

// Expo web preview gets its own port too, so `npm run web` never collides.
{
  const p = join(ROOT, 'bluebellschool-attendance-app', 'package.json');
  if (existsSync(p)) {
    const pkg = JSON.parse(readFileSync(p, 'utf8'));
    if (pkg.scripts?.web) {
      const base = pkg.scripts.web.replace(/ --port \d+/, '');
      pkg.scripts.web = `${base} --port ${ATTENDANCE_WEB_PORT}`;
      bump(`bluebellschool-attendance-app: expo web port ${ATTENDANCE_WEB_PORT}`, 1);
      if (!DRY) writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
    }
  }
}

// --- 3. env files: Bluebell's own Supabase + local portal origins -----------
const ENV_KEYS = {
  NEXT_PUBLIC_SUPABASE_URL: BE.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: BE.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: BE.serviceKey,
  NEXT_PUBLIC_STAFF_PORTAL_URL: ORIGINS['bluebellschool-staff'],
  NEXT_PUBLIC_STUDENT_PORTAL_URL: ORIGINS['bluebellschool-student'],
  NEXT_PUBLIC_ADMIN_URL: ORIGINS['bluebellschool'],
  NEXT_PUBLIC_WEBSITE_URL: ORIGINS['bluebellschool-website'],
  NEXT_PUBLIC_ATTENDANCE_APP_URL: `http://localhost:${ATTENDANCE_WEB_PORT}`,
  STAFF_URL: ORIGINS['bluebellschool-staff'],
  STUDENT_URL: ORIGINS['bluebellschool-student'],
  // Result/admission notifications read this first and fall back to
  // bluebell_settings.adminEmail, so Bluebell's mail can never reach JMIS's inbox.
  NEXT_PUBLIC_RESULT_EMAIL_RECIPIENTS: '',
};

for (const app of APPS) {
  for (const name of ['.env', '.env.local', '.env.development']) {
    const p = join(ROOT, app, name);
    if (!existsSync(p)) continue;
    const lines = readFileSync(p, 'utf8').split(/\r?\n/);
    const seen = new Set();
    const next = lines.map((line) => {
      const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (!m) return line;
      seen.add(m[1]);
      if (m[1] in ENV_KEYS) return `${m[1]}=${ENV_KEYS[m[1]] ?? ''}`;
      return line;
    });
    // add the public portal origins this app references but left out of its file
    for (const [k, v] of Object.entries(ENV_KEYS)) {
      if (seen.has(k) || !k.startsWith('NEXT_PUBLIC_')) continue;
      if (k === 'NEXT_PUBLIC_ATTENDANCE_APP_URL' && app !== 'bluebellschool-website') continue;
      if (!next.some((l) => l.startsWith(`${k}=`))) next.push(`${k}=${v ?? ''}`);
    }
    bump(`${app}/${name}: supabase -> ${BE.ref}`, 1);
    if (!DRY) writeFileSync(p, next.join('\n') + '\n');
  }
}

// --- 4. Expo app.json: the anon key is a JWT, so the project ref inside it is
//        base64-encoded and no text rule can reach it. Patch it structurally.
{
  const p = join(ROOT, 'bluebellschool-attendance-app', 'app.json');
  if (existsSync(p)) {
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    const before = JSON.stringify(cfg);
    cfg.expo.extra = {
      ...cfg.expo.extra,
      supabaseUrl: BE.url,
      supabaseAnonKey: BE.anonKey,
      // The EAS project belongs to JMIS; leaving it here would publish a
      // Bluebell APK into JMIS's build project. Create one for Bluebell first.
      eas: { projectId: '' },
    };
    if (JSON.stringify(cfg) !== before) {
      touched.add(relative(ROOT, p));
      bump('bluebellschool-attendance-app/app.json: supabase + eas identity', 1);
      if (!DRY) writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
    }
  }
}

// --- report -----------------------------------------------------------------
console.log(`${DRY ? '[dry run] ' : ''}files changed: ${touched.size}`);
console.log('\nrule hits:');
for (const [rule, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${rule}`);
}
if (touched.size) {
  console.log('\ntouched files:');
  for (const f of [...touched].sort()) console.log(`  ${f}`);
}
if (leftovers.size) {
  console.log('\nUNMAPPED green-dominant colours (review, not auto-changed):');
  console.log('  ' + [...leftovers].sort().join(' '));
} else {
  console.log('\nno unmapped brand greens remain');
}
console.log(`\npalette: ${HEX.length} hex + ${PALETTE.rgbaGreenToBlue.length} rgba rules from ${BRAND.paletteFile}`);
console.log(`primary ${PALETTE.slots.primary.hex} (white text ${PALETTE.contrastVsWhite.primary}:1)  deep ${PALETTE.slots.deep.hex}  light ${PALETTE.slots.light.hex}`);
console.log(`Supabase backend: ${BE.url}${BE.keysPending ? '  (PLACEHOLDER — keys not supplied yet)' : '  (from tools/backend.json)'}`);
if (!DRY && touched.size) {
  mkdirSync(join(ROOT, '.verify'), { recursive: true });
  writeFileSync(join(ROOT, '.verify', 'rebrand-touched.txt'), [...touched].sort().join('\n') + '\n');
}
