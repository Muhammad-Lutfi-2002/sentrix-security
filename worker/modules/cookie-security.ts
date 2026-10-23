import type { SafeResponse } from "../../server/lib/safe-fetch.js";
import type { AssessmentModule, RawFinding } from "./types.js";

const SESSION_LIKE = /(sess|sid|auth|token|jwt|login|csrf|xsrf)/i;
const REF = "https://developer.mozilla.org/docs/Web/HTTP/Cookies#security";

export interface ParsedCookie { name: string; attrs: Record<string, string | true> }

export function parseSetCookie(line: string): ParsedCookie | null {
  const [pair, ...rest] = line.split(";");
  const eq = pair.indexOf("=");
  if (eq < 1) return null;
  const attrs: Record<string, string | true> = {};
  for (const part of rest) {
    const [k, ...v] = part.trim().split("=");
    if (k) attrs[k.toLowerCase()] = v.length ? v.join("=") : true;
  }
  return { name: pair.slice(0, eq).trim(), attrs }; // value is intentionally dropped (never stored)
}

export function analyzeCookies(r: SafeResponse, url: URL): RawFinding[] {
  const raw = r.headers["set-cookie"];
  const lines = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: RawFinding[] = [];
  const https = url.protocol === "https:";
  for (const line of lines) {
    const c = parseSetCookie(line);
    if (!c) continue;
    const sessionLike = SESSION_LIKE.test(c.name);
    const ev = { kind: "header" as const, content: { cookie: c.name, attributes: Object.keys(c.attrs).sort(), valueRedacted: true } };
    const base = { affectedAsset: url.origin, location: c.name, confidence: "high" as const, verification: "confirmed" as const, references: [REF], evidence: [ev] };
    if (https && !c.attrs["secure"])
      out.push({ ...base, ruleId: "cookies.secure-missing", severity: sessionLike ? "medium" : "low",
        title: `Cookie "${c.name}" is set without the Secure attribute`,
        description: "The cookie can be sent over unencrypted HTTP connections.", impact: "May be exposed to a network attacker if the browser makes an HTTP request.",
        remediation: "Add the Secure attribute." });
    if (!c.attrs["httponly"] && sessionLike)
      out.push({ ...base, ruleId: "cookies.httponly-missing", severity: "medium", confidence: "medium",
        title: `Session-like cookie "${c.name}" is not HttpOnly`,
        description: "The name suggests a session or authentication cookie that JavaScript can read. Whether it is truly a session cookie requires manual review.",
        impact: "An XSS flaw could steal the cookie.", remediation: "Add the HttpOnly attribute for cookies that scripts do not need.",
        verification: "unverified_observation" });
    const ss = String(c.attrs["samesite"] ?? "").toLowerCase();
    if (!ss && sessionLike)
      out.push({ ...base, ruleId: "cookies.samesite-missing", severity: "low",
        title: `Cookie "${c.name}" has no SameSite attribute`, description: "Browsers apply their own default (usually Lax).",
        impact: "Cross-site request protections depend on browser defaults.", remediation: "Set SameSite=Lax or Strict explicitly." });
    if (ss === "none" && !c.attrs["secure"])
      out.push({ ...base, ruleId: "cookies.samesite-none-insecure", severity: "medium",
        title: `Cookie "${c.name}" uses SameSite=None without Secure`, description: "Modern browsers reject such cookies.",
        impact: "Cookie will not work as intended and indicates a misconfiguration.", remediation: "Add Secure or use SameSite=Lax." });
    if (/^__Host-/.test(c.name) && (!c.attrs["secure"] || c.attrs["domain"] || c.attrs["path"] !== "/"))
      out.push({ ...base, ruleId: "cookies.host-prefix-violation", severity: "low",
        title: `Cookie "${c.name}" violates __Host- prefix requirements`, description: "__Host- cookies must be Secure, have Path=/ and no Domain.",
        impact: "Browsers will reject the cookie.", remediation: "Fix the attributes or drop the prefix." });
  }
  return out;
}

export const cookieSecurity: AssessmentModule = {
  id: "cookie-security",
  kind: "passive",
  async run(ctx) {
    const r = await ctx.get("/");
    return { findings: analyzeCookies(r, ctx.target) };
  },
};
