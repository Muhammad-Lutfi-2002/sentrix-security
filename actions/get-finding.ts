import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { mapActivity, mapAssessments, mapFindingDetail, ownerNames } from "../server/lib/mappers.js";
import { dbFail, requireWorkspace } from "../server/lib/scope.js";

export default defineAction({
  description: "Get one finding with its detail, activity timeline, and related assessment.",
  schema: z.object({ id: z.string().uuid().describe("Finding id") }),
  http: { method: "GET" },
  run: async ({ id }) => {
    const s = await requireWorkspace();
    // workspace_id filter is defense in depth; RLS already scopes the row.
    const { data: f, error } = await s.sb.from("findings").select("*").eq("id", id).eq("workspace_id", s.workspaceId).maybeSingle();
    if (error) dbFail(error, "Could not load finding");
    if (!f) dbFail({ code: "PGRST116" });
    const [{ data: ev }, { data: tl }, owners] = await Promise.all([
      s.sb.from("finding_evidence").select("kind,content,created_at").eq("finding_id", id).order("created_at").limit(20),
      s.sb.from("activity_events").select("*").eq("finding_id", id).order("created_at", { ascending: false }).limit(50),
      ownerNames(s.sb, [f.owner_user_id]),
    ]);
    const evidence = ev?.length
      ? ev.map((e) => `[${e.kind}] ${JSON.stringify(e.content, null, 2)}`).join("\n\n")
      : "No evidence is visible for your role, or none was captured.";
    let assessment = null;
    if (f.assessment_id) {
      const { data: a } = await s.sb.from("assessments").select("*").eq("id", f.assessment_id).maybeSingle();
      assessment = a ? (await mapAssessments(s.sb, [a]))[0] : null;
    }
    return { finding: mapFindingDetail(f, owners, evidence), timeline: (tl ?? []).map(mapActivity), assessment };
  },
});
