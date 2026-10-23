# SENTRIX V2 — Architecture assessment & Supabase migration plan

Status legend: **DONE** (implemented and verified by an executed test), **PARTIAL**, **PLANNED** (not implemented).

## 1. Architecture assessment (Phase 1 findings)
- Framework: Agent-Native on React Router 8 + Nitro/h3, Drizzle ORM, Better Auth (framework-managed), zod actions in `actions/`.
- Data layer: 4 tables (`projects`, `assessments`, `findings`, `activity_events`), all `text` ids and **`text` timestamps**, no FKs, no workspace/user column. Every action reads/writes globally: **any signed-in user sees all data (no isolation)**.
- Persisted features: create project, create assessment (record only), cancel assessment, update finding status, activity events, dashboard summary.
- Not real: assessments are **only records** (status `queued` forever; nothing executes). No finding ingestion path exists (findings can only come from direct DB inserts). `targetAttested` is a checkbox, not proof of ownership. Dashboard loads **all findings into memory** to count.
- No authorization beyond the framework's session guard. No audit log. No reports, remediation, retests, storage.
- Tests: baseline `pnpm test` had **7 failing tests before any change** (`tests/use-navigation-state.spec.ts` x6 and the generated-actions registry in `server/mcp-provider-schemas.spec.ts`); `typecheck` passed. These are pre-existing and unrelated to this work.
- Validator gaps found: `http://localhost./` was accepted (fixed); hostnames resolving to private IPs cannot be caught statically (guard added).

## 2. Preserve
Routes, wizard (6 steps), findings table (server-side filter/sort/paging), dashboard layout, dark theme, `app/components/sentrix/*`, action names/signatures where possible.

## 3. Decision: one source of truth
Supabase Postgres becomes the **only** application database. Drizzle tables are retired after verified migration (existing data is demo-grade; export script + row-count/checksum verification before dropping). Do not run both in parallel.
Auth: Better Auth is framework-managed. `createAuthPlugin({ getSession })` accepts a custom session resolver, so Supabase Auth can be plugged in without replacing routing — **not yet verified at runtime; this is the first integration spike (step 4).** Fallback: keep Better Auth for login and map its user id into `auth.users`-less profiles — worse (no RLS `auth.uid()`), so only if the spike fails.

## 4. Status vs. the brief (updated)
| Phase | Status |
|---|---|
| 7 Migrations (20 tables, composite FKs, checks, indexes) | **DONE**, applied to project `sentrix-security`; run in PGlite tests |
| 6/8 Roles, permissions, RLS, trusted membership RPCs | **DONE**; 28 executed tests + one rolled-back check on hosted Postgres |
| 12 lifecycle guard, verified-target gate, idempotency, job enqueue | **DONE** (DB) and wired in `create-assessment` / `cancel-assessment` |
| 15/16 finding guards (close needs fixed + passing retest + approval) | **DONE at DB layer**; no remediation/retest UI yet |
| 19 Audit triggers | **DONE** (DB); activity timeline triggers in migration 0004 |
| 11 Target registration, ownership verification, SSRF guard | **DONE** (actions + `server/lib/*`, 54 tests); egress policy is deployment-level |
| 3/4 Supabase clients, env validation | **DONE** (`server/lib/supabase*.ts`) |
| 5 Auth: login/logout/register/reset/session, protected routes | **IMPLEMENTED, NOT VERIFIED E2E** (sandbox could not reach supabase.co); account profile page not built |
| 10 Projects (create/list/update/archive/delete) | **DONE** (actions); UI: creation in wizard only, no project management page yet |
| 12 Assessments (create/list/get/cancel, history) | **DONE** (actions + wizard + monitor); depends on worker |
| 13/14 Worker + 3 real passive modules | **DONE, unit-tested**; Supabase-backed store not exercised against the hosted DB |
| 15 Findings list/detail/status | **DONE** (actions); owner assignment UI not built |
| 17 Dashboard (counts via server-side aggregation) | **DONE** (trend uses bounded query); Realtime **PLANNED** |
| 9 Storage buckets/policies | **WRITTEN, UNTESTED** (migration 0003 not applied) |
| 16/18 Remediation UI, retests UI, reports PDF/JSON/CSV | **PLANNED** |
| Dependency/static analysis, active testing, schedules, CVSS | **PLANNED** (needs isolated runtime) |
| 22 README | **DONE** |

## 5. Next steps
1. Apply migration 0004 (and 0003 after review) in the Supabase SQL Editor; set `SUPABASE_SECRET_KEY`; run `pnpm dev` + `pnpm worker` and walk through sign-up → workspace → project → verify target → assessment on your machine.
2. Reports (JSON/CSV first, PDF after), remediation + retest UI, member management UI.
3. Dashboard SQL aggregate RPC; Realtime for assessment status.
4. Isolated runner for dependency/static analysis.

## 6. Known limitations (today)
- Auth and PostgREST-backed actions have not been exercised end-to-end (sandbox could not reach supabase.co); RLS was verified in PGlite and once on the hosted DB via SQL.
- The scanner has never run against a real site in this environment; analyzers and orchestration are unit-tested only.
- Existing Drizzle data (demo-grade) is not migrated; the old tables are deprecated and unused.
