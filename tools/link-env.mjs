// SUPERSEDED for Bluebell. In the shared-database precedent this copied JMIS's
// Supabase triple into every portal env — pointing the build at another school's
// live project. Bluebell owns its OWN Supabase project, so env wiring lives in
// tools/set-backend.mjs (which refuses the foreign refs and rewrites the four
// env files + the Expo app.json in one command). This file does nothing and
// refuses to run; it is kept only so a stale muscle-memory invocation is safe.
//
//   use instead:  node tools/set-backend.mjs --url=… --anon=… --service=…
import { ROOT } from './guard.mjs';

console.error('tools/link-env.mjs is disabled for Bluebell: it targeted a SHARED Supabase project.');
console.error('Bluebell wires its own project through tools/set-backend.mjs.');
console.error(`(guard: ROOT=${ROOT})`);
process.exit(1);
