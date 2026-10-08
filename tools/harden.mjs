// Cross-tenant hardening for the Bluebell clone.
// Run from builds/bluebell:  node tools/harden.mjs [--dry]
//
// The text rebrand renames what it can see. These are the sites where a plain
// rename is not enough, because the file does something that is *addressed* to
// JMIS: it charges money to JMIS's merchant account, sends mail to JMIS's
// inboxes, serves JMIS's AdSense publisher id, or identifies itself as JMIS's
// Expo/EAS app. Each fix is applied by anchored, whitespace-tolerant rewrite
// rather than hand editing, so re-running after porting a JMIS file back in
// restores the fix instead of losing it.
//
// Every step reports FIXED / ALREADY / NO-MATCH, and a NO-MATCH on an expected
// anchor fails the run: a silently skipped money or mail fix is the one outcome
// this build must never allow.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, BRAND, PALETTE, DRY, assertNotForbidden, backend } from './guard.mjs';

const PRIMARY = PALETTE.slots.primary.hex;
const results = [];
const record = (step, file, status, detail = '') => results.push({ step, file, status, detail });

/** Apply fn(text, eol) -> text; reports whether anything changed. */
function edit(rel, fn) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) { record('edit', rel, 'missing', 'file not present'); return false; }
  const before = readFileSync(p, 'utf8');
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const out = fn(before, eol);
  if (out === before) { record('edit', rel, 'already'); return false; }
  if (!DRY) writeFileSync(p, out);
  record('edit', rel, 'ok');
  return true;
}

// --- 1. the payment gateway must never charge JMIS's merchant account --------
// JMIS spelled its Flutterwave public key out in the component, so every payment
// a cloned build collected would land in JMIS's account. The key becomes
// environment-driven, and until it is configured the button is replaced by an
// honest, disabled "not configured" control instead of a live JMIS checkout.
{
  const rel = 'bluebellschool/src/pages_components/NewPaymentWithPaystack.jsx';
  const KEY_RE = /public_key:[ \t]*'(?:BLUEBELL_FLUTTERWAVE_PUBLIC_KEY_PLACEHOLDER|FLWPUBK-[A-Za-z0-9-]+)'[^,\n]*,?/;
  const CONFIG_RE = /^([ \t]*)const config = \{[ \t\r]*$/m;
  const BUTTON_RE = /^([ \t]*)<FlutterWaveButton\b[\s\S]*?\/>[ \t\r]*$/m;
  const DECL = (eol, pad) => [
    `${pad}// Bluebell's own Flutterwave public key, from the environment. The fallback is`,
    `${pad}// a placeholder on purpose: an unconfigured clone must never be able to collect`,
    `${pad}// school fees through another school's merchant account.`,
    `${pad}const FLUTTERWAVE_PUBLIC_KEY =`,
    `${pad}    process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY || 'BLUEBELL_FLUTTERWAVE_PUBLIC_KEY_PLACEHOLDER';`,
    `${pad}const gatewayConfigured = FLUTTERWAVE_PUBLIC_KEY.startsWith('FLWPUBK');`,
    '',
    `${pad}const config = {`,
  ].join(eol);

  edit(rel, (text, eol) => {
    if (!text.includes('gatewayConfigured')) {
      const cm = text.match(CONFIG_RE);
      if (!cm || !KEY_RE.test(text)) { record('payment', rel, 'missing', 'config/public_key anchor not found — check the ported file'); return text; }
      text = text.replace(CONFIG_RE, () => DECL(eol, cm[1]));
      text = text.replace(KEY_RE, () => 'public_key: FLUTTERWAVE_PUBLIC_KEY,');
    }
    if (!/payment gateway not configured/.test(text)) {
      const m = text.match(BUTTON_RE);
      if (!m) { record('payment', rel, 'missing', 'FlutterWaveButton render site not found'); return text; }
      const pad = m[1];
      text = text.replace(BUTTON_RE, () => [
        `${pad}{/* rendered only when this school has configured its own key */}`,
        `${pad}{gatewayConfigured ? (`,
        `${m[0].replace(/^([ \t]*)/, `${pad}    `)}`,
        `${pad}) : (`,
        `${pad}    <button type="button" className="btn btn-primary btn-lg elegant-button shadow-button" disabled>`,
        `${pad}        Pay Fees (payment gateway not configured)`,
        `${pad}    </button>`,
        `${pad})}`,
      ].join(eol));
    }
    return text;
  });

  // the env entry must exist so the school can fill it in one place
  edit('bluebellschool/.env', (text, eol) => (/NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY/.test(text)
    ? text
    : `${text.replace(/\s*$/, '')}${eol}${eol}# Bluebell's own Flutterwave public key (empty = checkout stays disabled)${eol}NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY=${eol}`));
}

// --- 2. AdSense: JMIS's publisher id must not earn for JMIS off Bluebell ------
{
  const rel = 'bluebellschool/app/layout.tsx';
  edit(rel, (text, eol) => {
    text = text.replace(/^[ \t]*other: \{[\s\S]{0,200}?google-adsense-account[^\n]*\n[ \t]*\},?[ \t]*\r?\n/m, () => '');
    // A self-closing <Script …/> element carrying the AdSense loader. [^>]*? is
    // CRLF-safe (it crosses \r\n) and cannot jump to a sibling element because
    // no '>' appears between the opening tag and its own '/>'.
    text = text.replace(/[ \t]*<Script\b[^>]*?pagead2\.googlesyndication\.com[^>]*?\/>[ \t]*\r?\n/, () => '');
    text = text.replace(/[ \t]*\{\/\* External scripts via next\/script[\s\S]*?\*\/\}/, () => [
      '        {/* Mammoth.js powers the .docx import tooling. It is loaded via',
      '            next/script (afterInteractive) instead of a raw <head> tag so it',
      '            never blocks first paint. AdSense is deliberately not installed: a',
      '            clone must never carry another publisher\'s ad account. */}',
    ].join(eol));
    return text;
  });

  // ads.txt declares who may sell this site's ads; JMIS's line would keep paying
  // JMIS's publisher out of Bluebell's traffic.
  const adsRel = 'bluebellschool/public/ads.txt';
  const p = join(ROOT, adsRel);
  const want = "# Bluebell International School has no AdSense account configured. This file\n# deliberately carries no seller entries; add Bluebell's own line if the school\n# ever enables AdSense (see the handover list in README.md).\n";
  if (!existsSync(p)) record('ads.txt', adsRel, 'missing', 'file not present');
  else if (readFileSync(p, 'utf8') === want) record('ads.txt', adsRel, 'already');
  else {
    if (!DRY) writeFileSync(p, want);
    record('ads.txt', adsRel, 'ok', 'seller entries cleared');
  }

  // Positive post-condition: an AdSense asset that survives the rewrite is the
  // exact "ads routed to the wrong tenant" leak this step exists to close, so it
  // must fail the run rather than be reported as ALREADY.
  const layAbs = join(ROOT, rel);
  if (existsSync(layAbs) && /pagead2\.googlesyndication|google-adsense-account|adsbygoogle|ca?-pub-\d{16}/.test(readFileSync(layAbs, 'utf8'))) {
    record('adsense', rel, 'missing', 'an AdSense loader/publisher id survived the rewrite — fix the removal regex');
  } else {
    record('adsense', rel, 'already', 'no ad account remains in the admin layout');
  }

  // a publisher id anywhere else in the clone is the same leak
  for (const f of ['bluebellschool-website/app/layout.jsx', 'bluebellschool-website/public/ads.txt',
    'bluebellschool-staff/app/layout.jsx', 'bluebellschool-student/app/layout.jsx']) {
    const q = join(ROOT, f);
    if (existsSync(q) && /ca?-pub-\d{16}/.test(readFileSync(q, 'utf8'))) {
      record('ads.txt', f, 'missing', 'a Google publisher id is still present — add a rule');
    }
  }
}

// --- 3. the installed-app manifest -------------------------------------------
edit('bluebellschool/public/manifest.json', (text) => {
  const j = JSON.parse(text);
  const want = { short_name: BRAND.school.short, name: BRAND.school.name, theme_color: PRIMARY };
  if (Object.entries(want).every(([k, v]) => j[k] === v)) return text;
  Object.assign(j, want);
  return JSON.stringify(j, null, 2) + '\n';
});

// --- 4. Expo / EAS identity: a Bluebell APK must not build into JMIS's project -
edit('bluebellschool-attendance-app/app.json', (text) => {
  const cfg = JSON.parse(text);
  const BE = backend();
  assertNotForbidden(BE.ref, 'app.json');
  cfg.expo.name = 'Bluebell Attendance';
  cfg.expo.slug = 'bluebellschool-attendance-app';
  cfg.expo.android = { ...cfg.expo.android, package: 'com.blackbox01.bluebellschoolattendanceapp' };
  cfg.expo.extra = { ...cfg.expo.extra, supabaseUrl: BE.url, supabaseAnonKey: BE.anonKey, eas: { projectId: '' } };
  const out = JSON.stringify(cfg, null, 2) + '\n';
  return out === text ? text : out;
});

// --- 5. result / enquiry notification recipients ------------------------------
// Delegated to its own audited tool, which installs src/utils/resultRecipients.js
// into every notifying app and rewrites each call site to read environment first,
// then the Settings page's adminEmail / additionalemails.
{
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'configure-recipients.mjs'), ...(DRY ? ['--dry'] : [])], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  process.stdout.write(out);
  const bad = out.split(/\r?\n/).filter((l) => /NO MATCH|skip \(missing|^missing /.test(l));
  const rewrote = /\bpatched |\binstalled /.test(out);
  record('recipients', 'tools/configure-recipients.mjs',
    r.status !== 0 || bad.length ? 'missing' : rewrote ? 'ok' : 'already',
    bad.join('; ') || (r.status !== 0 ? `exit ${r.status}` : ''));
}

// --- 6. setting-bucket URL helpers must pass /site/* and http… through ---------
{
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'wire-setting-urls.mjs'), ...(DRY ? ['--dry'] : [])], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  process.stdout.write(out);
  const rewrote = /\n\s*[~+]    /.test(out) && !/\n0 file\(s\) rewired/.test(out);
  record('settingUrls', 'tools/wire-setting-urls.mjs',
    r.status === 0 ? (rewrote ? 'ok' : 'already') : 'missing', `exit ${r.status}`);
}

// --- report ------------------------------------------------------------------
console.log(`\nharden ${DRY ? '[dry run]' : '[applied]'}:`);
for (const r of results) {
  const mark = { ok: 'FIXED   ', already: 'ALREADY ', missing: 'NO-MATCH' }[r.status];
  console.log(`  ${mark}  ${r.file}${r.detail ? `  — ${r.detail}` : ''}`);
}
const failed = results.filter((r) => r.status === 'missing');
console.log(`\n${results.filter((r) => r.status === 'ok').length} fixed, ${results.filter((r) => r.status === 'already').length} already in place, ${failed.length} unmatched`);
if (failed.length) {
  console.error('\nHARDENING INCOMPLETE — an expected anchor was not found. Fix the rule; do not ship the app:');
  for (const f of failed) console.error(`  ${f.file}: ${f.detail || 'anchor missing'}`);
  process.exit(1);
}
