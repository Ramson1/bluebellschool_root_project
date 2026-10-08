// Read-only pre-flight for Bluebell's own Supabase project. Sends ONE SELECT
// through the Management API — creates nothing, changes nothing, deletes
// nothing. Prints what already exists so the bundle can be judged against it
// before anything is applied. Unlike the shared-database precedent, Bluebell
// owns its project (tools/set-backend.mjs) — this script REFUSES to read JMIS's
// or Spring's ref, and it only ever READS. The token is never printed.
//
//   node tools/db-status.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, BRAND, backend, assertNotForbidden } from './guard.mjs';

const ADMIN = BRAND.dirs[0];
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');

function tokenFromEnvFile() {
  for (const name of [join(ADMIN, '.env'), join(ADMIN, '.env.local')]) {
    try {
      const m = readFileSync(join(ROOT, name), 'utf8').match(/^SUPABASE_ACCESS_TOKEN\s*=\s*"?(sbp_[^"\r\n]+)/m);
      if (m) return m[1];
    } catch { /* app has no env file */ }
  }
  return '';
}

const token = arg('token') || process.env.SUPABASE_ACCESS_TOKEN || tokenFromEnvFile();
if (!token) {
  console.log(`No SUPABASE_ACCESS_TOKEN — cannot query. Add it to ${ADMIN}/.env or pass --token=sbp_… .`);
  process.exit(0);
}

const BE = backend();
if (BE.keysPending) {
  console.log(`Bluebell has no real Supabase project yet (ref ${BE.ref}) — run tools/set-backend.mjs first.`);
  process.exit(0);
}
const ref = arg('project') || BE.ref;
assertNotForbidden(ref, 'db-status');

const q = `
select 'table' as kind, tablename as name, '' as detail from pg_tables where schemaname='public'
union all
select 'bucket', id, case when public then 'public' else 'private' end from storage.buckets
order by 1, 2;`;

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q }),
});
if (!res.ok) {
  // The token is never printed; the server's own message is.
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  process.exit(1);
}
const rows = await res.json();
const tables = rows.filter((r) => r.kind === 'table').map((r) => r.name);
const buckets = rows.filter((r) => r.kind === 'bucket');

const PREFIX = BRAND.tablePrefix; // jmis — Bluebell keeps the JMIS table names
const groups = { [PREFIX]: [], foreign: [], other: [] };
for (const t of tables) {
  if (t.startsWith(`${PREFIX}_`)) groups[PREFIX].push(t);
  else if (/^(spring|jmis)_/.test(t) && !t.startsWith(`${PREFIX}_`)) groups.foreign.push(t);
  else groups.other.push(t);
}

console.log(`project ${ref} — public tables: ${tables.length} total`);
console.log(`  ${PREFIX}_* : ${groups[PREFIX].length}`);
console.log(`  other    : ${groups.other.length}`);
if (groups.foreign.length) console.log(`\n  foreign-prefixed tables present (${groups.foreign.length}) — ${groups.foreign.slice(0, 20).join(', ')}`);
if (groups.other.length) console.log('\nother tables:\n  ' + groups.other.join('\n  '));
console.log(`\nstorage buckets: ${buckets.length}`);
for (const b of buckets) console.log(`  ${b.name} (${b.detail})`);
