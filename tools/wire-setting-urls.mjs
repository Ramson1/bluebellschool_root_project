// Makes the "setting" image-URL helpers in the clone accept app-root paths.
//
//   node tools/wire-setting-urls.mjs [--dry]
//
// Why: the seeded marketing content points at locally shipped JPEGs
// (`/site/hero-classroom.jpg`) so Bluebell's public site is populated the moment
// the SQL seed is pasted, with no storage uploads and no JMIS content. The
// original helpers blindly prefixed the Supabase `setting` bucket URL, which
// turns `/site/x.jpg` into `…/object/public/setting//site/x.jpg`. This tool
// rewrites every helper (and its callsites) to pass through values that already
// start with `/` or `http`, keeping bare storage keys working exactly as before
// — so anything an admin uploads through the Settings page still resolves.
//
// Idempotent: re-running reports 0 changes.
import { ROOT, DRY } from './guard.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';


// Files that hardcode the public setting-bucket prefix as a local constant.
const ADMIN_FILES = [
  'bluebellschool/src/components/Hero.jsx',
  'bluebellschool/src/components/Gallery.jsx',
  'bluebellschool/src/components/Facilities.jsx',
  'bluebellschool/src/components/Testimonials.jsx',
  'bluebellschool/src/pages_components/Setting.jsx',
];

const DECL = /^([ \t]*)const getPublicUrl = '(https:[^']*?\/storage\/v1\/object\/public\/setting\/[^']*)';?[ \t]*$/gm;

// Member paths are allowed (`item.image`, `testimonial?.image`) but a following
// `+`-concatenation is the only form the original code used.
const EXPR = String.raw`([A-Za-z_$][\w$]*(?:\??\.[\w$]+)*)`;

const decl = (indent, base) =>
  [
    `${indent}// Resolves a setting-bucket image: seeded /site/* paths and absolute URLs`,
    `${indent}// are used as-is, a bare filename still comes from the public setting bucket.`,
    `${indent}const getPublicUrl = (file) => {`,
    `${indent}  if (!file) return '';`,
    `${indent}  const value = String(file);`,
    `${indent}  if (value.startsWith('/') || /^https?:\\/\\//i.test(value)) return value;`,
    `${indent}  return '${base}'.replace(/\\/+$/, '/') + value;`,
    `${indent}};`,
  ].join('\n');

const websitePatch = (s) => {
  const from = 'export const settingFileUrl = (file) =>';
  const i = s.indexOf(from);
  if (i === -1) throw new Error('settingFileUrl declaration not found — check the file');
  const end = s.indexOf(';', i);
  if (end === -1) throw new Error('settingFileUrl declaration is not terminated');
  const body = s.slice(i + from.length, end);
  if (body.trimStart().startsWith('{')) return s; // already rewired
  const base = body.trim(); // `${supabaseUrl}/storage/.../${file}`
  return (
    s.slice(0, i) +
    [
      'export const settingFileUrl = (file) => {',
      '  if (!file) return file;',
      '  const value = String(file);',
      '  // Seeded /site/* imagery and absolute URLs resolve as-is; a bare',
      '  // storage key still comes from the public `setting` bucket.',
      "  if (value.startsWith('/') || /^https?:\\/\\//i.test(value)) return value;",
      `  return ${base.replace(/\$\{file\}/, '${value}')};`,
      '};',
    ].join('\n') +
    s.slice(end + 1)
  );
};

let changed = 0;
const report = [];

const apply = (rel, transform) => {
  const path = join(ROOT, rel);
  const before = readFileSync(path, 'utf8');
  let after = transform(before);
  // Keep the file's own line endings (the Next apps are all CRLF).
  if (before.includes('\r\n')) after = after.replace(/\r?\n/g, '\r\n');
  if (after === before) {
    report.push(`  =    ${rel}`);
    return;
  }
  changed += 1;
  report.push(`  ${DRY ? '~' : '+'}    ${rel}`);
  if (!DRY) writeFileSync(path, after, 'utf8');
};

// 1. website helper (expression body -> pass-through function body)
apply('bluebellschool-website/lib/supabaseClient.js', websitePatch);

// 2. admin components: constant prefix -> pass-through resolver
for (const rel of ADMIN_FILES) {
  apply(rel, (s) => {
    let out = s.replace(DECL, (_m, indent, base) => decl(indent, base));
    // Repair a truncated call from an earlier revision: getPublicUrl(item).image
    out = out.replace(
      new RegExp(String.raw`getPublicUrl\(${EXPR}\)((?:\??\.[\w$]+)+)`, 'g'),
      'getPublicUrl($1$2)'
    );
    // `getPublicUrl + expr` -> `getPublicUrl(expr)`
    out = out.replace(new RegExp(String.raw`getPublicUrl\s*\+\s*${EXPR}`, 'g'), 'getPublicUrl($1)');
    // `${getPublicUrl}${expr}` -> `getPublicUrl(expr)`
    out = out.replace(/`\$\{getPublicUrl\}\$\{([^}]+)\}`/g, 'getPublicUrl($1)');
    return out;
  });
}

console.log(`${DRY ? '--dry ' : ''}${changed} file(s) rewired:`);
console.log(report.join('\n'));
