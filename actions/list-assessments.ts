import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { mapAssessments } from "../server/lib/mappers.js";
import { dbFail, requireWorkspace } from "../server/lib/scope.js";

export default defineAction({
  description: "List assessments, optionally for one project. Newest first.",
  schema: z.object({ projectId: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).default(50) }),
  http: { method: "GET" },
  run: async ({ projectId, limit }) => {
    const s = await requireWorkspace();
    let q = s.sb.from("assessments").select("*").eq("workspace_id", s.workspaceId).order("created_at", { ascending: false }).limit(limit);
    if (projectId) q = q.eq("project_id", projectId);
    const { data, error } = await q;
    if (error) dbFail(error, "Could not load assessments");
    return mapAssessments(s.sb, data ?? []);
  },
});
