import { defineAction } from "@agent-native/core/action";

import { mapActivity, mapAssessments, mapFindingSummary, ownerNames } from "../server/lib/mappers.js";
import { dbFail, requireWorkspace } from "../server/lib/scope.js";

const WEEKS = 8;
const OPEN = ["open", "in_progress", "needs_review", "retest_required"];
const RESOLVED = ["fixed", "closed", "accepted_risk"];

function weekStart(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

export default defineAction({
  description: "Summarize security posture from persisted data using server-side counts (no full-table fetches).",
  http: { method: "GET" },
  run: async () => {
    const s = await requireWorkspace();
    const ws = s.workspaceId;
    const head = { count: "exact" as const, head: true };
    const since = new Date(); since.setUTCDate(since.getUTCDate() - WEEKS * 7);
    const q = await Promise.all([
      s.sb.from("projects").select("id", head).eq("workspace_id", ws).is("archived_at", null),
      s.sb.from("assessments").select("id", head).eq("workspace_id", ws).in("status", ["queued", "running"]),
      s.sb.from("findings").select("id", head).eq("workspace_id", ws).eq("severity", "critical").in("status", OPEN),
      s.sb.from("findings").select("id", head).eq("workspace_id", ws).eq("severity", "high").in("status", OPEN),
      s.sb.from("findings").select("id", head).eq("workspace_id", ws).in("status", RESOLVED),
      s.sb.from("findings").select("id", head).eq("workspace_id", ws).neq("status", "false_positive"),
      s.sb.from("assessments").select("*").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(5),
      s.sb.from("findings").select("id,title,severity,confidence,status,verification,affected_asset,owner_user_id,first_seen_at,assessment_id,is_demo").eq("workspace_id", ws).order("first_seen_at", { ascending: false }).limit(5),
      s.sb.from("activity_events").select("*").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(8),
      // Bounded trend window: 3 narrow columns, last 8 weeks, hard cap. (A SQL aggregate RPC is the planned replacement.)
      s.sb.from("findings").select("first_seen_at,severity,status").eq("workspace_id", ws).gte("first_seen_at", since.toISOString()).limit(5000),
    ]);
    const failed = q.find((r) => r.error);
    if (failed?.error) dbFail(failed.error, "Could not load dashboard");
    const [projects, active, crit, high, resolved, total, recentA, latestF, activity, trendRows] = q;

    const weeks = Array.from({ length: WEEKS }, (_, i) => {
      const d = new Date(); d.setUTCDate(d.getUTCDate() - (WEEKS - 1 - i) * 7); return weekStart(d);
    });
    const trend = weeks.map((week) => {
      const inWeek = (trendRows.data ?? []).filter((f) => weekStart(new Date(f.first_seen_at)) === week);
      return {
        week, discovered: inWeek.length,
        openCritical: inWeek.filter((f) => f.severity === "critical" && OPEN.includes(f.status)).length,
        openHigh: inWeek.filter((f) => f.severity === "high" && OPEN.includes(f.status)).length,
      };
    });
    const owners = await ownerNames(s.sb, (latestF.data ?? []).map((r) => r.owner_user_id));
    return {
      totalProjects: projects.count ?? 0,
      activeAssessments: active.count ?? 0,
      openCritical: crit.count ?? 0,
      openHigh: high.count ?? 0,
      remediation: { resolved: resolved.count ?? 0, total: total.count ?? 0 },
      trend,
      recentAssessments: await mapAssessments(s.sb, recentA.data ?? []),
      latestFindings: (latestF.data ?? []).map((r) => mapFindingSummary(r, owners)),
      activity: (activity.data ?? []).map(mapActivity),
    };
  },
});
