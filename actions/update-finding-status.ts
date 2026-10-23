import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { FINDING_STATUSES } from "../app/lib/sentrix.js";
import { dbFail, requireWorkspace } from "../server/lib/scope.js";

export default defineAction({
  description: "Change a finding's status. Database rules enforce who may approve/close and require a passing retest before closing.",
  schema: z.object({ id: z.string().uuid(), status: z.enum(FINDING_STATUSES) }),
  run: async ({ id, status }) => {
    const s = await requireWorkspace();
    const { data, error } = await s.sb.from("findings").update({ status }).eq("id", id).eq("workspace_id", s.workspaceId).select("id,status").maybeSingle();
    if (error) dbFail(error, "Could not update finding");
    if (!data) dbFail({ code: "42501", message: "Finding not found or you are not allowed to update it." });
    return data;
  },
});
