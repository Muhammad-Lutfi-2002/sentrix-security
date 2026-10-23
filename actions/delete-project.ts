import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dbFail, requireWorkspace } from "../server/lib/scope.js";

export default defineAction({
  description: "Permanently delete a project (owner/admin only). Projects that still have assessments cannot be deleted; archive them instead.",
  schema: z.object({ id: z.string().uuid() }),
  run: async ({ id }) => {
    const s = await requireWorkspace();
    const { data, error } = await s.sb.from("projects").delete().eq("id", id).eq("workspace_id", s.workspaceId).select("id");
    if (error) dbFail(error.code === "23503" ? { code: "23514", message: "This project has assessments. Archive it instead." } : error, "Could not delete project");
    if (!data?.length) dbFail({ code: "42501", message: "Project not found or you are not allowed to delete it." });
    return { id, deleted: true };
  },
});
