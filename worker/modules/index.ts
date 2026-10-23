import { cookieSecurity } from "./cookie-security.js";
import { securityHeaders } from "./security-headers.js";
import { tlsConfig } from "./tls-config.js";
import type { AssessmentModule } from "./types.js";

export const MODULES: Record<string, AssessmentModule> = {
  [securityHeaders.id]: securityHeaders,
  [tlsConfig.id]: tlsConfig,
  [cookieSecurity.id]: cookieSecurity,
};
export type { AssessmentModule, ModuleContext, ModuleResult, RawFinding } from "./types.js";
