import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { mapActivity } from "../server/lib/mappers.js";
import { dbFail, requireWorkspace } from "../server/lib/scope.js";

export default defineAction({
  description: "List the most recent activity events in the current workspace.",
  schema: z.object({ limit: z.number().int().min(1).max(100).default(20).describe("Max rows") }),
  http: { method: "GET" },
  run: async ({ limit }) => {
    const s = await requireWorkspace();
    const { data, error } = await s.sb.from("activity_events").select("*").eq("workspace_id", s.workspaceId).order("created_at", { ascending: false }).limit(limit);
    if (error) dbFail(error, "Could not load activity");
    return (data ?? []).map(mapActivity);
  },
});
