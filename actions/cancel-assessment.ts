import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { dbFail, requireWorkspace } from "../server/lib/scope.js";

export default defineAction({
  description: "Cancel a draft, queued or running assessment. The database validates the transition and the caller's permission.",
  schema: z.object({ id: z.string().uuid() }),
  run: async ({ id }) => {
    const s = await requireWorkspace();
    const { data: cur } = await s.sb.from("assessments").select("status").eq("id", id).eq("workspace_id", s.workspaceId).maybeSingle();
    if (!cur) fail("Assessment not found", { statusCode: 404 });
    if (!["draft", "queued", "running"].includes(cur.status)) fail(`Assessment is ${cur.status} and cannot be cancelled`, { statusCode: 409 });
    const { data, error } = await s.sb.from("assessments").update({ status: "cancelled" }).eq("id", id).eq("workspace_id", s.workspaceId).select("id,status,finished_at").maybeSingle();
    if (error) dbFail(error, "Could not cancel assessment");
    if (!data) dbFail({ code: "42501", message: "You are not allowed to cancel this assessment." });
    return data;
  },
});
