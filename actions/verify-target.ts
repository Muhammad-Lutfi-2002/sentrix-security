import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { dbFail, requireWorkspace } from "../server/lib/scope.js";
import { supabaseAdmin } from "../server/lib/supabase.js";
import { checkDns, checkFile } from "../server/lib/verification.js";

const REVIEW_DAYS = 90;

export default defineAction({
  description: "Check technical proof of target ownership (DNS TXT record or a well-known file). On success the target becomes verified for 90 days.",
  schema: z.object({ targetId: z.string().uuid(), method: z.enum(["dns_txt", "http_file"]) }),
  run: async ({ targetId, method }) => {
    const s = await requireWorkspace();

    // 1) Authorize with the USER's identity before touching the privileged client.
    const { data: perm } = await s.sb.from("role_permissions").select("permission").eq("role", s.role).eq("permission", "targets.manage").maybeSingle();
    if (!perm) fail("You do not have permission to verify targets.", { statusCode: 403 });
    const { data: target, error } = await s.sb.from("authorized_targets").select("*").eq("id", targetId).eq("workspace_id", s.workspaceId).maybeSingle();
    if (error) dbFail(error);
    if (!target) fail("Target not found", { statusCode: 404 });

    // 2) Rate limit attempts (rows are only written by this action).
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await s.sb.from("target_verifications").select("id", { count: "exact", head: true }).eq("target_id", targetId).gte("created_at", since);
    if ((count ?? 0) >= 10) fail("Too many verification attempts. Try again in an hour.", { statusCode: 429 });

    // 3) Technical proof (SSRF-guarded).
    const result = method === "dns_txt" ? await checkDns(target.id, target.canonical_url) : await checkFile(target.id, target.canonical_url);

    // 4) Narrow privileged write.
    const admin = supabaseAdmin();
    await admin.from("target_verifications").insert({
      workspace_id: s.workspaceId, target_id: target.id, method, challenge_hash: "hmac-derived",
      status: result.ok ? "verified" : "failed", evidence: { detail: result.detail, by: s.userId }, checked_at: new Date().toISOString(),
    });
    if (!result.ok) return { verified: false, message: result.detail };
    const now = new Date();
    const review = new Date(now.getTime() + REVIEW_DAYS * 86_400_000);
    const { error: upErr } = await admin.from("authorized_targets")
      .update({ verification_status: "verified", verified_at: now.toISOString(), review_by: review.toISOString() })
      .eq("id", target.id).eq("workspace_id", s.workspaceId);
    if (upErr) fail("Verification succeeded but could not be saved.", { statusCode: 500 });
    await admin.from("audit_logs").insert({ workspace_id: s.workspaceId, actor_id: s.userId, action: "target.verified", entity: "authorized_targets", entity_id: target.id, details: { method } });
    return { verified: true, message: result.detail, reviewBy: review.toISOString() };
  },
});
