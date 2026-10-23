import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RawFinding } from "./modules/types.js";

export interface JobRow { id: string; workspace_id: string; assessment_id: string; attempts: number; max_attempts: number }
export interface AssessmentCtx {
  assessment: { id: string; workspace_id: string; project_id: string; status: string; title: string };
  target: { canonical_url: string; verification_status: string; review_by: string | null; excluded_paths: string[]; workspace_id: string } | null;
  modules: { module_id: string; status: string }[];
}

/** Everything the runner needs from persistence. The Supabase implementation uses the service key; tests use an in-memory fake. */
export interface WorkerStore {
  recoverStale(nowIso: string): Promise<number>;
  listClaimable(nowIso: string, limit: number): Promise<JobRow[]>;
  /** Optimistic claim: returns null when another worker won the race (duplicate delivery is harmless). */
  claim(jobId: string, workerId: string, lockMs: number): Promise<JobRow | null>;
  load(assessmentId: string): Promise<AssessmentCtx | null>;
  setAssessment(id: string, status: string): Promise<void>;
  setJob(id: string, patch: { status: string; last_error?: string | null; run_after?: string; locked_until?: string | null }): Promise<void>;
  setModule(assessmentId: string, moduleId: string, patch: { status: string; skip_reason?: string | null }): Promise<void>;
  assessmentStatus(id: string): Promise<string | null>;
  saveFinding(a: AssessmentCtx["assessment"], moduleId: string, f: RawFinding): Promise<"created" | "seen" | "reopened">;
  audit(workspaceId: string, action: string, entity: string, entityId: string, details: Record<string, unknown>): Promise<void>;
}

export const fingerprint = (moduleId: string, f: RawFinding) =>
  createHash("sha256").update([moduleId, f.ruleId, f.affectedAsset, f.location ?? ""].join("|")).digest("hex");

const cap = (o: unknown) => { const s = JSON.stringify(o) ?? "{}"; return s.length > 8000 ? { truncated: true, preview: s.slice(0, 2000) } : (o as object); };
const must = <T>(r: { data: T; error: { message: string } | null }, what: string) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

export function supabaseStore(db: SupabaseClient): WorkerStore {
  return {
    async recoverStale(nowIso) {
      const r = await db.from("assessment_jobs").update({ status: "queued", locked_by: null, locked_until: null }).in("status", ["claimed", "running"]).lt("locked_until", nowIso).select("id");
      return must(r, "recoverStale")?.length ?? 0;
    },
    async listClaimable(nowIso, limit) {
      const r = await db.from("assessment_jobs").select("id,workspace_id,assessment_id,attempts,max_attempts").eq("status", "queued").lte("run_after", nowIso).order("created_at").limit(limit);
      return must(r, "listClaimable") as JobRow[];
    },
    async claim(jobId, workerId, lockMs) {
      const cur = must(await db.from("assessment_jobs").select("attempts").eq("id", jobId).maybeSingle(), "claim.read");
      if (!cur) return null;
      const r = await db.from("assessment_jobs").update({ status: "claimed", locked_by: workerId, locked_until: new Date(Date.now() + lockMs).toISOString(), attempts: (cur as any).attempts + 1 })
        .eq("id", jobId).eq("status", "queued").select("id,workspace_id,assessment_id,attempts,max_attempts");
      return (must(r, "claim") as JobRow[])[0] ?? null;
    },
    async load(id) {
      const a = must(await db.from("assessments").select("id,workspace_id,project_id,status,title,target_id").eq("id", id).maybeSingle(), "load.assessment") as any;
      if (!a) return null;
      const t = a.target_id ? must(await db.from("authorized_targets").select("canonical_url,verification_status,review_by,excluded_paths,workspace_id").eq("id", a.target_id).maybeSingle(), "load.target") : null;
      const m = must(await db.from("assessment_modules").select("module_id,status").eq("assessment_id", id), "load.modules");
      return { assessment: { id: a.id, workspace_id: a.workspace_id, project_id: a.project_id, status: a.status, title: a.title }, target: t as any, modules: m as any };
    },
    async setAssessment(id, status) { must(await db.from("assessments").update({ status }).eq("id", id), "setAssessment"); },
    async setJob(id, patch) { must(await db.from("assessment_jobs").update(patch).eq("id", id), "setJob"); },
    async setModule(aid, mid, patch) {
      const extra = patch.status === "running" ? { started_at: new Date().toISOString() } : ["completed", "failed", "skipped"].includes(patch.status) ? { finished_at: new Date().toISOString() } : {};
      must(await db.from("assessment_modules").update({ ...patch, ...extra }).eq("assessment_id", aid).eq("module_id", mid), "setModule");
    },
    async assessmentStatus(id) { return (must(await db.from("assessments").select("status").eq("id", id).maybeSingle(), "status") as any)?.status ?? null; },
    async saveFinding(a, moduleId, f) {
      const fp = fingerprint(moduleId, f);
      const now = new Date().toISOString();
      const ex = must(await db.from("findings").select("id,status").eq("project_id", a.project_id).eq("fingerprint", fp).maybeSingle(), "finding.lookup") as any;
      if (ex) {
        const reopen = ["fixed", "closed"].includes(ex.status);
        must(await db.from("findings").update({ last_seen_at: now, assessment_id: a.id, ...(reopen ? { status: "open" } : {}) }).eq("id", ex.id), "finding.update");
        return reopen ? "reopened" : "seen";
      }
      const asset = must(await db.from("assets").upsert({ workspace_id: a.workspace_id, project_id: a.project_id, kind: f.affectedAsset.startsWith("http") ? "url" : "host", identifier: f.affectedAsset }, { onConflict: "project_id,kind,identifier" }).select("id").maybeSingle(), "asset") as any;
      const row = must(await db.from("findings").insert({
        workspace_id: a.workspace_id, project_id: a.project_id, assessment_id: a.id, asset_id: asset?.id ?? null, fingerprint: fp, module_id: moduleId, rule_id: f.ruleId,
        title: f.title, severity: f.severity, confidence: f.confidence, verification: f.verification, affected_asset: f.affectedAsset,
        description: f.description, impact: f.impact, remediation: f.remediation, reference_links: f.references,
      }).select("id").single(), "finding.insert") as any;
      if (f.evidence.length)
        must(await db.from("finding_evidence").insert(f.evidence.slice(0, 5).map((e) => ({ workspace_id: a.workspace_id, finding_id: row.id, kind: e.kind, content: cap(e.content) }))), "evidence.insert");
      return "created";
    },
    async audit(ws, action, entity, entityId, details) {
      await db.from("audit_logs").insert({ workspace_id: ws, actor_id: null, action, entity, entity_id: entityId, details });
    },
  };
}
