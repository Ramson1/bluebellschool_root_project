# Black-Box Institution — school-management build

A standalone build of the JMIS school-management apps, **rebranded for
Black-Box Institution** (motto: *Discover. Design. Deliver.*). It began as a
direct JMIS clone (`builds/jmis/jmischool*`) renamed to *Bluebell International
School*, and was then rebranded again to Black-Box by
`tools/rebrand-blackbox.mjs` — name, motto and logo, over all six apps. The
**blue brand colour and every table, route, component and business rule are
unchanged**; the `bluebell_*` database identifiers are kept verbatim (see
*Parity rule* below), so the SQL bundle and callsites stay byte-parallel with
`builds/jmis/jmischool*`.

The Black-Box **logo** — a square black-box mark — is sourced from
`brand/blackbox-logo-master.png` and replaces the Bluebell crest in every
logo, favicon, apple-touch, Expo icon and splash slot across all apps. The
wordmark lives at `brand/blackbox-wordmark.png`.

## The apps

| Directory | What it is | Dev port | Served `<title>` |
|---|---|---|---|
| `bluebellschool` | admin portal (app-router + `src/pages_components`) | 3300 | Black-Box Institution |
| `bluebellschool-website` | public site + student CBT | 3301 | Black-Box Institution |
| `bluebellschool-staff` | staff portal | 3302 | Black-Box Staff Portal |
| `bluebellschool-student` | student portal | 3303 | Black-Box Student Portal |
| `bluebellschool-attendance-app` | Expo React Native attendance app | 8091 (`npm run web`) | — |
| `bluebell-offline-cbt` | offline Electron CBT desktop app | — | Black-Box Offline CBT |

Identify a running server by its served `<title>`, **never** by remembered
port: `next dev` reassigns when a port is busy, and one server per project
directory holds `.next/dev/lock`.

## Brand

`tools/brand.json` is the single source of truth (names, dirs, ports,
Supabase ref, table prefix, titles) and `tools/palette.json` the single source
of truth for colour. Both are read by the scripts; nothing hard-codes a Black-Box
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

1. `node tools/set-backend.mjs --url=… --anon=… --service=…` — adopts Black-Box's
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
`renameTables = true`) — Black-Box has its **own** Supabase project, so the
JMIS `jmis_*` identifiers were rewritten via `tools/rename-tables.mjs`.
Deliberately retained JMIS identifiers: `localStorage` keys `jmis-theme` and
`jmis_impersonating` (client-side, not database objects). The website footer
carries a **Black-Box Tech** agency credit (`/blackbox-tech.jpg`,
`info@blackboxtech.online`, `https://blackboxtech.online`); the sole built-in
developer/owner account is `blackboxinfo01@gmail.com` (`DEV_EMAILS` /
`OWNER_EMAIL` in `src/utils/authUtils.js` and `serverAdminAuth.ts`).

Deliberately retained (internal, not visible branding): the `bluebell_*`
table/column names, the `bluebellschool*` directory and package names, the
`jmis-theme` / `jmis_impersonating` `localStorage` keys and the
`BLUEBELL_*_PLACEHOLDER` sentinels. The old Bluebell contact domain/email were
rewritten to `blackboxtech.online` / `info@blackboxtech.online`.

> **Live database:** the already-provisioned `bluebell_settings` row still
> carries the old school name and hero text (the DB was intentionally not
> migrated). Update it in the admin **Setting** page, or re-apply
> `db/04_seed_bluebell.sql`, to match the new branding. The app's own titles,
> headers, labels and logos are already Black-Box.

## Toolchain

| Script | What it does |
|---|---|
| `tools/rebrand-blackbox.mjs` | the Black-Box pass: case-sensitive `Bluebell → Black-Box` name/motto rewrite (never touches `bluebell_*` identifiers) **plus** rebuilds every logo/favicon/app-icon/splash slot from `brand/blackbox-logo-master.png`; `--dry`, `--text-only`, `--assets-only` |
| `tools/rebrand.mjs` | **legacy** JMIS → Bluebell pass (name/phrase/colour + ports + env + Expo `app.json`). Retained for the `set-backend.mjs` backend flow; do not run on the Black-Box tree |
| `tools/harden.mjs` | cross-tenant fixes that must survive a future JMIS port (payment key, AdSense, manifest, EAS identity, result recipients) |
| `tools/rebrand-assets.mjs` | derives every logo/favicon/ICO/Expo icon slot from the round master crest (legacy; superseded by `rebrand-blackbox.mjs` for the square Black-Box mark) |
| `tools/build-site-images.mjs` | optimises `brand/site/` into `public/site/` for website + admin |
| `tools/gen-schema.mjs` | generates `db/*` from the live JMIS PostgREST catalog (read-only) plus the clone's own `.from()` callsites |
| `tools/set-backend.mjs` | one command to adopt Black-Box's Supabase project |
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
4. Unknown Black-Box facts are `BLUEBELL_<THING>_PLACEHOLDER`, never a plausible
   invention.
5. No secret is ever printed — env tooling reports names, lengths and yes/no.
