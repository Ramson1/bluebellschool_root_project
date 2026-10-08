// Post-build verification for the Bluebell clone. Run with the five apps booted.
//
//   node tools/verify.mjs            # everything
//   node tools/verify.mjs --brand    # residual-brand scan only (no servers needed)
//   node tools/verify.mjs --db       # Supabase table probe only
//   node tools/verify.mjs --routes   # served-title map, route probes, asset probes
//
// Nothing here writes anything. Every check prints PASS/FAIL and the process
// exits non-zero if any check failed, so it can gate a deploy.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, BRAND, backend, JMIS_REF, FORBIDDEN_REFS, ATTENDANCE_WEB_PORT } from './guard.mjs';

const args = process.argv.slice(2);
const only = (name) => args.length === 0 || args.includes(`--${name}`);

const D = BRAND.dirs; // [admin, website, staff, student, attendance]
const P = BRAND.ports;
const T = BRAND.titles;
const APPS = [
  { dir: D[0], port: P[D[0]], expectTitle: new RegExp(T[D[0]], 'i'), label: 'admin' },
  { dir: D[1], port: P[D[1]], expectTitle: new RegExp(T[D[1]], 'i'), label: 'website' },
  { dir: D[2], port: P[D[2]], expectTitle: new RegExp(T[D[2]], 'i'), label: 'staff' },
  { dir: D[3], port: P[D[3]], expectTitle: new RegExp(T[D[3]], 'i'), label: 'student' },
  { dir: D[4], port: ATTENDANCE_WEB_PORT, expectTitle: /bluebell|expo|attendance/i, label: 'attendance (expo web)', expoOnly: true },
];

const ROUTES = {
  // Every path here was read out of the app's own route folders (app/*/page.tsx);
  // the portals are single-page shells, so their interior navigation is client-side.
  [D[0]]: ['/', '/login', '/home', '/setting', '/result', '/midterm_result', '/CBTQuestions',
    '/cbt', '/attendance', '/payments', '/full_student', '/notes', '/lesson_plans', '/assignments',
    '/messages', '/data_tools', '/enquiries', '/roles_access', '/session_tools', '/auditlogs', '/idcards', '/receipt', '/paystack'],
  [D[1]]: ['/', '/cbt', '/admissions', '/contact', '/exam', '/exam?type=objective', '/exam?type=completion', '/exam?type=essay'],
  [D[2]]: ['/', '/login', '/impersonate'],
  [D[3]]: ['/', '/login', '/impersonate', '/resultcard'],
  [D[4]]: [],
};

const ASSETS = {
  [D[0]]: ['/logo.png', '/logo.jpg', '/logo192.png', '/logo512.png', '/favicon.ico', '/manifest.json', '/ads.txt'],
  [D[1]]: ['/logo.png', '/logo.jpg', '/favicon.ico'],
  [D[2]]: ['/logo.png', '/logo.jpg', '/favicon.ico'],
  [D[3]]: ['/logo.png', '/logo.jpg', '/favicon.ico'],
  [D[4]]: ['/favicon.ico'],
};
const SITE_IMAGES = [
  'hero-classroom', 'hero-outdoor', 'hero-library',
  'facility-workroom', 'facility-library', 'facility-playground', 'facility-art', 'facility-ict',
  'gallery-classroom', 'gallery-reading', 'gallery-maths', 'gallery-art', 'gallery-sports',
  'gallery-music', 'gallery-science', 'gallery-graduation', 'about-welcome',
  'portrait-parent', 'portrait-teacher', 'portrait-pupil',
].map((n) => `/site/${n}.jpg`);

let failures = 0;
const ok = (msg) => console.log(`  PASS ${msg}`);
const bad = (msg) => { failures++; console.log(`  FAIL ${msg}`); };
const skip = (msg) => console.log(`  SKIP ${msg}`);
const head = (t) => console.log(`\n== ${t} ==`);

async function httpGet(url, { timeout = 20000, headers = {} } = {}) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: 'manual', headers });
    const out = {};
    res.headers.forEach((v, k) => { out[k] = v; });
    return { status: res.status, headers: out, body: Buffer.from(await res.arrayBuffer()) };
  } catch (e) {
    return { status: 0, headers: {}, body: Buffer.from(String(e && e.message || e)), error: e };
  }
}

// ---------------------------------------------------------------- env + db
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_0-9]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return out;
}

async function probeDatabase() {
  head(`database (Bluebell Supabase, anon key — proves the SQL bundle is applied)`);
  // backend() reflects tools/set-backend.mjs; before it runs the ref is a
  // placeholder and every probe below fails — that is the expected
  // pre-provisioning state, stated as such in the handover, not a defect.
  const BE = backend();
  const url = BE.url;
  const anon = BE.anonKey;
  if (BE.keysPending) {
    skip(`Bluebell has no real Supabase project yet (ref ${BE.ref}) — run tools/set-backend.mjs then provision db/*.sql`);
    return;
  }

  const keyHeaders = { apikey: anon, Authorization: `Bearer ${anon}` };
  const PREFIX = BRAND.tablePrefix; // jmis — Bluebell keeps the JMIS table names

  const tables = [...new Set(
    readFileSync(join(ROOT, 'db', '01_schema.sql'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.match(/^CREATE TABLE IF NOT EXISTS ("?)([\w]+)\1 \(/))
      .filter(Boolean)
      .map((m) => m[2])
  )];
  console.log(`  ${tables.length} table(s) expected, probing with the anon key`);
  const missing = [];
  for (const t of tables) {
    const r = await httpGet(`${url}/rest/v1/${encodeURIComponent(t)}?select=*&limit=1`, { timeout: 15000, headers: keyHeaders });
    if (r.status === 404) { missing.push(t); continue; }
    if (r.status !== 200 && r.status !== 206) { missing.push(`${t} (HTTP ${r.status})`); continue; }
  }
  if (missing.length) bad(`${missing.length}/${tables.length} table(s) not readable: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}`);
  else ok(`all ${tables.length} tables readable through PostgREST`);

  const s = await httpGet(`${url}/rest/v1/${PREFIX}_settings?select=schoolname,term,session&limit=1`, { headers: keyHeaders });
  if (s.status !== 200) bad(`${PREFIX}_settings read failed (HTTP ${s.status})`);
  else {
    const row = JSON.parse(s.body.toString() || '[]')[0];
    if (!row) bad(`${PREFIX}_settings is empty — paste db/04_seed_bluebell.sql`);
    else if (!/bluebell/i.test(row.schoolname || '')) bad(`${PREFIX}_settings.schoolname is "${row.schoolname}" — expected ${BRAND.school.name}`);
    else ok(`seeded settings row present: "${row.schoolname}" (term ${row.term || '—'}, session ${row.session || '—'})`);
  }

  for (const b of ['setting', 'passport', 'staff_passport', 'cbt']) {
    // Bucket list endpoint (POST with a JSON body) — a GET on the public
    // object path with an empty key is not a valid storage operation.
    const r = await fetch(`${url}/storage/v1/object/list/${b}`, {
      method: 'POST',
      headers: { ...keyHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 1 }),
    });
    if (r.status !== 200) bad(`bucket "${b}" does not answer (HTTP ${r.status}) — paste db/03_storage.sql`);
    else ok(`bucket "${b}" reachable (HTTP 200)`);
  }
}

// ------------------------------------------------------- residual branding
const SCAN_DIRS = ['src', 'app', 'components', 'lib', 'public'];
const SKIP = new Set(['node_modules', '.next', '.git', '.expo', '.swc', 'dist', 'build', 'out', 'android', 'ios', 'coverage']);
const TEXT_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt', '.env', '.local', '.py', '.sql']);

// Deliberate keeps for Bluebell: the bluebell_* TABLE NAMES (Bluebell keeps them so
// JMIS fixes port byte-parallel — the JMIS HITS rule already exempts bluebell_ and
// jmis- prefixed tokens), the client-side storage keys, the agency credit, and
// the developer/owner accounts that gate the portals.
const KEEPS = [
  /jmis-theme/gi,
  /jmis_impersonating/gi,
  // Prose in the copied src/api setup SQL that names the RETAINED table family
  // ("the other jmis tables", "jmis platform tables") — technical, not branding.
  /\bjmis(?= (?:platform|tables?))/gi,
  /rhema expert solutions/gi,
  /rhemaexpertsolutions/gi,
  /rhema\.png/gi,
  /blackboxinfo01@gmail\.com/gi,
  /blackboxtech\.online/gi,
  /info@blackboxtech\.online/gi,
  /blackbox-tech\.jpg/gi,
  /\+?2348035226642/g,
];
const forbiddenAlt = FORBIDDEN_REFS.join('|'); // JMIS + Spring refs
const HITS = [
  // JMIS brand word, but NOT the bluebell_ / jmis- prefixed identifiers we keep
  // (table names, storage keys and the bluebell_* glob used in comments).
  [/\bjmis(?!_|-|school-attendance)\w*/gi, 'JMIS'],
  [/jeshurun/gi, 'Jeshurun'],
  [new RegExp(`(${forbiddenAlt})`, 'gi'), 'another school\'s Supabase ref'],
  [/\bspring\b/gi, 'Spring (precedent-build leak)'],
  [/springschool/gi, 'springschool (precedent-build leak)'],
  [/#4e9f38|#1e5128|#2e7d32|#2d7a3c|#1f7a4d|#1e9e2a|#eaf4e8/gi, 'JMIS brand green'],
  [/78,\s*159,\s*56|30,\s*81,\s*40/g, 'JMIS brand green (rgb)'],
  [/Abuja-Ode|Jebba-Oko/gi, 'JMIS address'],
  [/Everlasting Grace|Princess Favour|Atali Rivers/gi, 'JMIS result-card address'],
  [/\+?2349137184534|\+?2349078808642/g, 'JMIS result-card phone'],
  [/jeshurunmontessori|finis cricine pendet/gi, 'JMIS result-card email/motto'],
  [/FLWPUBK-[A-Za-z0-9-]+/, 'a Flutterwave merchant public key (Bluebell needs its own)'],
  [/ca?-pub-\d{16}/g, 'an AdSense publisher id (must not carry JMIS\'s)'],
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(join(dir, e.name)); }
    else if (e.isFile()) yield join(dir, e.name);
  }
}

function scanBranding() {
  head('residual-brand scan (acceptance gate)');
  const findings = [];
  let files = 0;
  for (const app of APPS) {
    for (const sub of SCAN_DIRS) {
      const base = join(ROOT, app.dir, sub);
      let entries;
      try { entries = [...walk(base)]; } catch { continue; }
      for (const f of entries) {
        const ext = f.slice(f.lastIndexOf('.'));
        if (f.endsWith('.env') || f.endsWith('.env.local')) { /* checked below */ }
        else if (!TEXT_EXT.has(ext)) continue;
        if (/\.(png|jpe?g|ico|gif|svg|woff2?|ttf|eot|pdf|docx?|xlsx?|zip)$/i.test(f)) continue;
        let text;
        try { text = readFileSync(f, 'utf8'); } catch { continue; }
        if (Buffer.byteLength(text) > 4_000_000) continue;
        files += 1;
        // blank out the deliberate keeps so they cannot mask real hits
        let scrubbed = text;
        for (const re of KEEPS) scrubbed = scrubbed.replace(re, (m) => ' '.repeat(m.length));
        const lines = scrubbed.split(/\r?\n/);
        const raw = text.split(/\r?\n/);
        for (const [re, label] of HITS) {
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) findings.push(`${relative(ROOT, f)}:${i + 1}  ${label}  ${raw[i].trim().slice(0, 90)}`);
          }
        }
      }
    }
    // env files (not covered by the extension filter above)
    for (const name of ['.env', '.env.local']) {
      const f = join(ROOT, app.dir, name);
      try {
        const text = readFileSync(f, 'utf8');
        files += 1;
        if (/jeshurun|jmisdashboard/i.test(text)) findings.push(`${relative(ROOT, f)}  JMIS brand string`);
        for (const r of FORBIDDEN_REFS) if (text.includes(r)) findings.push(`${relative(ROOT, f)}  Supabase ref ${r} (another school's project)`);
      } catch { /* app has no such file */ }
    }
    const appJson = join(ROOT, app.dir, 'app.json');
    try {
      const text = readFileSync(appJson, 'utf8');
      files += 1;
      for (const r of FORBIDDEN_REFS) if (text.includes(r)) findings.push(`${relative(ROOT, 'app.json')}  Supabase ref ${r} in app.json`);
    } catch { /* not the expo app */ }
  }
  console.log(`  ${files} text file(s) scanned across ${APPS.length} apps`);
  if (findings.length) {
    for (const f of findings.slice(0, 40)) bad(f);
    if (findings.length > 40) bad(`… and ${findings.length - 40} more`);
  } else {
    ok('no JMIS/Spring branding, foreign Supabase ref, brand green, Flutterwave or AdSense id outside the deliberate keeps');
  }
  console.log(`  deliberate keeps (expected to remain): bluebell_* table names + jmis-theme/jmis_impersonating storage keys, "Black-Box Tech" agency credit (blackboxtech.online, info@blackboxtech.online, /blackbox-tech.jpg), blackboxinfo01@gmail.com owner account`);
}

// ---------------------------------------------------------- routes + assets
// Follow a dev server's redirects so the document that actually rendered is
// the one inspected; cold compiles of a landing page can take minutes.
async function getRendered(url, max = 4) {
  let res = await httpGet(url, { timeout: 300000 });
  for (let i = 0; i < max && res.status >= 300 && res.status < 400 && res.headers.location; i++) {
    res = await httpGet(new URL(res.headers.location, url).toString(), { timeout: 300000 });
  }
  return res;
}

async function probeServers() {
  head('served titles (ports are mapped by <title>, never assumed)');
  const live = new Map();
  for (const app of APPS) {
    const r = await getRendered(`http://localhost:${app.port}/`);
    if (!r.status) {
      if (app.expoOnly) skip(`${app.label}: no web server on :${app.port} — react-dom/react-native-web are not dependencies of this app (nor of its JMIS twin); run "npx expo install react-dom react-native-web" to add a browser preview, or verify on device with "npx expo start".`);
      else bad(`${app.label}: nothing listening on :${app.port} (${r.body.toString()})`);
      continue;
    }
    const html = r.body.toString();
    const title = (html.match(/<title>([^<]*)<\/title>/i) || [, '(none)'])[1];
    live.set(app.dir, app.port);
    if (app.expectTitle.test(title)) ok(`:${app.port} ${app.label} — <title> "${title}"`);
    else bad(`:${app.port} ${app.label} served <title> "${title}" — expected ${app.expectTitle}`);
    const marker = html.match(/Build Error|Failed to compile|Module not found|Cannot find module|Internal Server Error|__next_error__/i);
    if (marker && !/Application error: a client-side exception/i.test(html)) {
      bad(`:${app.port} ${app.label} home page contains an error marker: "${marker[0]}"`);
    }
  }

  head('route probes');
  for (const app of APPS) {
    const port = live.get(app.dir);
    if (!port) {
      if (app.expoOnly) skip(`${app.dir}: routes are native screens, not URLs`);
      else bad(`${app.dir}: not running, ${ROUTES[app.dir].length} route(s) unverified`);
      continue;
    }
    for (const route of ROUTES[app.dir]) {
      const r = await httpGet(`http://localhost:${port}${route}`, { timeout: 300000 });
      const body = r.body.toString('utf8').slice(0, 200000);
      // A 3xx is an auth redirect: its stub document is Next boilerplate and
      // carries __next_error__ even when the target page is fine.
      const err = r.status < 300
        ? /Build Error|Failed to compile|__next_error__|Module not found|Cannot find module|Internal Server Error/i.test(body)
        : /Build Error|Failed to compile|Module not found|Cannot find module/i.test(body);
      if (r.status >= 400 || err) bad(`${app.dir} ${route} → HTTP ${r.status}${err ? ' + error marker' : ''}`);
      else ok(`${app.dir} ${route} → HTTP ${r.status}, ${r.body.length} B`);
    }
  }

  head('asset probes (logos, icons, generated site imagery)');
  for (const app of APPS) {
    const port = live.get(app.dir);
    if (!port) {
      if (!app.expoOnly) bad(`${app.dir}: not running, assets unverified`);
      continue;
    }
    const list = [...(ASSETS[app.dir] || [])];
    if (app.dir === D[0] || app.dir === D[1]) list.push(...SITE_IMAGES);
    for (const path of list) {
      const r = await httpGet(`http://localhost:${port}${path}`);
      const type = r.headers['content-type'] || '';
      if (r.status !== 200) bad(`${app.dir} ${path} → HTTP ${r.status}`);
      else if (path.endsWith('.jpg') || path.endsWith('.png')) {
        if (!/^image\//.test(type) || r.body.length < 1024) bad(`${app.dir} ${path} → ${type}, ${r.body.length} B (suspiciously small)`);
        else ok(`${app.dir} ${path} → ${type}, ${r.body.length} B`);
      } else if (/text\/|application\/|image\//.test(type) === false) bad(`${app.dir} ${path} → unexpected content-type ${type}`);
      else ok(`${app.dir} ${path} → ${type.split(';')[0]}, ${r.body.length} B`);
    }
  }
}

// ------------------------------------------------- expo app (no web server)
function checkExpoApp() {
  head('attendance app (Expo) — static branding, verified in place of a web preview');
  const dir = join(ROOT, D[4]);
  let cfg;
  try { cfg = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8')); }
  catch (e) { bad(`app.json unreadable: ${e.message}`); return; }
  const expo = cfg.expo || {};
  const flat = JSON.stringify(cfg);
  for (const r of FORBIDDEN_REFS) {
    if (flat.includes(r)) bad(`app.json references foreign Supabase ref ${r}`);
  }
  if (/bluebell/i.test(expo.name || '')) ok(`expo.name "${expo.name}"`);
  else bad(`expo.name is "${expo.name}" — expected a Bluebell name`);
  if (expo.slug === D[4]) ok(`expo.slug "${expo.slug}"`);
  else bad(`expo.slug is "${expo.slug}"`);
  const pkg = expo.android && expo.android.package;
  if (/^com\.[a-z0-9.]*bluebell[a-z0-9.]*$/.test(pkg || '')) ok(`android.package "${pkg}"`);
  else bad(`android.package is "${pkg}" — must be Bluebell's own so no APK can publish into JMIS's EAS project`);
  const eas = (expo.extra || {}) && (expo.extra.eas || {});
  if (!eas || !eas.projectId) ok('extra.eas.projectId is cleared (no JMIS EAS project)');
  else bad(`extra.eas.projectId is "${eas.projectId}" — belongs to the source build`);

  for (const asset of ['assets/icon.png', 'assets/splash-icon.png', 'assets/favicon.png',
    'assets/android-icon-foreground.png', 'assets/android-icon-background.png', 'assets/android-icon-monochrome.png']) {
    let size = 0;
    try { size = statSync(join(dir, asset)).size; } catch { bad(`${asset} missing`); continue; }
    if (size < 1024) bad(`${asset} is only ${size} B`);
    else ok(`${asset} — ${size.toLocaleString()} B`);
  }
}

// --------------------------------------------------------------------- main
console.log(`Bluebell clone verification — ${new Date().toISOString()}`);
if (only('brand')) scanBranding();
if (only('routes')) { await probeServers(); checkExpoApp(); }
if (only('db')) await probeDatabase();

head('summary');
if (failures) { console.log(`  ${failures} check(s) FAILED`); process.exit(1); }
console.log('  every check that ran passed');
