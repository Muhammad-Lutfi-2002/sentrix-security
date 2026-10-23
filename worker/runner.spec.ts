import { describe, expect, it } from "vitest";
import type { AssessmentModule, RawFinding } from "./modules/types";
import { processNext, runJob, type RunnerDeps } from "./runner";
import type { AssessmentCtx, JobRow, WorkerStore } from "./store";

const finding = (ruleId: string): RawFinding => ({ ruleId, title: ruleId, severity: "low", confidence: "high", verification: "confirmed", affectedAsset: "https://x.test", description: "", impact: "", remediation: "", references: [], evidence: [] });

function fake(opts: { status?: string; modules?: string[]; target?: Partial<NonNullable<AssessmentCtx["target"]>> | null; failStore?: () => boolean } = {}) {
  const log: string[] = [];
  const st = {
    assessment: { id: "a1", workspace_id: "w1", project_id: "p1", status: opts.status ?? "queued", title: "t" },
    modules: (opts.modules ?? ["m1", "m2"]).map((id) => ({ module_id: id, status: "pending" })),
    job: { id: "j1", workspace_id: "w1", assessment_id: "a1", attempts: 0, max_attempts: 3, status: "queued", run_after: "1970-01-01T00:00:00Z", locked_until: null as string | null, last_error: null as string | null },
    findings: new Map<string, string>(),
  };
  const target = opts.target === null ? null : { canonical_url: "https://x.test/", verification_status: "verified", review_by: null, excluded_paths: [], workspace_id: "w1", ...opts.target };
  const store: WorkerStore = {
    async recoverStale(now) { if (["claimed", "running"].includes(st.job.status) && st.job.locked_until && st.job.locked_until < now) { st.job.status = "queued"; return 1; } return 0; },
    async listClaimable(now) { return st.job.status === "queued" && st.job.run_after <= now ? [{ ...st.job }] : []; },
    async claim(_id, _w, lockMs) { if (st.job.status !== "queued") return null; st.job.status = "claimed"; st.job.attempts++; st.job.locked_until = new Date(Date.now() + lockMs).toISOString(); return { ...st.job } as JobRow; },
    async load() { if (opts.failStore?.()) throw new Error("db unavailable"); return { assessment: { ...st.assessment }, target: target as any, modules: st.modules.map((m) => ({ ...m })) }; },
    async setAssessment(_id, s) { log.push(`assessment:${st.assessment.status}->${s}`); st.assessment.status = s; },
    async setJob(_id, p) { Object.assign(st.job, p); },
    async setModule(_a, id, p) { const m = st.modules.find((x) => x.module_id === id)!; m.status = p.status; },
    async assessmentStatus() { return st.assessment.status; },
    async saveFinding(_a, mod, f) { const k = mod + f.ruleId; const had = st.findings.has(k); st.findings.set(k, f.title); return had ? "seen" : "created"; },
    async audit(_w, action) { log.push(`audit:${action}`); },
  };
  return { st, store, log };
}
const ok = (id: string, rules: string[]): AssessmentModule => ({ id, kind: "passive", run: async () => ({ findings: rules.map(finding) }) });
const bad = (id: string): AssessmentModule => ({ id, kind: "passive", run: async () => { throw new Error("boom"); } });
const deps = (store: WorkerStore, modules: Record<string, AssessmentModule>, extra: Partial<RunnerDeps> = {}): RunnerDeps => ({
  store, workerId: "w", modules, makeContext: async () => ({} as any), moduleTimeoutMs: 200, backoffBaseMs: 1000, ...extra,
});

describe("runner", () => {
  it("completes, persists findings, audits", async () => {
    const { st, store, log } = fake();
    expect(await processNext(deps(store, { m1: ok("m1", ["a"]), m2: ok("m2", ["b", "c"]) }))).toBe("processed");
    expect(st.assessment.status).toBe("completed"); expect(st.job.status).toBe("succeeded"); expect(st.findings.size).toBe(3);
    expect(log).toContain("audit:assessment.executed");
  });
  it("is idle when nothing is queued", async () => {
    const { store, st } = fake(); st.job.status = "succeeded";
    expect(await processNext(deps(store, {}))).toBe("idle");
  });
  it("duplicate delivery: only one of two concurrent workers runs the job", async () => {
    const { st, store } = fake();
    const mods = { m1: ok("m1", ["a"]), m2: ok("m2", ["b"]) };
    const r = await Promise.all([processNext(deps(store, mods)), processNext(deps(store, mods))]);
    expect(r.sort()).toEqual(["idle", "processed"]); expect(st.job.attempts).toBe(1);
  });
  it("one failing module yields completed_with_warnings and keeps the other module's findings", async () => {
    const { st, store } = fake();
    await processNext(deps(store, { m1: bad("m1"), m2: ok("m2", ["b"]) }));
    expect(st.assessment.status).toBe("completed_with_warnings"); expect(st.findings.size).toBe(1);
  });
  it("all modules failing marks the assessment failed (no fake success)", async () => {
    const { st, store } = fake();
    await processNext(deps(store, { m1: bad("m1"), m2: bad("m2") }));
    expect(st.assessment.status).toBe("failed"); expect(st.job.status).toBe("failed");
  });
  it("a skipped module is a warning, not success", async () => {
    const { st, store } = fake();
    await processNext(deps(store, { m1: ok("m1", []), m2: { id: "m2", kind: "passive", run: async () => ({ findings: [], skippedReason: "not https" }) } }));
    expect(st.assessment.status).toBe("completed_with_warnings");
  });
  it("module timeout is a module failure", async () => {
    const { st, store } = fake({ modules: ["m1"] });
    await processNext(deps(store, { m1: { id: "m1", kind: "passive", run: () => new Promise(() => {}) } }, { moduleTimeoutMs: 50 }));
    expect(st.assessment.status).toBe("failed");
  });
  it("cancellation stops further modules and never overwrites 'cancelled'", async () => {
    const { st, store } = fake();
    const m1: AssessmentModule = { id: "m1", kind: "passive", run: async () => { st.assessment.status = "cancelled"; return { findings: [finding("a")] }; } };
    await processNext(deps(store, { m1, m2: ok("m2", ["b"]) }));
    expect(st.assessment.status).toBe("cancelled"); expect(st.job.status).toBe("cancelled");
    expect(st.modules.find((m) => m.module_id === "m2")!.status).toBe("skipped"); expect(st.findings.size).toBe(1);
  });
  it("already-cancelled assessment is not started", async () => {
    const { st, store } = fake({ status: "cancelled" });
    await processNext(deps(store, { m1: ok("m1", ["a"]), m2: ok("m2", []) }));
    expect(st.job.status).toBe("cancelled"); expect(st.findings.size).toBe(0);
  });
  it("revalidates authorization: unverified, expired, or missing target fails without running modules", async () => {
    for (const target of [{ verification_status: "pending" }, { review_by: "2000-01-01T00:00:00Z" }, null] as const) {
      const { st, store } = fake({ target: target as any });
      await processNext(deps(store, { m1: ok("m1", ["a"]), m2: ok("m2", []) }));
      expect(st.assessment.status).toBe("failed"); expect(st.findings.size).toBe(0);
    }
  });
  it("target rejected by the network guard fails the assessment", async () => {
    const { st, store } = fake();
    await processNext(deps(store, { m1: ok("m1", ["a"]), m2: ok("m2", []) }, { makeContext: async () => { throw new Error("resolves to a private address"); } }));
    expect(st.assessment.status).toBe("failed"); expect(st.job.last_error).toMatch(/private/);
  });
  it("transient store failure re-queues with exponential backoff, then fails at the retry limit", async () => {
    const { st, store } = fake({ failStore: () => true });
    const now = new Date("2026-01-01T00:00:00Z");
    await processNext(deps(store, {}, { now: () => now }));
    expect(st.job.status).toBe("queued"); expect(new Date(st.job.run_after).getTime() - now.getTime()).toBe(1000);
    st.job.attempts = 2; st.job.status = "claimed";
    await runJob(deps(store, {}, { now: () => now }), { ...st.job } as JobRow);
    expect(new Date(st.job.run_after).getTime() - now.getTime()).toBe(2000);
    st.job.attempts = 3;
    await runJob(deps(store, {}, { now: () => now }), { ...st.job } as JobRow);
    expect(st.job.status).toBe("failed");
  });
  it("stale locked jobs are recovered and resumed without redoing completed modules", async () => {
    const { st, store } = fake({ status: "running" });
    st.modules[0].status = "completed";
    st.job.status = "running"; st.job.locked_until = "2000-01-01T00:00:00Z";
    let m1Runs = 0;
    await processNext(deps(store, { m1: { id: "m1", kind: "passive", run: async () => { m1Runs++; return { findings: [] }; } }, m2: ok("m2", ["b"]) }));
    expect(m1Runs).toBe(0); expect(st.assessment.status).toBe("completed");
  });
  it("re-running the same findings is idempotent (seen, not duplicated)", async () => {
    const { st, store } = fake({ modules: ["m1"] });
    await processNext(deps(store, { m1: ok("m1", ["a"]) }));
    st.assessment.status = "queued"; st.modules[0].status = "pending"; st.job.status = "queued";
    await processNext(deps(store, { m1: ok("m1", ["a"]) }));
    expect(st.findings.size).toBe(1);
  });
});
