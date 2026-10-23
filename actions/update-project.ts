import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { mapProject } from "../server/lib/mappers.js";
import { dbFail, requireWorkspace } from "../server/lib/scope.js";

export default defineAction({
  description: "Update a project's name, description or environment, or archive/unarchive it.",
  schema: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(500).optional(),
    environment: z.enum(["production", "staging", "development"]).optional(),
    archived: z.boolean().optional().describe("true archives, false restores"),
  }),
  run: async ({ id, archived, ...rest }) => {
    const s = await requireWorkspace();
    const patch: Record<string, unknown> = { ...rest };
    if (archived !== undefined) patch.archived_at = archived ? new Date().toISOString() : null;
    const { data, error } = await s.sb.from("projects").update(patch).eq("id", id).eq("workspace_id", s.workspaceId).select().maybeSingle();
    if (error) dbFail(error, "Could not update project");
    if (!data) dbFail({ code: "PGRST116" });
    return mapProject(data);
  },
});
