// Renames every `<from>_*` database identifier to `<to>_*` across the repo:
// the db/*.sql provisioning bundle, all five apps' callsites, setup SQL under
// <admin>/src/api (files renamed too), and the tooling/docs.
//
//   node tools/rename-tables.mjs         # rewrite + rename files
//   node tools/rename-tables.mjs --dry   # report only
//
// BLUEBELL USE: this is a no-op by design. Bluebell owns its own Supabase
// project and keeps the jmis_* table names byte-parallel with JMIS, so
// tools/brand.json sets tablePrefix="jmis" and renameTables=false. The tool
// refuses to run in that state; it is kept only so that if a future Bluebell
// ever shares a database, the rename can be replayed by flipping renameTables
// and setting tablePrefix — the source/target both derive from brand.json, so
// this file carries no hard-coded other-school token.
//
// Deliberate keeps (client-side storage keys, not database objects):
//   localStorage "jmis-theme", sessionStorage "jmis_impersonating".
// Excluded: tools/export-exact-ddl.sql — it is run against the LIVE JMIS
// project, whose tables keep their jmis_* names.
import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { ROOT, BRAND, DRY } from './guard.mjs';

const FROM = BRAND.source.prefix;         // "jmis"
const TO = BRAND.tablePrefix;             // "jmis" for Bluebell (no rename)
if (!BRAND.renameTables || FROM === TO) {
  console.log(`renaming disabled: brand.json renameTables=${BRAND.renameTables}, source="${FROM}" target="${TO}".`);
  console.log(`Bluebell keeps the ${FROM}_* table names, so there is nothing to rename. No file was touched.`);
  process.exit(0);
}

const ADMIN = BRAND.dirs[0];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.expo', '.swc', '.verify', 'dist', 'build', 'out', 'android', 'ios', 'coverage']);
const EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt', '.sql', '.yaml', '.yml']);
const SKIP_FILES = new Set([
  join(ROOT, 'tools', 'export-exact-ddl.sql'),
  join(ROOT, 'tools', 'rename-tables.mjs'), // this script holds the literal tokens
  join(ROOT, 'package-lock.json'),
]);
function skipFile(name) {
  return name === 'package-lock.json';
}

// Order matters: protected tokens are restored after the global pass.
const KEEP_TOKEN = '\u0000KEEP_IMPERSONATING\u0000';
const PROTECT = [[`${FROM}_impersonating`, KEEP_TOKEN]];
const REPLACEMENTS = [[new RegExp(`${FROM}_`, 'g'), `${TO}_`]];

let changed = 0;
const touched = [];

function rewrite(path) {
  const text = readFileSync(path, 'utf8');
  let out = text;
  for (const [from, token] of PROTECT) out = out.split(from).join(token);
  for (const [re, to] of REPLACEMENTS) out = out.replace(re, to);
  for (const [, token] of PROTECT) out = out.split(token).join(token === KEEP_TOKEN ? `${FROM}_impersonating` : token);
  if (out !== text) {
    changed++;
    touched.push(relative(ROOT, path).split(sep).join('/'));
    if (!DRY) writeFileSync(path, out, 'utf8');
  }
  const upper = (text.match(new RegExp(`${FROM.toUpperCase()}_`, 'g')) || []).length;
  if (upper) console.log(`  NOTE uppercase ${FROM.toUpperCase()}_ x${upper} in ${relative(ROOT, path)}`);
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(join(dir, e.name));
    } else if (e.isFile()) {
      yield join(dir, e.name);
    }
  }
}

const sqlRenames = [];
for (const file of walk(ROOT)) {
  if (SKIP_FILES.has(file) || skipFile(file.split(/[\\/]/).pop())) continue;
  const ext = file.slice(file.lastIndexOf('.'));
  if (!EXT.has(ext)) continue;
  rewrite(file);
  const base = file.split(/[\\/]/).pop();
  if (base.startsWith(`${FROM}_`)) sqlRenames.push([file, join(dirname(file), base.replace(new RegExp(`^${FROM}_`), `${TO}_`))]);
}

for (const [from, to] of sqlRenames) {
  if (existsSync(to)) { console.log(`  rename skipped (target exists): ${relative(ROOT, from)}`); continue; }
  if (!DRY) renameSync(from, to);
  console.log(`  renamed ${relative(ROOT, from).split(sep).join('/')} -> ${relative(ROOT, to).split(sep).join('/')}`);
}

console.log(`${DRY ? '[dry] ' : ''}${changed} file(s) rewritten, ${sqlRenames.length} file(s) renamed. (${ADMIN}/src/api included.)`);
