// Map snake_case DB rows to the camelCase shapes the existing SENTRIX UI already consumes.
import type { UserClient } from "./scope.js";

type Row = Record<string, any>;

export const mapProject = (r: Row) => ({
  id: r.id, name: r.name, description: r.description, environment: r.environment,
  archivedAt: r.archived_at ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
});

export const mapFindingSummary = (r: Row, owners: Map<string, string>) => ({
  id: r.id, title: r.title, severity: r.severity, confidence: r.confidence, status: r.status,
  verification: r.verification, affectedAsset: r.affected_asset,
  owner: r.owner_user_id ? (owners.get(r.owner_user_id) ?? "Assigned") : "",
  discoveredAt: r.first_seen_at, assessmentId: r.assessment_id, isDemo: r.is_demo,
});

export const mapFindingDetail = (r: Row, owners: Map<string, string>, evidence: string) => ({
  ...mapFindingSummary(r, owners),
  projectId: r.project_id, description: r.description, impact: r.impact, remediation: r.remediation,
  referenceLinks: ((r.reference_links ?? []) as string[]).join("\n"), evidence,
  cvssVector: r.cvss_vector ?? null, cvssScore: r.cvss_score ?? null,
  updatedAt: r.updated_at, lastSeenAt: r.last_seen_at,
});

export const mapActivity = (r: Row) => ({
  id: r.id, kind: r.kind, message: r.message, assessmentId: r.assessment_id, findingId: r.finding_id, createdAt: r.created_at,
});

export async function ownerNames(sb: UserClient, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await sb.from("profiles").select("id, display_name").in("id", unique);
  for (const p of data ?? []) map.set(p.id, p.display_name || "Team member");
  return map;
}

/** Attach target URL + module list to assessment rows (two bounded IN queries, no unbounded fetches). */
export async function mapAssessments(sb: UserClient, rows: Row[]) {
  if (!rows.length) return [];
  const targetIds = [...new Set(rows.map((r) => r.target_id).filter(Boolean))];
  const ids = rows.map((r) => r.id);
  const [{ data: targets }, { data: mods }] = await Promise.all([
    targetIds.length ? sb.from("authorized_targets").select("id, canonical_url, verification_status").in("id", targetIds) : Promise.resolve({ data: [] as Row[] }),
    sb.from("assessment_modules").select("assessment_id, module_id, status, skip_reason").in("assessment_id", ids),
  ]);
  const tmap = new Map((targets ?? []).map((t: Row) => [t.id, t]));
  return rows.map((r) => {
    const t = r.target_id ? tmap.get(r.target_id) : undefined;
    const m = (mods ?? []).filter((x: Row) => x.assessment_id === r.id);
    return {
      id: r.id, projectId: r.project_id, targetId: r.target_id, title: r.title,
      targetUrl: t?.canonical_url ?? "", targetVerified: t?.verification_status === "verified",
      targetAttested: Boolean(r.confirmed_by), approvedScope: r.approved_scope,
      modules: m.map((x: Row) => x.module_id).join(","), moduleResults: m.map((x: Row) => ({ id: x.module_id, status: x.status, skipReason: x.skip_reason ?? null })),
      mode: r.mode, status: r.status,
      createdAt: r.created_at, updatedAt: r.updated_at,
      startedAt: r.started_at ?? null, finishedAt: r.finished_at ?? null,
      cancelledAt: r.status === "cancelled" ? r.finished_at : null,
    };
  });
}
