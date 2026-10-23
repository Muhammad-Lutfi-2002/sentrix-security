import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { FINDING_STATUSES, SEVERITIES } from "../app/lib/sentrix.js";
import { mapFindingSummary, ownerNames } from "../server/lib/mappers.js";
import { dbFail, requireWorkspace } from "../server/lib/scope.js";

// severity is a Postgres enum declared critical -> info, so ORDER BY severity ASC is most-severe-first.
const sortColumns = { discoveredAt: "first_seen_at", severity: "severity", title: "title", status: "status", owner: "owner_user_id" } as const;

export default defineAction({
  description: "List findings with server-side search, severity and status filters, sorting, and pagination.",
  schema: z.object({
    q: z.string().max(100).optional().describe("Search title or affected asset"),
    severity: z.array(z.enum(SEVERITIES)).optional(),
    status: z.array(z.enum(FINDING_STATUSES)).optional(),
    assessmentId: z.string().uuid().optional(),
    sort: z.enum(["discoveredAt", "severity", "title", "status", "owner"]).default("discoveredAt"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  }),
  http: { method: "GET" },
  run: async ({ q, severity, status, assessmentId, sort, direction, page, pageSize }) => {
    const s = await requireWorkspace();
    let query = s.sb.from("findings")
      .select("id,title,severity,confidence,status,verification,affected_asset,owner_user_id,first_seen_at,assessment_id,is_demo", { count: "exact" })
      .eq("workspace_id", s.workspaceId);
    if (q?.trim()) {
      const safe = q.trim().replace(/[%_\\,()*]/g, " ");
      query = query.or(`title.ilike.%${safe}%,affected_asset.ilike.%${safe}%`);
    }
    if (severity?.length) query = query.in("severity", severity);
    if (status?.length) query = query.in("status", status);
    if (assessmentId) query = query.eq("assessment_id", assessmentId);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await query
      .order(sortColumns[sort], { ascending: direction === "asc" })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) dbFail(error, "Could not load findings");
    const owners = await ownerNames(s.sb, (data ?? []).map((r) => r.owner_user_id));
    return { rows: (data ?? []).map((r) => mapFindingSummary(r, owners)), total: count ?? 0, page, pageSize };
  },
});
