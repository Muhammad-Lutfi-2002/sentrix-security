import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { mapProject } from "../server/lib/mappers.js";
import { dbFail, requireWorkspace } from "../server/lib/scope.js";

export default defineAction({
  description: "List security assessment projects in the current workspace, newest first.",
  schema: z.object({
    q: z.string().max(100).optional().describe("Search by name"),
    includeArchived: z.boolean().default(false),
  }),
  http: { method: "GET" },
  run: async ({ q, includeArchived }) => {
    const s = await requireWorkspace();
    let query = s.sb.from("projects").select("*").eq("workspace_id", s.workspaceId).order("created_at", { ascending: false }).limit(200);
    if (!includeArchived) query = query.is("archived_at", null);
    if (q?.trim()) query = query.ilike("name", `%${q.trim().replace(/[%_\\,()]/g, " ")}%`);
    const { data, error } = await query;
    if (error) dbFail(error, "Could not load projects");
    return (data ?? []).map(mapProject);
  },
});
