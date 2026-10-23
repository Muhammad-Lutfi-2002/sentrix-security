import type { SafeResponse } from "../../server/lib/safe-fetch.js";
import type { AssessmentModule, RawFinding } from "./types.js";

const REF = {
  hsts: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Strict-Transport-Security",
  csp: "https://developer.mozilla.org/docs/Web/HTTP/CSP",
  nosniff: "https://developer.mozilla.org/docs/Web/HTTP/Headers/X-Content-Type-Options",
  frame: "https://developer.mozilla.org/docs/Web/HTTP/Headers/X-Frame-Options",
  referrer: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Referrer-Policy",
  perms: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Permissions-Policy",
  cors: "https://developer.mozilla.org/docs/Web/HTTP/CORS",
};
const h = (r: SafeResponse, name: string) => {
  const v = r.headers[name];
  return Array.isArray(v) ? v.join(", ") : v;
};
const hdrEvidence = (r: SafeResponse, names: string[]) => ({
  kind: "header" as const,
  content: { status: r.status, headers: Object.fromEntries(names.map((n) => [n, h(r, n) ?? null])) },
});

export function analyzeHeaders(r: SafeResponse, url: URL): RawFinding[] {
  const out: RawFinding[] = [];
  const asset = url.origin;
  const add = (f: Omit<RawFinding, "affectedAsset" | "verification" | "confidence"> & Partial<Pick<RawFinding, "confidence" | "verification">>) =>
    out.push({ affectedAsset: asset, verification: "confirmed", confidence: "high", ...f });
  const https = url.protocol === "https:";

  if (!https) {
    add({
      ruleId: "transport.plain-http", title: "Target is served over plain HTTP", severity: "medium",
      description: "The registered URL uses http://. Traffic, including any credentials or session cookies, is sent unencrypted.",
      impact: "A network attacker can read or modify traffic between users and the application.",
      remediation: "Serve the site over HTTPS, redirect all HTTP requests to HTTPS and enable HSTS.", references: [REF.hsts],
      evidence: [hdrEvidence(r, ["location", "server"])],
    });
  } else {
    const hsts = h(r, "strict-transport-security");
    if (!hsts) {
      add({
        ruleId: "headers.hsts-missing", title: "Strict-Transport-Security header is missing", severity: "medium",
        description: "The HTTPS response does not set HSTS, so browsers may be downgraded to HTTP on first or later visits.",
        impact: "Users are exposed to SSL-stripping on hostile networks.",
        remediation: "Send Strict-Transport-Security: max-age=31536000; includeSubDomains (add preload only after verifying all subdomains support HTTPS).",
        references: [REF.hsts], evidence: [hdrEvidence(r, ["strict-transport-security"])],
      });
    } else {
      const age = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0);
      if (age < 15_552_000)
        add({
          ruleId: "headers.hsts-weak", title: "HSTS max-age is shorter than 180 days", severity: "low",
          description: `HSTS is present but max-age=${age} seconds.`, impact: "The downgrade protection window is short.",
          remediation: "Increase max-age to at least 15552000 (180 days); 31536000 is the common target.", references: [REF.hsts],
          evidence: [hdrEvidence(r, ["strict-transport-security"])],
        });
    }
  }

  const csp = h(r, "content-security-policy");
  if (!csp) {
    add({
      ruleId: "headers.csp-missing", title: "Content-Security-Policy header is missing", severity: "medium",
      description: "No CSP is set. This is an observation of a missing defense-in-depth control, not evidence of an exploitable flaw.",
      impact: "If an injection flaw exists elsewhere, the browser has no policy limiting what injected script can do.",
      remediation: "Define a restrictive CSP (start in report-only mode) and avoid 'unsafe-inline'/'unsafe-eval'.", references: [REF.csp],
      evidence: [hdrEvidence(r, ["content-security-policy"])],
    });
  } else if (/(script-src|default-src)[^;]*'unsafe-(inline|eval)'/i.test(csp) && !/'nonce-|'strict-dynamic'/i.test(csp)) {
    add({
      ruleId: "headers.csp-unsafe", title: "CSP allows unsafe-inline or unsafe-eval scripts", severity: "low",
      confidence: "medium",
      description: "The policy permits inline or eval script execution without a nonce or strict-dynamic.",
      impact: "The policy provides little protection against script injection.",
      remediation: "Use nonces or hashes for inline scripts and remove 'unsafe-inline'/'unsafe-eval' from script sources.", references: [REF.csp],
      evidence: [hdrEvidence(r, ["content-security-policy"])],
    });
  }

  if (!/nosniff/i.test(h(r, "x-content-type-options") ?? "")) {
    add({
      ruleId: "headers.nosniff-missing", title: "X-Content-Type-Options: nosniff is missing", severity: "low",
      description: "Browsers may MIME-sniff responses and interpret them as a different content type.",
      impact: "Increases risk when user-supplied content is served from the same origin.",
      remediation: "Send X-Content-Type-Options: nosniff on all responses.", references: [REF.nosniff],
      evidence: [hdrEvidence(r, ["x-content-type-options"])],
    });
  }

  const framed = h(r, "x-frame-options") || /frame-ancestors/i.test(csp ?? "");
  if (!framed) {
    add({
      ruleId: "headers.clickjacking", title: "No clickjacking protection (X-Frame-Options / frame-ancestors)", severity: "medium",
      description: "The response can be embedded in a frame on any other site.",
      impact: "Attackers can overlay the page in a hostile site to trick users into unintended clicks.",
      remediation: "Set Content-Security-Policy: frame-ancestors 'self' (or X-Frame-Options: DENY/SAMEORIGIN).", references: [REF.frame, REF.csp],
      evidence: [hdrEvidence(r, ["x-frame-options", "content-security-policy"])],
    });
  }

  if (!h(r, "referrer-policy")) {
    add({
      ruleId: "headers.referrer-policy-missing", title: "Referrer-Policy header is missing", severity: "info",
      description: "Browsers fall back to their default referrer behaviour.", impact: "URLs may leak to third parties through the Referer header.",
      remediation: "Send Referrer-Policy: strict-origin-when-cross-origin (or stricter).", references: [REF.referrer],
      evidence: [hdrEvidence(r, ["referrer-policy"])],
    });
  }
  if (!h(r, "permissions-policy")) {
    add({
      ruleId: "headers.permissions-policy-missing", title: "Permissions-Policy header is missing", severity: "info",
      description: "No policy restricts powerful browser features.", impact: "Embedded content may request features such as camera or geolocation.",
      remediation: "Send a Permissions-Policy that disables features the application does not use.", references: [REF.perms],
      evidence: [hdrEvidence(r, ["permissions-policy"])],
    });
  }

  const server = h(r, "server");
  const powered = h(r, "x-powered-by");
  if (powered || (server && /\d+\.\d+/.test(server))) {
    add({
      ruleId: "headers.version-disclosure", title: "Server technology/version disclosed in response headers", severity: "info",
      description: "Response headers reveal software names or versions.", impact: "Helps attackers select known vulnerabilities for the disclosed version.",
      remediation: "Remove or genericize Server and X-Powered-By headers.", references: [],
      evidence: [hdrEvidence(r, ["server", "x-powered-by"])],
    });
  }

  const acao = h(r, "access-control-allow-origin");
  if (acao === "*" && /true/i.test(h(r, "access-control-allow-credentials") ?? "")) {
    add({
      ruleId: "headers.cors-wildcard-credentials", title: "CORS allows any origin together with credentials", severity: "medium",
      description: "Access-Control-Allow-Origin: * is combined with Access-Control-Allow-Credentials: true. Browsers refuse this combination, which indicates a misconfigured policy.",
      impact: "Indicates CORS logic that may reflect untrusted origins elsewhere; needs manual review.", confidence: "medium", verification: "unverified_observation",
      remediation: "Allow only specific trusted origins; never combine a wildcard with credentials.", references: [REF.cors],
      evidence: [hdrEvidence(r, ["access-control-allow-origin", "access-control-allow-credentials"])],
    });
  }
  return out;
}

export const securityHeaders: AssessmentModule = {
  id: "security-headers",
  kind: "passive",
  async run(ctx) {
    const r = await ctx.get("/");
    return { findings: analyzeHeaders(r, ctx.target) };
  },
};
