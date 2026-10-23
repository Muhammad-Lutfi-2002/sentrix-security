// Assessment module interface. A module receives a guarded execution context (no raw network access),
// returns normalized findings, and must never fabricate: report only what was observed.
import type { SafeResponse, TlsInfo } from "../../server/lib/safe-fetch.js";

export type Sev = "critical" | "high" | "medium" | "low" | "info";

export interface EvidenceItem {
  kind: "http_exchange" | "header" | "certificate" | "code_snippet" | "file";
  /** Already bounded and redacted: never include cookie values, tokens or response bodies. */
  content: Record<string, unknown>;
}

export interface RawFinding {
  ruleId: string;
  title: string;
  severity: Sev;
  confidence: "high" | "medium" | "low";
  /** confirmed = directly observed fact; unverified_observation = heuristic that needs human review. */
  verification: "confirmed" | "unverified_observation";
  affectedAsset: string;
  /** Disambiguates the same rule firing in different places (e.g. cookie name). */
  location?: string;
  description: string;
  impact: string;
  remediation: string;
  references: string[];
  evidence: EvidenceItem[];
}

export interface ModuleContext {
  target: URL;
  /** Guarded GET that follows only same-origin redirects and re-validates every hop. */
  get(path?: string): Promise<SafeResponse>;
  tls(host: string, port: number): Promise<TlsInfo>;
  isCancelled(): Promise<boolean>;
}

export interface ModuleResult {
  findings: RawFinding[];
  /** Set when the module could not run to completion (reported as a warning, never as success). */
  skippedReason?: string;
}

export interface AssessmentModule {
  id: string;
  kind: "passive" | "active";
  run(ctx: ModuleContext): Promise<ModuleResult>;
}
