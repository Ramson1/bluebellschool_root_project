// Creates Bluebell's login accounts in Supabase Auth through GoTrue's ADMIN
// API (/auth/v1/admin/users) — the supported way to manage auth users outside
// the dashboard. Needs the project's service_role key (tools/backend.json, set
// by tools/set-backend.mjs); the sbp_ Management token has no auth endpoints.
//
// Roles are NOT set here: bluebell_userauth / bluebell_teacherauth rows (seeded in
// db/04, managed in the admin portals) decide who is admin, and
// blackboxinfo01@gmail.com is the developer/owner account built into
// src/utils/authUtils.js (DEV_EMAILS/OWNER_EMAIL) — this script only
// makes sure their Auth users exist with the right password.
//
//   node tools/create-auth-users.mjs            # dry run (default)
//   node tools/create-auth-users.mjs --apply    # create missing users
//
// Accounts come from the "accounts" block of tools/site-content.json. Existing
// users are reported and skipped — passwords are never changed under --apply
// (reset them in the dashboard if one must rotate). Keys are never echoed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, BRAND, backend, assertNotForbidden } from './guard.mjs';

const arg = (name) => (name2) => (process.argv.find((a) => a.startsWith(`--${name2}=`)) || '').split('=').slice(1).join('=');
const has = (name) => process.argv.includes(`--${name}`);

const BE = backend();
const url = (process.argv.find((a) => a.startsWith('--url=')) || '').split('=').slice(1).join('=') || BE.url;
const serviceKey = (process.argv.find((a) => a.startsWith('--service-key=')) || '').split('=').slice(1).join('=')
  || process.env.SUPABASE_SERVICE_ROLE_KEY || BE.serviceKey;

const ref = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || '';
// Bluebell owns its project; never create auth users in another school's pool.
assertNotForbidden(ref, 'create-auth-users');

const accounts = JSON.parse(readFileSync(join(ROOT, 'tools', 'site-content.json'), 'utf8')).accounts || [];
if (!accounts.length) {
  console.error('tools/site-content.json has no "accounts" block — nothing to do.');
  process.exit(1);
}

const apply = has('apply');
if (apply && (!ref || BE.keysPending || !serviceKey || /PLACEHOLDER/.test(serviceKey))) {
  console.error('cannot --apply: Bluebell has no real Supabase project yet.');
  console.error('Run tools/set-backend.mjs --url=… --anon=… --service=… first.');
  process.exit(1);
}

const api = `${url}/auth/v1/admin/users`;
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

console.log(`target project : ${ref || '(placeholder — set-backend not run)'}`);
console.log(`mode           : ${apply ? 'APPLY — missing users will be created' : 'DRY RUN — nothing is sent'}`);
console.log(`accounts       : ${accounts.length}\n`);

// Paginated admin list so the script is idempotent on its own.
async function existingEmails() {
  const seen = new Set();
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${api}?page=${page}&per_page=500`, { headers });
    if (!res.ok) throw new Error(`list users failed — HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    const batch = body.users || [];
    for (const u of batch) seen.add((u.email || '').toLowerCase());
    if (batch.length < 500) break;
  }
  return seen;
}

const have = apply ? await existingEmails() : new Set();
let created = 0;

for (const { email, password, role } of accounts) {
  const e = (email || '').toLowerCase();
  if (!e || !password || /PLACEHOLDER/.test(e) || /PLACEHOLDER/.test(password)) {
    console.log(`SKIP  ${email || '(no email)'} — placeholder/incomplete account entry (fill tools/site-content.json first)`);
    continue;
  }
  if (have.has(e)) {
    console.log(`EXISTS ${e}  (${role}) — left untouched; reset the password in the dashboard if needed`);
    continue;
  }
  console.log(`${apply ? 'CREATE' : 'would create'} ${e}  (${role})`);
  if (!apply) continue;
  const res = await fetch(api, {
    method: 'POST',
    headers,
    // email_confirm: the school signs in immediately; no confirmation mail round-trip.
    // data.email: GoTrue's admin API does NOT mirror the top-level email into
    // user_metadata automatically (unlike the client signup flow), and the admin
    // layout's authorization check reads `user.user_metadata.email` — without
    // this, a freshly created user is denied at login.
    body: JSON.stringify({ email, password, email_confirm: true, data: { email } }),
  });
  const text = await res.text();
  if (!res.ok) {
    if (/already exists|already registered/i.test(text)) {
      console.log(`   already exists — left untouched`);
      continue;
    }
    console.error(`\nFAILED to create ${e} — HTTP ${res.status}`);
    console.error(text.slice(0, 800));
    process.exit(1);
  }
  created++;
}

if (!apply) {
  console.log('\ndry run only — re-run with --apply to create the missing accounts.');
} else {
  console.log(`\nOK: ${created} user(s) created, ${accounts.length - created} already present.`);
  console.log(`Next: make sure db/04_seed_bluebell.sql has run (it seeds the ${BRAND.tablePrefix}_userauth admin row),`);
  console.log('then sign in at the admin portal to confirm roles.');
}
