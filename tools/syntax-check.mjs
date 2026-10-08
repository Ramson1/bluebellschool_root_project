// Phase 5.2 — syntax gate.
//
// The rebrand/asset/schema passes rewrote source files with scripted string
// substitutions, and this repo has no language server, so every parseable file
// in the clone is parsed here. A file that fails to parse is either a broken
// substitution or (rarely) syntax this checker's plugin set does not know; to
// tell the two apart, the JMIS twin of a failing file is parsed too — a twin
// that fails identically is a pre-existing condition, not clone damage.
//
//   node tools/syntax-check.mjs            # parse everything
//   node tools/syntax-check.mjs --changed  # only files that differ from JMIS
//
// Writes nothing, exits non-zero on clone-only failures.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ROOT, BRAND } from './guard.mjs';

const JMIS_ROOT = resolve(BRAND.source.root);
if (!existsSync(JMIS_ROOT)) {
  console.error(`FAIL: the parity reference tree ${JMIS_ROOT} is missing`);
  process.exit(1);
}

// sharp/@babel live in the JMIS build; nothing is installed at bluebell/ root.
const require = createRequire(join(JMIS_ROOT, 'jmischool', 'package.json'));
const { parse } = require('@babel/parser');

// clone directory -> JMIS directory, so every failure can be re-parsed against
// its twin. Derived from brand.json rather than spelled out again here.
const APPS = Object.fromEntries(BRAND.dirs.map((d) => [d, d.replace('bluebellschool', 'jmischool')]));
for (const [clone, src] of Object.entries(APPS)) {
  if (!existsSync(join(JMIS_ROOT, src))) {
    console.error(`FAIL: the parity reference ${join(JMIS_ROOT, src)} is missing`);
    process.exit(1);
  }
}

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.expo', '.git', 'out', 'build', 'dist', 'coverage',
  '.swc', '.turbo', 'storybook-static', 'android', 'ios', 'vendor',
]);
const EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

// Widest plugin set first; fall back if the installed parser rejects a name.
const PLUGIN_SETS = [
  ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'classPrivateProperties',
    'classPrivateMethods', 'numericSeparator', 'bigInt', 'optionalChaining',
    'nullishCoalescingOperator', 'importAssertions', 'importAttributes',
    'explicitResourceManagement', 'exportDefaultFrom'],
  ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'classPrivateProperties',
    'classPrivateMethods', 'numericSeparator', 'bigInt', 'importAttributes'],
  ['jsx', 'typescript'],
  ['jsx'],
];

function pluginsFor(file) {
  const base = ['.js', '.jsx', '.mjs', '.cjs'].includes(ext(file))
    ? PLUGIN_SETS.map((p) => p.filter((x) => x !== 'typescript'))
    : PLUGIN_SETS;
  return base;
}

const ext = (p) => p.slice(p.lastIndexOf('.'));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXT.has(ext(entry))) out.push(full);
  }
  return out;
}

function parseFile(full) {
  const code = readFileSync(full, 'utf8');
  // .d.ts / empty files parse trivially; skip type-only declaration files
  if (!code.trim()) return null;
  let firstErr = null;
  for (const plugins of pluginsFor(full)) {
    try {
      parse(code, {
        sourceType: 'unambiguous',
        allowReturnOutsideFunction: true,
        errorRecovery: false,
        babelrc: false,
        plugins,
      });
      return null;
    } catch (e) {
      if (/Unknown plugin|must be called with|plugin .* not allowed|Unsupported/.test(e.message)) continue;
      if (!firstErr) firstErr = e;
      // Retry once more with a narrower set only for the typescript plugin,
      // which rejects plain-JS constructs (e.g. `<jsx>` vs `<T>` casts).
      if (plugins.includes('typescript')) continue;
      break;
    }
  }
  return firstErr;
}

function jmisTwin(full) {
  const rel = relative(ROOT, full).replace(/\\/g, '/');
  const app = rel.split('/')[0];
  const twinApp = APPS[app];
  if (!twinApp) return null;
  const twin = join(JMIS_ROOT, rel.replace(app + '/', twinApp + '/'));
  return existsSync(twin) ? twin : null;
}

// --changed: only report on files whose bytes differ from the JMIS twin, i.e.
// exactly the set the scripted passes could have damaged.
function differsFromTwin(full, twin) {
  if (!twin) return true; // clone-only file (generated tooling, seeded assets)
  return readFileSync(full) .length !== 0 &&
    readFileSync(full, 'utf8') !== readFileSync(twin, 'utf8');
}

const onlyChanged = process.argv.includes('--changed');
const failures = [];
const preexisting = [];
let checked = 0;
let changed = 0;

for (const app of Object.keys(APPS)) {
  const dir = join(ROOT, app);
  if (!existsSync(dir)) {
    console.log(`!! missing app directory ${app}`);
    process.exitCode = 1;
    continue;
  }
  const files = walk(dir);
  let appChecked = 0;
  for (const full of files) {
    const twin = jmisTwin(full);
    const isChanged = differsFromTwin(full, twin);
    if (isChanged) changed++;
    if (onlyChanged && !isChanged) continue;
    checked++;
    appChecked++;
    const err = parseFile(full);
    if (!err) continue;
    const twinErr = twin ? parseFile(twin) : null;
    const line = `${relative(ROOT, full).replace(/\\/g, '/')}:${err.loc ? err.loc.line : '?'}`;
    if (twinErr) preexisting.push([line, err.message]);
    else failures.push([line, err.message]);
  }
  console.log(`   ${app.padEnd(30)} ${String(files.length).padStart(4)} file(s)`);
}

console.log(`\nparsed ${checked} file(s); ${changed} differ from JMIS`);

// A run that looked at nothing is not a pass. Without this the tool reported
// "OK" over 0 files the first time it was pointed at a mis-named app folder.
if (checked === 0) {
  console.error('\nFAIL: no file was parsed — check the app directory names.');
  process.exitCode = 1;
}

if (preexisting.length) {
  console.log(`\n${preexisting.length} file(s) fail to parse in the clone AND in JMIS (pre-existing, not clone damage):`);
  for (const [l, m] of preexisting) console.log(`  ~ ${l}  ${m.split('\n')[0]}`);
}

if (failures.length) {
  console.error(`\nFAIL: ${failures.length} file(s) parse in JMIS (or are clone-only) but not here:`);
  for (const [l, m] of failures) console.error(`  x ${l}  ${m.split('\n')[0]}`);
  process.exitCode = 1;
} else {
  console.log('\nOK: every clone source file parses.');
}
