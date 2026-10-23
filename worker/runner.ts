// Job runner. Delivery is AT-LEAST-ONCE: a crashed worker's job is re-queued after its lock expires, so every step
// is idempotent (modules already completed are skipped; findings are upserted by fingerprint).
import { MODULES, type AssessmentModule, type ModuleContext } from "./modules/index.js";
import type { AssessmentCtx, JobRow, WorkerStore } from "./store.js";

export interface RunnerDeps {
  store: WorkerStore;
  workerId: string;
  /** Builds the guarded network context for one assessment (SSRF-checked, same-origin redirects only). */
  makeContext(a: AssessmentCtx, isCancelled: () => Promise<boolean>): Promise<ModuleContext>;
  now?: () => Date;
  moduleTimeoutMs?: number;
  lockMs?: number;
  backoffBaseMs?: number;
  /** Override the module registry (tests). */
  modules?: Record<string, AssessmentModule>;
}

const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

const safeMsg = (e: unknown) => String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 300);

export async function processNext(d: RunnerDeps): Promise<"idle" | "processed"> {
  const now = d.now ?? (() => new Date());
  await d.store.recoverStale(now().toISOString());
  const candidates = await d.store.listClaimable(now().toISOString(), 5);
  for (const c of candidates) {
    const job = await d.store.claim(c.id, d.workerId, d.lockMs ?? 10 * 60_000);
    if (!job) continue; // someone else took it
    await runJob(d, job);
    return "processed";
  }
  return "idle";
}

async function failAssessment(d: RunnerDeps, job: JobRow, a: AssessmentCtx | null, reason: string) {
  if (a && ["queued", "running"].includes(a.assessment.status)) {
    if (a.assessment.status === "queued") await d.store.setAssessment(a.assessment.id, "running"); // queued -> running -> failed is the legal path
    await d.store.setAssessment(a.assessment.id, "failed");
  }
  await d.store.setJob(job.id, { status: "failed", last_error: reason, locked_until: null });
  await d.store.audit(job.workspace_id, "assessment.failed", "assessments", job.assessment_id, { reason });
}

export async function runJob(d: RunnerDeps, job: JobRow) {
  const now = d.now ?? (() => new Date());
  let a: AssessmentCtx | null = null;
  try {
    a = await d.store.load(job.assessment_id);
    if (!a || a.assessment.workspace_id !== job.workspace_id) return d.store.setJob(job.id, { status: "failed", last_error: "assessment missing", locked_until: null });
    if (a.assessment.status === "cancelled") return d.store.setJob(job.id, { status: "cancelled", locked_until: null });
    if (!["queued", "running"].includes(a.assessment.status)) return d.store.setJob(job.id, { status: "cancelled", last_error: `assessment is ${a.assessment.status}`, locked_until: null });

    // Revalidate authorization at execution time (it may have expired or been revoked since queueing).
    const t = a.target;
    if (!t || t.workspace_id !== a.assessment.workspace_id || t.verification_status !== "verified" || (t.review_by && new Date(t.review_by) < now()))
      return failAssessment(d, job, a, "Target authorization is missing, unverified, or expired.");

    if (a.assessment.status === "queued") await d.store.setAssessment(a.assessment.id, "running");
    await d.store.setJob(job.id, { status: "running" });

    const isCancelled = async () => (await d.store.assessmentStatus(a!.assessment.id)) === "cancelled";
    let ctx: ModuleContext;
    try { ctx = await d.makeContext(a, isCancelled); }
    catch (e) { return failAssessment(d, job, a, `Target rejected: ${safeMsg(e)}`); }

    const summary: Record<string, string> = {};
    let created = 0, seen = 0, reopened = 0;
    for (const m of a.modules) {
      if (m.status === "completed" || m.status === "skipped" || m.status === "failed") { summary[m.module_id] = m.status; continue; } // resumed job
      if (await isCancelled()) {
        await d.store.setModule(a.assessment.id, m.module_id, { status: "skipped", skip_reason: "cancelled" });
        summary[m.module_id] = "cancelled"; continue;
      }
      const impl = (d.modules ?? MODULES)[m.module_id];
      if (!impl) { await d.store.setModule(a.assessment.id, m.module_id, { status: "skipped", skip_reason: "module not implemented" }); summary[m.module_id] = "skipped"; continue; }
      await d.store.setModule(a.assessment.id, m.module_id, { status: "running" });
      try {
        const res = await withTimeout(impl.run(ctx), d.moduleTimeoutMs ?? 60_000, m.module_id);
        if (res.skippedReason) { await d.store.setModule(a.assessment.id, m.module_id, { status: "skipped", skip_reason: res.skippedReason }); summary[m.module_id] = "skipped"; continue; }
        for (const f of res.findings) {
          const r = await d.store.saveFinding(a.assessment, m.module_id, f);
          if (r === "created") created++; else if (r === "reopened") reopened++; else seen++;
        }
        await d.store.setModule(a.assessment.id, m.module_id, { status: "completed" });
        summary[m.module_id] = "completed";
      } catch (e) {
        await d.store.setModule(a.assessment.id, m.module_id, { status: "failed", skip_reason: safeMsg(e) });
        summary[m.module_id] = "failed"; // partial results from other modules are kept
      }
    }

    if (await isCancelled()) {
      await d.store.setJob(job.id, { status: "cancelled", locked_until: null });
      await d.store.audit(job.workspace_id, "assessment.cancelled_during_run", "assessments", a.assessment.id, { summary });
      return;
    }
    const vals = Object.values(summary);
    const status = vals.every((v) => v === "completed") ? "completed" : vals.some((v) => v === "completed") ? "completed_with_warnings" : "failed";
    await d.store.setAssessment(a.assessment.id, status);
    await d.store.setJob(job.id, { status: status === "failed" ? "failed" : "succeeded", locked_until: null, last_error: status === "failed" ? "no module completed" : null });
    await d.store.audit(job.workspace_id, "assessment.executed", "assessments", a.assessment.id, { status, summary, findings: { created, seen, reopened } });
  } catch (e) {
    // Unexpected failure (e.g. transient database error): retry with backoff until the limit, then fail.
    const msg = safeMsg(e);
    if (job.attempts < job.max_attempts) {
      const delay = (d.backoffBaseMs ?? 30_000) * 2 ** (job.attempts - 1);
      await d.store.setJob(job.id, { status: "queued", last_error: msg, run_after: new Date(now().getTime() + delay).toISOString(), locked_until: null }).catch(() => {});
    } else {
      await failAssessment(d, job, a, `Gave up after ${job.attempts} attempts: ${msg}`).catch(() => {});
    }
  }
}
