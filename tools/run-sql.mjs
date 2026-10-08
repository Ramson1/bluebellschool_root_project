// Optional one-shot provisioning of Bluebell's Supabase project through the
// Supabase Management API, so the db/*.sql bundle does not have to be pasted by
// hand. Only needed if a personal access token is available — without one the
// workflow stays "paste db/01 → db/02 → db/00 → db/03 → db/04 in the SQL Editor"
// (the project exposes no exec_sql RPC, so nothing in the app itself can do it).
//
//   token: https://supabase.com/dashboard/account/tokens
//   export SUPABASE_ACCESS_TOKEN=sbp_…      (or --token=sbp_…)
//
//   node tools/run-sql.mjs              # no-op summary: the manual paste order
//   node tools/run-sql.mjs --apply      # execute, in paste order
//
// Unlike the shared-database precedent, Bluebell has its OWN project (set with
// tools/set-backend.mjs). This tool therefore REFUSES to run against JMIS's or
// Spring's project refs outright — pointing Bluebell's bundle at another
// school's database would create or seed tables in the wrong place. The token is
// never echoed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, BRAND, backend, assertNotForbidden } from './guard.mjs';

const ADMIN = BRAND.dirs[0];
// Paste order. There is no rename step: Bluebell keeps jmis_* and owns its project.
const FILES = ['01_schema.sql', '02_rls.sql', '00_indexes.sql', '03_storage.sql', '04_seed_bluebell.sql'];

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const has = (name) => process.argv.includes(`--${name}`);
const skip = (arg('skip') || '').split(',').map((s) => s.trim()).filter(Boolean);
const ACTIVE = FILES.filter((f) => !skip.some((s) => f === s || f.startsWith(s)));
if (skip.length) console.log(`skipping (per --skip): ${FILES.filter((f) => !ACTIVE.includes(f)).join(', ') || '(nothing matched)'}\n`);

const BE = backend();
const EXPECT = BE.ref;
const ref = arg('project') || EXPECT;

// Never touch another tenant's project, and never silently run against a ref
// that is not the one set-backend recorded for Bluebell.
assertNotForbidden(ref, 'run-sql');
if (ref !== EXPECT && !has('force')) {
  console.error(`refusing to run against "${ref}" — Bluebell's project is "${EXPECT}". Run tools/set-backend.mjs first, or re-run with --force.`);
  process.exit(1);
}

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
  // No credentials is the normal case: the bundle is meant to be pasted. Print
  // the order and the sizes so the manual path is fully documented here too.
  console.log('No SUPABASE_ACCESS_TOKEN supplied — nothing is sent.\n');
  console.log(`Either paste these into the Supabase SQL Editor for Bluebell (project ${ref}), in this order:`);
  for (const file of ACTIVE) {
    const sql = readFileSync(join(ROOT, 'db', file), 'utf8');
    console.log(`  db/${file.padEnd(22)} ${String(sql.length).padStart(7)} B`);
  }
  console.log('\nOr set the token (https://supabase.com/dashboard/account/tokens) and run:');
  console.log('  node tools/run-sql.mjs           # dry run');
  console.log('  node tools/run-sql.mjs --apply   # execute through the Management API');
  process.exit(0);
}

const api = `https://api.supabase.com/v1/projects/${ref}/database/query`;
const apply = has('apply');

console.log(`target project : ${ref}`);
console.log(`mode           : ${apply ? 'APPLY — statements will run' : 'DRY RUN — nothing is sent'}`);
console.log(`files          : ${ACTIVE.length} (db/)\n`);

let total = 0;
for (const file of ACTIVE) {
  const sql = readFileSync(join(ROOT, 'db', file), 'utf8');
  const statements = sql.split('\n').filter((l) => /;\s*$/.test(l) && !/^\s*--/.test(l)).length;
  total += statements;
  console.log(`db/${file.padEnd(22)} ${String(sql.length).padStart(7)} B  ~${String(statements).padStart(4)} statement line(s)`);
  if (!apply) continue;

  const started = Date.now();
  const res = await fetch(api, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (!res.ok) {
    // The token is never printed; the server's own message is.
    console.error(`\nFAILED db/${file} after ${secs}s — HTTP ${res.status}`);
    console.error(text.slice(0, 2000));
    console.error('Fix the statement or fall back to pasting db/*.sql in the SQL Editor.');
    process.exit(1);
  }
  console.log(`   applied in ${secs}s (HTTP ${res.status})`);
}

if (!apply) {
  console.log(`\ndry run only — ${total} statement line(s) would be sent in ${ACTIVE.length} requests. Re-run with --apply.`);
} else {
  console.log(`\nOK: ${ACTIVE.length} file(s), ~${total} statement lines applied to ${ref}.`);
  console.log('Now confirm with:  node tools/verify.mjs --db');
}
