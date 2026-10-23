import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dbFail, requireWorkspace } from "../server/lib/scope.js";
import { instructions } from "../server/lib/verification.js";

export default defineAction({
  description: "List registered targets for a project with their verification status and, for unverified ones, ownership-proof instructions.",
  schema: z.object({ projectId: z.string().uuid() }),
  http: { method: "GET" },
  run: async ({ projectId }) => {
    const s = await requireWorkspace();
    const { data, error } = await s.sb.from("authorized_targets").select("*").eq("workspace_id", s.workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(100);
    if (error) dbFail(error, "Could not load targets");
    return (data ?? []).map((t) => {
      const expired = t.verification_status === "verified" && t.review_by && new Date(t.review_by) < new Date();
      const status = expired ? "expired" : t.verification_status;
      return {
        id: t.id, canonicalUrl: t.canonical_url, environment: t.environment, verificationStatus: status,
        verifiedAt: t.verified_at, reviewBy: t.review_by, approvedScope: t.approved_scope, excludedPaths: t.excluded_paths,
        verification: status === "verified" ? null : instructions(t.id, t.canonical_url),
      };
    });
  },
});
