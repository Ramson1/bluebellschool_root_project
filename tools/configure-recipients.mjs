// Detach result / enquiry notification recipients from JMIS's hard-coded inboxes.
// Run from builds/bluebell:  node tools/configure-recipients.mjs [--dry]
//
// JMIS spelled the developer's mailboxes out at every call site, so a plain text
// rename would still have left Bluebell emailing someone else. This installs
// src/utils/resultRecipients.js (from tools/templates) into every app that sends
// notifications and rewrites those call sites to read it: environment first, then
// whatever the Settings page stores as adminEmail / additionalemails.
//
// Idempotent — re-run it after porting one of these components back from JMIS.

import { ROOT, DRY, APPS } from './guard.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const UTIL = readFileSync(join(ROOT, 'tools', 'templates', 'resultRecipients.js'), 'utf8');

// --- 1. install the helper into every app that notifies anyone ---------------
const NOTIFYING = APPS.filter((a) => !a.endsWith('-attendance-app'));
for (const app of NOTIFYING) {
  const p = `${app}/src/utils/resultRecipients.js`;
  if (!existsSync(join(ROOT, app))) { console.log(`skip (no app): ${app}`); continue; }
  const same = existsSync(join(ROOT, p)) && readFileSync(join(ROOT, p), 'utf8') === UTIL;
  console.log(`${same ? 'already  ' : 'installed'} ${p}`);
  if (!DRY && !same) writeFileSync(join(ROOT, p), UTIL);
}

// --- 2. rewrite the call sites -----------------------------------------------
// Whitespace-tolerant: these files are CRLF with trailing spaces, and a ported
// JMIS copy will not have the same padding.
const cbtBlock = (banner, warnLine) => new RegExp(
  '    // ' + banner +
  '[\\s\\S]*?let recipients = \\[[^\\]]*\\];' +
  '\\s*try \\{' +
  '[\\s\\S]*?console\\.warn\\(' + warnLine + '[\\s\\S]*?\\}'
);

const REPLACEMENT = [
  '    // Delivered to the addresses this school configures — see src/utils/resultRecipients.js',
  '    const recipients = await resolveResultRecipients(supabase);',
].join('\r\n');
const IMPORT = "import { resolveResultRecipients } from '../utils/resultRecipients';";

const sites = [
  ...['bluebellschool', 'bluebellschool-website'].flatMap((app) => [
    {
      file: `${app}/src/pages_components/QuizComponent.jsx`,
      from: cbtBlock('Fetch admin email from database and send to all recipients', String.raw`'⚠️ \[SendResultEmail\] Could not fetch admin email:'`),
    },
    {
      file: `${app}/src/pages_components/CompletionExam.jsx`,
      from: cbtBlock('Fetch admin email from database', String.raw`'Could not fetch admin email:'`),
    },
    {
      file: `${app}/src/pages_components/EssayExam.jsx`,
      from: cbtBlock('Fetch admin email from database', String.raw`'Could not fetch admin email:'`),
    },
  ]),
  // Admin / staff result upload + update notifications (two sites per file)
  ...['bluebellschool', 'bluebellschool-staff'].map((app) => ({
    file: `${app}/src/pages_components/Result.jsx`,
    from: new RegExp('const recipients = \\[[^\\]]*\\];', 'g'),
    all: true,
  })),
];

for (const site of sites) {
  const p = join(ROOT, site.file);
  if (!existsSync(p)) { console.warn(`NO MATCH: ${site.file} (file missing)`); continue; }
  let text = readFileSync(p, 'utf8');
  const hits = text.match(site.from) || [];
  if (!hits.length) {
    // "nothing to do" and "the anchor moved" are different outcomes: report the
    // first as already-patched so tools/harden.mjs can trust a NO MATCH line.
    if (text.includes('resolveResultRecipients')) { console.log(`already   ${site.file}`); continue; }
    console.warn(`NO MATCH: ${site.file}`);
    continue;
  }
  text = text.replace(site.from, () => REPLACEMENT);
  if (!text.includes(IMPORT)) {
    const anchor = text.match(/^import .*emailNotificationService.*$/m) || text.match(/^import .*supabaseClient.*$/m);
    if (anchor) text = text.replace(anchor[0], `${anchor[0]}\r\n${IMPORT}`);
    else console.warn(`  no import anchor in ${site.file}`);
  }
  console.log(`patched ${site.file} (${hits.length} site${hits.length > 1 ? 's' : ''})`);
  if (!DRY) writeFileSync(p, text);
}

// --- 3. website enquiry notices ---------------------------------------------
// /api/notify already folds bluebell_settings.adminEmail in server-side, so only the
// extra staff copy list has to come from the environment.
{
  const p = join(ROOT, 'bluebellschool-website', 'lib', 'enquiry.js');
  if (!existsSync(p)) { console.warn('missing bluebellschool-website/lib/enquiry.js'); }
  else {
    let text = readFileSync(p, 'utf8');
    const from = new RegExp(
      '// Fixed staff recipients for every website enquiry[\\s\\S]*?' +
      'const STAFF_NOTIFY_EMAILS = \\[[^\\]]*\\];'
    );
    if (!from.test(text)) {
      if (text.includes('parseRecipients')) console.log('already   bluebellschool-website/lib/enquiry.js');
      else console.warn('NO MATCH: bluebellschool-website/lib/enquiry.js');
    }
    else {
      text = text.replace(from, () => [
        '// Extra staff to copy on every website enquiry / admissions notification. The',
        '// school office address (bluebell_settings.adminEmail) is folded in server-side by',
        '// /api/notify, so only the additions are listed here — and they come from the',
        '// environment, never from a hard-coded mailbox.',
        'const STAFF_NOTIFY_EMAILS = parseRecipients(process.env.NEXT_PUBLIC_RESULT_EMAIL_RECIPIENTS);',
      ].join('\r\n'));
      const imp = "import { parseRecipients } from '../src/utils/resultRecipients';";
      if (!text.includes(imp)) {
        const anchor = text.match(/^import .*supabaseClient.*$/m);
        text = text.replace(anchor[0], `${anchor[0]}\r\n${imp}`);
      }
      console.log('patched bluebellschool-website/lib/enquiry.js (1 site)');
      if (!DRY) writeFileSync(p, text);
    }
  }
}

// --- 4. the mail service must treat an empty list as "nothing configured" ----
// Call sites now pass whatever resolveResultRecipients() found, and it can be
// empty until the school sets an address. Sending to no one is a configuration
// gap, not an API call: fall back to the database lookup and report it the same
// way a missing recipient list already was.
for (const app of NOTIFYING) {
  const p = join(ROOT, app, 'src', 'api', 'emailNotificationService.js');
  if (!existsSync(p)) continue;
  let text = readFileSync(p, 'utf8');
  const from = /if \(!emailRecipients\) \{/;
  if (!from.test(text)) {
    if (/!emailRecipients \|\| !emailRecipients\.length/.test(text)) { console.log(`already   ${app}/src/api/emailNotificationService.js`); continue; }
    console.warn(`NO MATCH: ${app}/src/api/emailNotificationService.js`);
    continue;
  }
  text = text.replace(from, () => [
    '    // An empty array means this school has not configured an address yet —',
    '    // fall back to the settings lookup instead of POSTing mail to nobody.',
    '    if (!emailRecipients || !emailRecipients.length) {',
  ].join('\r\n'));
  console.log(`patched ${app}/src/api/emailNotificationService.js (empty-recipient guard)`);
  if (!DRY) writeFileSync(p, text);
}
