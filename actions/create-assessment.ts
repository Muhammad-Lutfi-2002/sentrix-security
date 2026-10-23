import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { ASSESSMENT_MODULES } from "../app/lib/sentrix.js";
import { mapAssessments } from "../server/lib/mappers.js";
import { dbFail, requireWorkspace } from "../server/lib/scope.js";

const available = ASSESSMENT_MODULES.filter((m) => m.available).map((m) => m.id) as [string, ...string[]];

export default defineAction({
  description:
    "Create and queue an assessment against a VERIFIED target. Only implemented passive modules can be selected. Retried requests with the same idempotency key return the original assessment.",
  schema: z.object({
    projectId: z.string().uuid(),
    targetId: z.string().uuid().describe("A registered and verified target"),
    title: z.string().trim().min(1).max(160),
    approvedScope: z.string().trim().min(1).max(1000),
    modules: z.array(z.enum(available)).min(1).max(10),
    idempotencyKey: z.string().min(8).max(80).describe("Client-generated per submission; makes retries safe"),
    explicitConfirmation: z.literal(true).describe("Final explicit confirmation"),
  }),
  run: async ({ projectId, targetId, title, approvedScope, modules, idempotencyKey, explicitConfirmation: _c }) => {
    const s = await requireWorkspace();
    const sb = s.sb;

    const { data: target } = await sb.from("authorized_targets").select("id,project_id,verification_status,review_by").eq("id", targetId).eq("workspace_id", s.workspaceId).maybeSingle();
    if (!target || target.project_id !== projectId) fail("Target not found in this project", { statusCode: 404 });
    const expired = target.review_by && new Date(target.review_by) < new Date();
    if (target.verification_status !== "verified" || expired)
      fail("This target is not verified (or its verification expired). Verify ownership before starting an assessment.", { statusCode: 409, errorCode: "target_unverified" });

    const { data: created, error } = await sb.from("assessments")
      .insert({ workspace_id: s.workspaceId, project_id: projectId, target_id: targetId, title, approved_scope: approvedScope, mode: "passive", idempotency_key: idempotencyKey, created_by: s.userId })
      .select().single();
    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await sb.from("assessments").select("*").eq("workspace_id", s.workspaceId).eq("idempotency_key", idempotencyKey).maybeSingle();
        if (existing) return (await mapAssessments(sb, [existing]))[0];
      }
      dbFail(error, "Could not create assessment");
    }

    const mods = modules.map((id) => ({ workspace_id: s.workspaceId, assessment_id: created.id, module_id: id, kind: "passive" }));
    const { error: mErr } = await sb.from("assessment_modules").insert(mods);
    if (!mErr) {
      const { data: queued, error: qErr } = await sb.from("assessments").update({ status: "queued" }).eq("id", created.id).select().single();
      if (!qErr) return (await mapAssessments(sb, [queued]))[0];
      await sb.from("assessments").update({ status: "cancelled" }).eq("id", created.id); // no zombie drafts
      dbFail(qErr, "Could not queue assessment");
    }
    await sb.from("assessments").update({ status: "cancelled" }).eq("id", created.id);
    dbFail(mErr, "Could not save assessment modules");
  },
});
