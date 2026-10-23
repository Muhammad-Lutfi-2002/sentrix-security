import { describe, expect, it } from "vitest";
import type { SafeResponse, TlsInfo } from "../../server/lib/safe-fetch";
import { analyzeCookies, parseSetCookie } from "./cookie-security";
import { analyzeHeaders } from "./security-headers";
import { analyzeTls } from "./tls-config";

const resp = (headers: Record<string, string | string[]>, status = 200): SafeResponse => ({
  status, headers, rawHeaders: [], body: "", truncated: false, remoteAddress: "93.184.216.34", location: null,
});
const ids = (f: { ruleId: string }[]) => f.map((x) => x.ruleId).sort();
const https = new URL("https://example.com/");

describe("security headers", () => {
  it("flags every missing control on a bare HTTPS response", () => {
    expect(ids(analyzeHeaders(resp({}), https))).toEqual([
      "headers.clickjacking", "headers.csp-missing", "headers.hsts-missing", "headers.nosniff-missing",
      "headers.permissions-policy-missing", "headers.referrer-policy-missing",
    ]);
  });
  it("reports nothing for a hardened response", () => {
    const f = analyzeHeaders(resp({
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
      "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "permissions-policy": "camera=()",
    }), https);
    expect(f).toEqual([]);
  });
  it("detects weak HSTS, unsafe CSP, version disclosure, CORS misconfig", () => {
    const f = analyzeHeaders(resp({
      "strict-transport-security": "max-age=60", "content-security-policy": "default-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "permissions-policy": "x=()",
      server: "Apache/2.4.41", "access-control-allow-origin": "*", "access-control-allow-credentials": "true",
    }), https);
    expect(ids(f)).toEqual(["headers.cors-wildcard-credentials", "headers.csp-unsafe", "headers.hsts-weak", "headers.version-disclosure"]);
    expect(f.find((x) => x.ruleId === "headers.cors-wildcard-credentials")!.verification).toBe("unverified_observation");
  });
  it("flags plain HTTP and does not demand HSTS there", () => {
    const f = ids(analyzeHeaders(resp({}), new URL("http://example.com/")));
    expect(f).toContain("transport.plain-http"); expect(f).not.toContain("headers.hsts-missing");
  });
  it("evidence never contains a body", () => {
    const f = analyzeHeaders({ ...resp({}), body: "SECRET-BODY" }, https);
    expect(JSON.stringify(f)).not.toContain("SECRET-BODY");
  });
});

describe("cookies", () => {
  it("parses attributes and drops the value", () => {
    const c = parseSetCookie("sid=abc123; Path=/; Secure; HttpOnly; SameSite=Lax")!;
    expect(c.name).toBe("sid"); expect(JSON.stringify(c)).not.toContain("abc123");
    expect(c.attrs["samesite"]).toBe("Lax");
  });
  it("flags insecure session cookies and redacts values from evidence", () => {
    const f = analyzeCookies(resp({ "set-cookie": ["session_id=TOPSECRET; Path=/", "theme=dark"] }), https);
    expect(ids(f)).toEqual(["cookies.httponly-missing", "cookies.samesite-missing", "cookies.secure-missing", "cookies.secure-missing"]);
    expect(JSON.stringify(f)).not.toContain("TOPSECRET");
    expect(f.find((x) => x.ruleId === "cookies.secure-missing" && x.location === "session_id")!.severity).toBe("medium");
    expect(f.find((x) => x.ruleId === "cookies.secure-missing" && x.location === "theme")!.severity).toBe("low");
  });
  it("accepts a well-configured cookie", () => {
    expect(analyzeCookies(resp({ "set-cookie": "sid=x; Secure; HttpOnly; SameSite=Strict; Path=/" }), https)).toEqual([]);
  });
  it("flags SameSite=None without Secure", () => {
    expect(ids(analyzeCookies(resp({ "set-cookie": "x=1; SameSite=None" }), new URL("http://a.test/")))).toContain("cookies.samesite-none-insecure");
  });
});

const tlsBase: TlsInfo = { protocol: "TLSv1.3", authorized: true, authorizationError: null, validFrom: "x", validTo: "y", subjectCN: "example.com", issuerCN: "CA", altNames: "DNS:example.com", daysRemaining: 200, selfSigned: false };
describe("tls", () => {
  it("passes a healthy certificate", () => expect(analyzeTls(tlsBase, "example.com")).toEqual([]));
  it("flags expired, expiring, self-signed, mismatch and legacy protocol", () => {
    expect(ids(analyzeTls({ ...tlsBase, daysRemaining: -3, authorized: false, authorizationError: "CERT_HAS_EXPIRED" }, "h"))).toEqual(["tls.cert-expired"]);
    expect(ids(analyzeTls({ ...tlsBase, daysRemaining: 10 }, "h"))).toEqual(["tls.cert-expiring"]);
    expect(analyzeTls({ ...tlsBase, daysRemaining: 10 }, "h")[0].severity).toBe("medium");
    expect(ids(analyzeTls({ ...tlsBase, authorized: false, authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT", selfSigned: true }, "h"))).toEqual(["tls.self-signed"]);
    expect(ids(analyzeTls({ ...tlsBase, authorized: false, authorizationError: "Hostname/IP does not match certificate's altnames" }, "h"))).toEqual(["tls.hostname-mismatch"]);
    expect(ids(analyzeTls({ ...tlsBase, protocol: "TLSv1.1" }, "h"))).toEqual(["tls.legacy-protocol"]);
  });
});
