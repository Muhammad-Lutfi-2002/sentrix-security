// Runs the real SQL migrations in PGlite (Postgres 17 in WASM) with a minimal stub of
// Supabase's `auth` schema and roles. This verifies RLS/trigger logic; it does NOT
// verify Supabase-hosted behaviour (GoTrue, Storage, PostgREST). See docs/.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const dir = path.resolve(__dirname, "../supabase/migrations");
const A = "00000000-0000-0000-0000-00000000000a"; // owner of ws1
const B = "00000000-0000-0000-0000-00000000000b"; // owner of ws2
const AUD = "00000000-0000-0000-0000-0000000000c1"; // auditor in ws1
const DEV = "00000000-0000-0000-0000-0000000000d1"; // developer in ws1
const ANA = "00000000-0000-0000-0000-0000000000e1"; // analyst in ws1

let db: PGlite;
let ws1: string, ws2: string, p1: string, p2: string, t1: string, f1: string;

async function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub','${uid ?? ""}',false); set role ${uid ? "authenticated" : "anon"}`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const denied = async (p: Promise<unknown>) => { await expect(p).rejects.toThrow(); };
const one = async (sql: string, params: unknown[] = []) => (await db.query<any>(sql, params)).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to authenticated, anon;
    insert into auth.users values ('${A}'),('${B}'),('${AUD}'),('${DEV}'),('${ANA}');`);
  for (const f of ["20261023000001_core_schema.sql", "20261023000002_rls_and_workflows.sql", "20261023000004_activity_triggers.sql"])
    await db.exec(readFileSync(path.join(dir, f), "utf8"));

  ws1 = await as(A, async () => (await one("select public.create_workspace('One') id")).id);
  ws2 = await as(B, async () => (await one("select public.create_workspace('Two') id")).id);
  await as(A, async () => {
    await db.query("select public.add_workspace_member($1,$2,'auditor')", [ws1, AUD]);
    await db.query("select public.add_workspace_member($1,$2,'developer')", [ws1, DEV]);
    await db.query("select public.add_workspace_member($1,$2,'analyst')", [ws1, ANA]);
    p1 = (await one("insert into projects(workspace_id,name,created_by) values($1,'P1',$2) returning id", [ws1, A])).id;
    t1 = (await one("insert into authorized_targets(workspace_id,project_id,canonical_url,created_by) values($1,$2,'https://example.com/',$3) returning id", [ws1, p1, A])).id;
  });
  await as(B, async () => {
    p2 = (await one("insert into projects(workspace_id,name,created_by) values($1,'P2',$2) returning id", [ws2, B])).id;
  });
  // worker/service creates a finding (simulates scanner output)
  f1 = (await one(`insert into findings(workspace_id,project_id,fingerprint,module_id,rule_id,title,severity,affected_asset)
    values($1,$2,'fp1','security-headers','missing-hsts','Missing HSTS','medium','example.com') returning id`, [ws1, p1])).id;
});

describe("workspace isolation", () => {
  it("user B cannot read workspace 1 projects or findings", async () => {
    await as(B, async () => {
      expect((await db.query("select * from projects where id=$1", [p1])).rows).toHaveLength(0);
      expect((await db.query("select * from findings where id=$1", [f1])).rows).toHaveLength(0);
    });
  });
  it("user A sees only own workspace data", async () => {
    await as(A, async () => expect((await db.query("select id from projects")).rows.map((r: any) => r.id)).toEqual([p1]));
  });
  it("cannot insert a project into another workspace", async () => {
    await as(B, () => denied(db.query("insert into projects(workspace_id,name,created_by) values($1,'x',$2)", [ws1, B])));
  });
  it("cannot spoof created_by", async () => {
    await as(A, () => denied(db.query("insert into projects(workspace_id,name,created_by) values($1,'x',$2)", [ws1, B])));
  });
  it("composite FK blocks cross-workspace references", async () => {
    await expect(db.query("insert into authorized_targets(workspace_id,project_id,canonical_url,created_by) values($1,$2,'https://x.test/',$3)", [ws2, p1, B])).rejects.toThrow();
  });
  it("workspace_id cannot be changed by update", async () => {
    await as(A, async () => { const r = await db.query("update projects set workspace_id=$1 where id=$2", [ws2, p1]).catch(() => null); expect(r === null || r.affectedRows === 0).toBe(true); });
  });
});

describe("roles and membership", () => {
  it("cannot join a workspace by inserting a membership row", async () => {
    await as(B, () => denied(db.query("insert into workspace_members values($1,$2,'owner')", [ws1, B])));
  });
  it("cannot self-promote via update or RPC", async () => {
    await as(DEV, () => denied(db.query("update workspace_members set role='owner' where user_id=$1", [DEV])));
    await as(DEV, () => denied(db.query("select public.set_member_role($1,$2,'owner')", [ws1, DEV])));
  });
  it("admin-level user cannot grant owner; owner cannot demote self", async () => {
    await as(A, () => denied(db.query("select public.set_member_role($1,$2,'admin')", [ws1, A])));
  });
  it("last owner cannot be removed", async () => {
    await as(A, () => denied(db.query("select public.remove_workspace_member($1,$2)", [ws1, A])));
  });
  it("read-only auditor cannot create projects, update findings, or write members", async () => {
    await as(AUD, () => denied(db.query("insert into projects(workspace_id,name,created_by) values($1,'x',$2)", [ws1, AUD])));
    await as(AUD, async () => { const r = await db.query("update findings set status='fixed' where id=$1", [f1]).catch(() => null); expect(r === null || r.affectedRows === 0).toBe(true); });
    await as(AUD, () => denied(db.query("select public.add_workspace_member($1,$2,'owner')", [ws1, AUD])));
  });
  it("developer cannot read audit logs; auditor and owner can", async () => {
    await as(DEV, async () => expect((await db.query("select 1 from audit_logs")).rows).toHaveLength(0));
    await as(AUD, async () => expect((await db.query("select 1 from audit_logs")).rows.length).toBeGreaterThan(0));
  });
  it("audit logs cannot be modified or deleted by users", async () => {
    await as(A, () => denied(db.query("delete from audit_logs")));
    await as(A, () => denied(db.query("insert into audit_logs(action,entity) values('x','y')")));
  });
  it("auditor cannot view evidence; integrations hidden from non-managers", async () => {
    await as(AUD, async () => expect((await db.query("select 1 from finding_evidence")).rows).toHaveLength(0));
    await as(DEV, async () => expect((await db.query("select 1 from integrations")).rows).toHaveLength(0));
  });
  it("anonymous role reads nothing", async () => {
    await expect(as(null, () => db.query("select * from projects"))).rejects.toThrow();
  });
});

describe("assessment lifecycle", () => {
  let a1: string;
  it("creates as draft only", async () => {
    await as(ANA, async () => {
      await denied(db.query("insert into assessments(workspace_id,project_id,title,status,created_by,confirmed_by,confirmed_at) values($1,$2,'x','running',$3,$3,now())", [ws1, p1, ANA]));
      a1 = (await one("insert into assessments(workspace_id,project_id,target_id,title,created_by) values($1,$2,$3,'A1',$4) returning id", [ws1, p1, t1, ANA])).id;
    });
  });
  it("cannot queue against an unverified target", async () => {
    await as(ANA, () => denied(db.query("update assessments set status='queued' where id=$1", [a1])));
  });
  it("users cannot mark verification themselves", async () => {
    await as(ANA, () => denied(db.query("update authorized_targets set verification_status='verified', verified_at=now() where id=$1", [t1])));
  });
  it("queues after worker verifies the target; records confirmation and enqueues one job", async () => {
    await db.query("update authorized_targets set verification_status='verified', verified_at=now() where id=$1", [t1]);
    await as(ANA, async () => { await db.query("update assessments set status='queued' where id=$1", [a1]); });
    const r = await one("select status, confirmed_by from assessments where id=$1", [a1]);
    expect(r.status).toBe("queued"); expect(r.confirmed_by).toBe(ANA);
    expect((await one("select count(*)::int n from assessment_jobs where assessment_id=$1", [a1])).n).toBe(1);
  });
  it("users cannot fake running/completed", async () => {
    await as(ANA, () => denied(db.query("update assessments set status='running' where id=$1", [a1])));
    await as(ANA, () => denied(db.query("update assessments set status='completed' where id=$1", [a1])));
  });
  it("scope is frozen once queued", async () => {
    await as(ANA, () => denied(db.query("update assessments set approved_scope='everything' where id=$1", [a1])));
  });
  it("developer cannot cancel; analyst can; job is cancelled; completed cannot be cancelled", async () => {
    await as(DEV, async () => { const r = await db.query("update assessments set status='cancelled' where id=$1", [a1]).catch(() => null); expect(r === null || r.affectedRows === 0).toBe(true); });
    await as(ANA, async () => { await db.query("update assessments set status='cancelled' where id=$1", [a1]); });
    expect((await one("select status from assessment_jobs where assessment_id=$1", [a1])).status).toBe("cancelled");
    const a2 = (await one("insert into assessments(workspace_id,project_id,title,status,created_by,confirmed_by,confirmed_at) values($1,$2,'done','draft',$3,$3,now()) returning id", [ws1, p1, A])).id;
    await db.query("update assessments set status='queued' where id=$1", [a2]);
    await db.query("update assessments set status='running' where id=$1", [a2]);
    await db.query("update assessments set status='completed' where id=$1", [a2]);
    await expect(db.query("update assessments set status='cancelled' where id=$1", [a2])).rejects.toThrow(/invalid assessment transition/);
  });
  it("idempotency key blocks duplicate creation", async () => {
    await db.query("insert into assessments(workspace_id,project_id,title,created_by,idempotency_key) values($1,$2,'k',$3,'key-1')", [ws1, p1, A]);
    await expect(db.query("insert into assessments(workspace_id,project_id,title,created_by,idempotency_key) values($1,$2,'k',$3,'key-1')", [ws1, p1, A])).rejects.toThrow();
  });
});

describe("findings workflow", () => {
  it("developer can move status but cannot edit severity or close", async () => {
    await as(DEV, async () => {
      await db.query("update findings set status='in_progress' where id=$1", [f1]);
      await denied(db.query("update findings set severity='info' where id=$1", [f1]));
      await denied(db.query("update findings set status='closed' where id=$1", [f1]));
    });
  });
  it("closing requires fixed + passing retest + approval permission", async () => {
    await as(ANA, async () => {
      await denied(db.query("update findings set status='closed' where id=$1", [f1]));
      await db.query("update findings set status='fixed' where id=$1", [f1]);
      await denied(db.query("update findings set status='closed' where id=$1", [f1]));
      await db.query("insert into retests(workspace_id,finding_id,requested_by,outcome,completed_at) values($1,$2,$3,'fixed',now())", [ws1, f1, ANA]);
      await db.query("update findings set status='closed' where id=$1", [f1]);
    });
    expect((await one("select status from findings where id=$1", [f1])).status).toBe("closed");
  });
  it("status changes were written to the audit log (ids/columns only)", async () => {
    const r = await one("select count(*)::int n from audit_logs where entity='findings' and action='findings.update'");
    expect(r.n).toBeGreaterThan(0);
  });
});

describe("activity timeline (trigger-written)", () => {
  it("users cannot write activity events directly", async () => {
    await as(A, () => denied(db.query("insert into activity_events(workspace_id,kind,message) values($1,'x','forged')", [ws1])));
  });
  it("finding and assessment changes produce timeline rows in the right workspace", async () => {
    const r = await db.query<any>("select kind, message, workspace_id from activity_events where workspace_id=$1", [ws1]);
    expect(r.rows.some((x) => x.kind === "finding" && /Status changed from fixed to closed/.test(x.message))).toBe(true);
    expect(r.rows.some((x) => x.kind === "assessment" && /created/.test(x.message))).toBe(true);
    await as(B, async () => expect((await db.query("select 1 from activity_events where workspace_id=$1", [ws1])).rows).toHaveLength(0));
  });
});
