export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const FINDING_STATUSES = [
  "open",
  "in_progress",
  "needs_review",
  "false_positive",
  "accepted_risk",
  "fixed",
  "retest_required",
  "closed",
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const ASSESSMENT_STATUSES = [
  "draft",
  "queued",
  "running",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

/**
 * `available: true` means a real implementation exists in worker/modules. Others are shown
 * as "not available yet" and cannot be selected or queued - we never run fake checks.
 */
export const ASSESSMENT_MODULES = [
  {
    id: "security-headers",
    label: "Security headers",
    kind: "passive",
    available: true,
    description: "Reviews HSTS, CSP, framing, content-type, referrer and permissions headers on one GET request.",
  },
  {
    id: "tls-config",
    label: "TLS and certificate",
    kind: "passive",
    available: true,
    description: "Checks certificate validity, expiry, hostname match and negotiated protocol during a TLS handshake.",
  },
  {
    id: "cookie-security",
    label: "Cookie security",
    kind: "passive",
    available: true,
    description: "Reviews Secure, HttpOnly and SameSite attributes of cookies set by one GET request.",
  },
  {
    id: "dependency-analysis",
    label: "Dependency analysis",
    kind: "passive",
    available: false,
    description: "Static analysis of dependency manifests. Not available yet.",
  },
  {
    id: "static-analysis",
    label: "Static source analysis",
    kind: "passive",
    available: false,
    description: "Source scanning in an isolated worker. Not available yet.",
  },
  {
    id: "access-control",
    label: "Access control probes",
    kind: "active",
    available: false,
    description: "Authorization testing with dedicated test accounts. Not available yet.",
  },
] as const;

export function assessmentKind(modules: string[]) {
  return modules.some(
    (id) => ASSESSMENT_MODULES.find((m) => m.id === id)?.kind === "active",
  )
    ? "active"
    : "passive";
}

export function assessmentModuleList(modules: string | string[]) {
  const list = Array.isArray(modules) ? modules : modules.split(",");
  return list.map((id) => id.trim()).filter(Boolean);
}
