# SENTRIX Security V2

Web-application security assessment platform. React Router + Nitro (Agent-Native framework) UI, **Supabase** (Postgres, Auth, RLS, Storage) as the single backend, and a separate **scanner worker**.

> Status: see [docs/SUPABASE_PLAN.md](docs/SUPABASE_PLAN.md) for exactly what is implemented, verified, and still planned. Nothing here claims the platform is "secure"; it enforces specific, tested controls.

## Architecture
```
Browser ──► Nitro/React Router app ──► Supabase (Auth + Postgres/RLS)  ◄── Scanner worker (service key)
              │ actions use the signed-in user's JWT         │                 │ claims jobs, runs modules,
              │ → RLS enforces workspace + role              │                 │ writes findings/evidence
              └ privileged writes only in verify-target      └ private storage └ SSRF-guarded network access
```
- **Framework kept:** routes, wizard, findings table, dashboard, dark theme, shadcn components, action names/shapes.
- **Supabase:** all application data (`supabase/migrations`), authentication (custom-session mode of the framework, `server/plugins/auth.ts`), authorization (RLS + permission matrix + trusted RPCs + triggers).
- **Legacy:** `drizzle/schema.ts` is deprecated and unused by actions.

## Prerequisites
Node ≥ 22.22, pnpm 10, a Supabase project.

## Environment (`.env`, never committed)
| Variable | Needed by | Where to find it |
|---|---|---|
| `SUPABASE_URL` | app, worker | Dashboard → Project Settings → API |
| `SUPABASE_PUBLISHABLE_KEY` | app | Dashboard → API Keys (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | worker, `verify-target` | Dashboard → API Keys (secret). **Server only, never the browser** |
| `VERIFICATION_SECRET` | app | any long random string (falls back to the secret key) |
| `SIGNUP_ENABLED` | app | `true` to allow self-registration (default off) |
| `WORKER_CONCURRENCY` | worker | 1–4 |

## Supabase setup
1. Apply migrations in order (SQL Editor, or `supabase db push`):
   `20261023000001_core_schema.sql`, `…0002_rls_and_workflows.sql`, `…0004_activity_triggers.sql`, then `…0003_storage.sql` (needs the Storage schema; **not yet tested**).
2. Authentication → URL Configuration: add your site URL and `<site>/api/auth/callback` to the redirect allow-list.
3. Authentication → Providers → Email: choose whether to require email confirmation (recommended on).
4. Run Security Advisor; the only expected warnings are the four workspace RPCs (`create_workspace`, `add_workspace_member`, `set_member_role`, `remove_workspace_member`), which are callable by signed-in users by design and check permissions inside.

### First owner / workspace provisioning
There is no default admin. A user registers (or is invited via Supabase), signs in, and is asked to **create a workspace**, which makes them its **owner**. Owners/admins add members through the trusted RPCs (`add_workspace_member`, `set_member_role`); there is no member-management UI yet. Users cannot insert membership rows, change their own role, or remove the last owner (enforced in the database and tested).

## Local development
```bash
pnpm install
cp .env.example .env   # fill in values
pnpm dev               # app
pnpm worker            # scanner worker (separate terminal; add -- --once for a single pass)
```

## Tests
```bash
pnpm test              # all (see "Known baseline failures")
pnpm test:rls          # real SQL migrations run in PGlite: RLS, roles, lifecycle, triggers
pnpm typecheck && pnpm build
```
What the tests cover: workspace isolation, role limits, membership abuse, assessment transition guard, verified-target gate, frozen scope, idempotency, finding close rules, audit/activity triggers (`tests/supabase-rls.spec.ts`); SSRF primitives and connection-time lookup (`server/lib/*.spec.ts`); module analyzers (`worker/modules`); runner orchestration with an in-memory store (`worker/runner.spec.ts`). RLS was additionally checked once against the hosted Supabase project in a rolled-back transaction.

**Not covered by automated tests yet:** login/session flows against GoTrue, PostgREST-level behaviour of the actions, the Supabase-backed worker store, storage policies, UI components, reports.

### Known baseline failures
7 tests fail identically on the untouched upload (`tests/use-navigation-state.spec.ts` ×6, `server/mcp-provider-schemas.spec.ts`): stale navigation tests and a module-resolution problem with the generated actions registry.

## Scanner worker
`worker/` is a Node process using the service key. It claims a queued job with an optimistic update, re-validates authorization and DNS, runs only selected modules with per-module timeouts, saves findings idempotently (fingerprint upsert), honours cancellation between modules, and retries transient failures with backoff. Delivery is **at-least-once**, not exactly-once; every step is idempotent.

Implemented modules: `security-headers`, `tls-config` (negotiated protocol + certificate), `cookie-security` — all passive, single-host, bounded requests.
**Not implemented:** dependency analysis, static source analysis (these must run in an isolated sandbox/container), active/authorization testing, scheduled assessments, CVSS scoring. The UI marks them "Not available yet" and they cannot be queued.

Run the worker where outbound traffic is limited to the public internet (block RFC1918, link-local and cloud metadata ranges at the network layer). In-process guards (IPv4/6 classification, DNS re-resolution, connection-time lookup check, same-origin redirect policy, excluded paths, request budget) are defense in depth.

## Target authorization
Targets must be registered and proven with a DNS TXT record (`_sentrix-challenge.<host>`) or `/.well-known/sentrix-verification.txt`. Tokens are HMAC-derived server-side; verification lasts 90 days; the database refuses to queue an assessment for an unverified/expired target, and the worker re-checks at run time.

## Deployment
Build with `pnpm build`, run the app (`pnpm start`) and the worker as separate services. Set the env vars above on the host (never in the repo). Configure the Supabase redirect allow-list for the production URL. Use HTTPS only (auth cookies are `Secure` on HTTPS).

## Backup and recovery
Use Supabase backups/PITR (paid plans) or scheduled `pg_dump`; migrations in `supabase/migrations` rebuild the schema. Storage objects are not part of database backups.

## Security considerations and limitations
- Authorization lives in Postgres (RLS, triggers, RPC); UI hiding is cosmetic. Actions run as the signed-in user, so a missing check in code cannot bypass RLS.
- The service key is used only by the worker and by `verify-target` after an explicit permission check.
- Dashboard trend reads a bounded window (≤5000 narrow rows); a SQL aggregate is planned.
- Reports (PDF/JSON/CSV), remediation/retest UI, member-management UI, Realtime, private evidence/report storage workflows, and scheduled runs are **not implemented**.
- Hosted-Supabase auth flows could not be exercised from the build sandbox (outbound access to supabase.co was blocked); verify sign-up/sign-in/reset on your machine.
