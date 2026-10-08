// Shared boot module for every script in this build.
//
// Importing it IS the guard rail: it resolves ROOT from this file's own
// location (never process.cwd(), which is whatever directory the caller
// happened to be standing in) and refuses to continue unless that root is the
// Bluebell build. A tool copied into the wrong tree therefore writes nothing at
// all instead of rebranding somebody's production app.
//
// It also owns the two things every tool needs and none should hard-code:
//   BRAND   — tools/brand.json, the single source of truth
//   backend() — Bluebell's Supabase triple, from tools/backend.json when the
//               keys have been supplied, else greppable placeholders. The build
//               must stay complete and bootable before the project exists.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED_ROOT = 'c:/users/black-box/documents/builds/bluebell';
const normalised = ROOT.toLowerCase().replace(/\\/g, '/');
if (normalised !== ALLOWED_ROOT) {
  console.error(`refusing to run: ROOT=${ROOT} is not the bluebell build (${ALLOWED_ROOT})`);
  process.exit(1);
}

const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

export const BRAND = readJson('tools/brand.json');
export const PALETTE = readJson(BRAND.paletteFile);

export const APPS = BRAND.dirs;
export const PORTS = BRAND.ports;
export const ATTENDANCE_WEB_PORT = BRAND.attendanceWebPort;
export const JMIS_REF = BRAND.supabase.jmisRef;
export const FORBIDDEN_REFS = BRAND.supabase.forbiddenRefs;
export const DRY = process.argv.includes('--dry');

export const PLACEHOLDER_BACKEND = {
  ref: 'BLUEBELL_SUPABASE_REF_PLACEHOLDER',
  url: 'https://BLUEBELL_SUPABASE_REF_PLACEHOLDER.supabase.co',
  anonKey: 'BLUEBELL_SUPABASE_ANON_KEY_PLACEHOLDER',
  serviceKey: 'BLUEBELL_SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER',
  keysPending: true,
};

/** Bluebell's own Supabase project, or placeholders until tools/backend.json exists. */
export function backend() {
  const file = join(ROOT, BRAND.supabase.keysFile);
  if (!existsSync(file)) return { ...PLACEHOLDER_BACKEND };
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const url = j.url || j.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = j.anonKey || j.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = j.serviceKey || j.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) return { ...PLACEHOLDER_BACKEND };
  const ref = new URL(url).host.split('.')[0];
  assertNotForbidden(ref, 'backend.json url');
  return { ref, url, anonKey, serviceKey: serviceKey || '', keysPending: false };
}

/** Two schools must never share a project, and this build must never write to one. */
export function assertNotForbidden(ref, where) {
  if (!ref) return;
  if (FORBIDDEN_REFS.includes(ref)) {
    console.error(`refusing to use ref "${ref}" (${where}): it belongs to another school's project`);
    process.exit(1);
  }
}

/** Every dev port this build may bind, for the boot/verify probes. */
export const ORIGINS = Object.fromEntries(
  Object.entries(PORTS).map(([dir, port]) => [dir, `http://localhost:${port}`]),
);

export const joinRoot = (...p) => join(ROOT, ...p);
