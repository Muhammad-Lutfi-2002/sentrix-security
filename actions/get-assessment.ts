import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { mapActivity, mapAssessments, mapFindingSummary, mapProject, ownerNames } from "../server/lib/mappers.js";
import { dbFail, requireWorkspace } from "../server/lib/scope.js";

export default defineAction({
  description: "Get one assessment with its project, findings, module results, and activity history.",
  schema: z.object({ id: z.string().uuid() }),
  http: { method: "GET" },
  run: async ({ id }) => {
    const s = await requireWorkspace();
    const { data: a, error } = await s.sb.from("assessments").select("*").eq("id", id).eq("workspace_id", s.workspaceId).maybeSingle();
    if (error) dbFail(error, "Could not load assessment");
    if (!a) dbFail({ code: "PGRST116" });
    const [{ data: project }, { data: findings }, { data: history }] = await Promise.all([
      s.sb.from("projects").select("*").eq("id", a.project_id).maybeSingle(),
      s.sb.from("findings").select("id,title,severity,confidence,status,verification,affected_asset,owner_user_id,first_seen_at,assessment_id,is_demo").eq("assessment_id", id).limit(500),
      s.sb.from("activity_events").select("*").eq("assessment_id", id).order("created_at", { ascending: false }).limit(100),
    ]);
    const owners = await ownerNames(s.sb, (findings ?? []).map((f) => f.owner_user_id));
    return {
      assessment: (await mapAssessments(s.sb, [a]))[0],
      project: project ? mapProject(project) : null,
      findings: (findings ?? []).map((f) => mapFindingSummary(f, owners)),
      history: (history ?? []).map(mapActivity),
    };
  },
});
