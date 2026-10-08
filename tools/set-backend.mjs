// Adopt Bluebell's real Supabase project in one command. Until this runs the
// build carries BLUEBELL_SUPABASE_*_PLACEHOLDER everywhere; after it, the ref /
// url / anon / service-role triple is written into every place the apps read it.
//
//   node tools/set-backend.mjs --url=https://<ref>.supabase.co --anon=<anon> --service=<service>
//   node tools/set-backend.mjs --from-env=<file>       # a file carrying the three keys
//
// It writes tools/backend.json (gitignored — it holds the service-role key),
// rewrites the Supabase triple in all four env files and in the Expo app.json
// extra block, then re-runs tools/rebrand.mjs so the code-level ref literal
// follows. It REFUSES JMIS's and Spring's project refs, and it never prints a
// key — only names and lengths.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, BRAND, backend, assertNotForbidden } from './guard.mjs';

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const fromEnv = arg('from-env');

const URL_KEY = 'NEXT_PUBLIC_SUPABASE_URL';
const ANON_KEY = 'NEXT_PUBLIC_SUPABASE_ANON_KEY';
const SERVICE_KEY = 'SUPABASE_SERVICE_ROLE_KEY';

// Source of the three values: explicit flags, else a supplied env file.
function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_0-9]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}
let url = arg('url');
let anon = arg('anon');
let service = arg('service');
if (fromEnv) {
  const e = readEnvFile(fromEnv);
  url = url || e[URL_KEY];
  anon = anon || e[ANON_KEY];
  service = service || e[SERVICE_KEY];
}

if (!url || !anon) {
  console.error('need --url and --anon (and --service for provisioning); or --from-env=<file> carrying them');
  process.exit(1);
}

const ref = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || '';
if (!ref) {
  console.error(`could not read a project ref from the URL (expected https://<ref>.supabase.co)`);
  process.exit(1);
}
// The whole point: Bluebell must never be pointed at another school's project.
assertNotForbidden(ref, 'set-backend');

// --- tools/backend.json (gitignored; holds the service-role key) --------------
const backendPath = join(ROOT, BRAND.supabase.keysFile);
writeFileSync(backendPath, JSON.stringify({ ref, url, anonKey: anon, serviceKey: service || '' }, null, 2) + '\n');
console.log(`wrote ${BRAND.supabase.keysFile}`);

// --- rewrite each app's env file, touching only the Supabase keys ------------
function setEnvLine(path, updates) {
  if (!existsSync(path)) { console.log(`  (no env file: ${path.slice(ROOT.length + 1)})`); return; }
  let text = readFileSync(path, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === '') continue;
    const re = new RegExp(`^\\s*${key}\\s*=`);
    const idx = lines.findIndex((l) => re.test(l));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(path, lines.join(eol));
}

const ENV_FILES = {
  [BRAND.dirs[0]]: { url, anon, service },        // admin: browser + server key
  [BRAND.dirs[1]]: { url, anon },                  // website/staff/student: browser only
  [BRAND.dirs[2]]: { url, anon },
  [BRAND.dirs[3]]: { url, anon },
};
console.log('env files:');
for (const [app, upd] of Object.entries(ENV_FILES)) {
  const dir = join(ROOT, app);
  const file = existsSync(join(dir, '.env')) ? '.env' : existsSync(join(dir, '.env.local')) ? '.env.local' : null;
  if (!file) { console.log(`  ${app}: no .env / .env.local found — skipped`); continue; }
  const updates = { [URL_KEY]: upd.url, [ANON_KEY]: upd.anon };
  if (upd.service) updates[SERVICE_KEY] = upd.service;
  setEnvLine(join(dir, file), updates);
  console.log(`  ${app}/${file}: ${Object.keys(updates).length} key(s) set`);
}

// --- Expo app.json extra -----------------------------------------------------
{
  const p = join(ROOT, BRAND.dirs[4], 'app.json');
  if (existsSync(p)) {
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    cfg.expo.extra = { ...cfg.expo.extra, supabaseUrl: url, supabaseAnonKey: anon };
    writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`  ${BRAND.dirs[4]}/app.json: extra.supabaseUrl / supabaseAnonKey set`);
  }
}

// --- re-run rebrand so the code-level ref literal follows --------------------
console.log('\nre-running rebrand.mjs so the ref literal in source follows…');
const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'rebrand.mjs')], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('rebrand.mjs failed — fix it before trusting the backend swap');
  process.exit(r.status || 1);
}

const prev = backend();
console.log(`\nOK: backend now ${ref} (was ${prev.ref}).`);
console.log('Keys written (values not shown):');
console.log(`  ${URL_KEY}      len ${url.length}`);
console.log(`  ${ANON_KEY}  len ${anon.length}`);
console.log(`  ${SERVICE_KEY}  ${service ? `len ${service.length}` : 'NOT SUPPLIED — run-sql/create-auth-users need it'}`);
console.log('\nNext: node tools/run-sql.mjs --apply (provision the database), then node tools/verify.mjs --db');
