# Bluebell International School — JMIS clone

A standalone build of the five JMIS school-management apps, rebranded for
**Bluebell International School** (motto: *Wisdom, Integrity, Courage*).

Only four things differ from JMIS: the **school name**, the **logo**, the
**brand colour** (JMIS green → crest blue) and the **Supabase project**. Every
table, route, component and business rule is byte-parallel with
`builds/jmis/jmischool*`, so a future JMIS fix can be `cp`-ported and
`diff`-checked rather than re-implemented.

## The five apps

| Directory | What it is | Dev port | Served `<title>` |
|---|---|---|---|
| `bluebellschool` | admin portal (app-router + `src/pages_components`) | 3300 | Bluebell International School |
| `bluebellschool-website` | public site + student CBT | 3301 | Bluebell School — Bluebell International School |
| `bluebellschool-staff` | staff portal | 3302 | Bluebell Staff Portal |
| `bluebellschool-student` | student portal | 3303 | Bluebell Student Portal |
| `bluebellschool-attendance-app` | Expo React Native attendance app | 8091 (`npm run web`) | — |

Identify a running server by its served `<title>`, **never** by remembered
port: `next dev` reassigns when a port is busy, and one server per project
directory holds `.next/dev/lock`.

## Brand

`tools/brand.json` is the single source of truth (names, dirs, ports,
Supabase ref, table prefix, titles) and `tools/palette.json` the single source
of truth for colour. Both are read by the scripts; nothing hard-codes a Bluebell
value anywhere else.

Sampled from `brand/bluebell-logo-master.png` (44.2 % blue / 55.1 % yellow of
529 662 coloured pixels):

| Role | Hex | White-text contrast |
|---|---|---|
| primary (buttons, links, nav) | `#022aa1` | 11.36 : 1 |
| deep (headings, dark headers) | `#011b97` | 13.08 : 1 |
| light | `#1f4fd8` | 6.63 : 1 |
| tint / borders | `#e8f0fe` | — |
| bell cyan | `#019cf2` | **2.98 : 1 — decoration only, never carries text** |
| laurel gold | `#fde616` | **1.27 : 1 — decoration only** (8.93 : 1 on navy) |

The 16 status greens (`#28a745`, `#198754`, `#1cc88a`, …) are deliberately
**not** remapped: attendance "present" and payment "paid" stay green.

## Provisioning order

1. `node tools/set-backend.mjs --url=… --anon=… --service=…` — adopts Bluebell's
   own Supabase project (writes gitignored `tools/backend.json`, rewrites all
   four env files + `app.json.extra`, re-runs `rebrand.mjs`).
2. Apply the database: `node tools/run-sql.mjs --apply` with a `sbp_`
   `SUPABASE_ACCESS_TOKEN`, **or** paste `db/*.sql` in this exact order:

   ```
   01_schema.sql  →  02_rls.sql  →  00_indexes.sql  →  03_storage.sql  →  04_seed_bluebell.sql
   ```

   `00_indexes.sql` is pasted **third** on purpose: its 46 index and 75 policy
   statements run through a `bb_try()` helper that reports-and-skips, so pasting
   it before the tables exist would silently create zero indexes.
3. `node tools/create-auth-users.mjs --apply` — the login accounts (Supabase
   Auth owns the passwords; `bluebell_userauth` rows grant the roles).

Until step 1 the build carries `BLUEBELL_SUPABASE_REF_PLACEHOLDER` and still
compiles and boots; until step 2 every screen comes up empty, which is expected
and is not a clone defect.

## Parity rule

Table names use the `bluebell_*` prefix (`brand.json.tablePrefix = "bluebell"`,
`renameTables = true`) — Bluebell has its **own** Supabase project, so the
JMIS `jmis_*` identifiers were rewritten via `tools/rename-tables.mjs`.
Deliberately retained JMIS identifiers: `localStorage` keys `jmis-theme` and
`jmis_impersonating` (client-side, not database objects). The website footer
carries a **Black-Box Tech** agency credit (`/blackbox-tech.jpg`,
`info@blackboxtech.online`, `https://blackboxtech.online`); the sole built-in
developer/owner account is `blackboxinfo01@gmail.com` (`DEV_EMAILS` /
`OWNER_EMAIL` in `src/utils/authUtils.js` and `serverAdminAuth.ts`).

## Toolchain

| Script | What it does |
|---|---|
| `tools/rebrand.mjs` | ordered, case-sensitive name/phrase/colour pass + ports + env + Expo `app.json`; `--dry` prints per-rule hit counts |
| `tools/harden.mjs` | cross-tenant fixes that must survive a future JMIS port (payment key, AdSense, manifest, EAS identity, result recipients) |
| `tools/rebrand-assets.mjs` | derives every logo/favicon/ICO/Expo icon slot from the master crest |
| `tools/build-site-images.mjs` | optimises `brand/site/` into `public/site/` for website + admin |
| `tools/gen-schema.mjs` | generates `db/*` from the live JMIS PostgREST catalog (read-only) plus the clone's own `.from()` callsites |
| `tools/set-backend.mjs` | one command to adopt Bluebell's Supabase project |
| `tools/run-sql.mjs` | applies `db/*` through the Supabase Management API, or prints the paste order |
| `tools/create-auth-users.mjs` | creates login accounts through GoTrue (dry-run by default) |
| `tools/syntax-check.mjs` | babel-parses every source file; separates clone damage from pre-existing JMIS issues |
| `tools/verify.mjs` | `--brand` residual scan, `--routes` + asset probes, `--db` table/bucket probes |

## Guard rails (this build writes nowhere else)

1. Every tool resolves `ROOT` from its own location and **refuses to run** if
   that root is not `…/builds/bluebell`.
2. After every mutating phase, non-interference is proven:
   `git -C ../spring status --porcelain` stays empty and
   `find ../jmis -newermt <phase-start> -type f -not -path "*/node_modules/*"
   -not -path "*/.next/*"` returns nothing.
3. Nothing may target `btnatydmfunhwgoeguus` (JMIS's live project) or
   `wjqjreiuahykuxyrugou` (another clone's); the tools hard-refuse them and the
   brand scan fails on either string appearing in source.
4. Unknown Bluebell facts are `BLUEBELL_<THING>_PLACEHOLDER`, never a plausible
   invention.
5. No secret is ever printed — env tooling reports names, lengths and yes/no.
