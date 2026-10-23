import type { TlsInfo } from "../../server/lib/safe-fetch.js";
import type { AssessmentModule, RawFinding } from "./types.js";

const REF = "https://developer.mozilla.org/docs/Web/Security/Transport_Layer_Security";

export function analyzeTls(info: TlsInfo, host: string, now = Date.now()): RawFinding[] {
  const out: RawFinding[] = [];
  const asset = host;
  const ev = [{ kind: "certificate" as const, content: { protocol: info.protocol, subjectCN: info.subjectCN, issuerCN: info.issuerCN, validFrom: info.validFrom, validTo: info.validTo, altNames: info.altNames, authorizationError: info.authorizationError } }];
  const base = { affectedAsset: asset, confidence: "high" as const, verification: "confirmed" as const, references: [REF], evidence: ev };

  if (info.daysRemaining !== null && info.daysRemaining < 0)
    out.push({ ...base, ruleId: "tls.cert-expired", severity: "high", title: "TLS certificate has expired",
      description: `The certificate expired ${Math.abs(info.daysRemaining)} day(s) ago (valid to ${info.validTo}).`,
      impact: "Browsers show warnings or block access; users may be trained to click through warnings.", remediation: "Renew the certificate and automate renewal." });
  else if (info.daysRemaining !== null && info.daysRemaining <= 30)
    out.push({ ...base, ruleId: "tls.cert-expiring", severity: info.daysRemaining <= 14 ? "medium" : "low",
      title: `TLS certificate expires in ${info.daysRemaining} day(s)`, description: `Valid to ${info.validTo}.`,
      impact: "An outage will occur if the certificate is not renewed in time.", remediation: "Renew the certificate and automate renewal." });

  if (!info.authorized) {
    const err = info.authorizationError ?? "unknown error";
    const self = info.selfSigned || /SELF_SIGNED/i.test(err);
    const hostMismatch = /altname|hostname|Host:/i.test(err);
    if (!(info.daysRemaining !== null && info.daysRemaining < 0 && /EXPIRED/i.test(err)))
      out.push({ ...base, ruleId: self ? "tls.self-signed" : hostMismatch ? "tls.hostname-mismatch" : "tls.untrusted-chain",
        severity: "high", title: self ? "Certificate is self-signed" : hostMismatch ? "Certificate does not match the hostname" : "Certificate chain is not trusted",
        description: `Validation against the system trust store failed: ${err}.`,
        impact: "Clients cannot verify they are talking to the intended server.", remediation: "Install a certificate from a trusted CA that covers this hostname, including intermediates." });
  }

  const proto = info.protocol ?? "";
  if (/^TLSv1(\.1)?$/.test(proto))
    out.push({ ...base, ruleId: "tls.legacy-protocol", severity: "high", title: `Server negotiated legacy protocol ${proto}`,
      description: "TLS 1.0 and 1.1 are deprecated (RFC 8996).", impact: "Weaker cryptography and known protocol attacks.", remediation: "Disable TLS 1.0/1.1; support TLS 1.2 and 1.3." });
  return out;
}

export const tlsConfig: AssessmentModule = {
  id: "tls-config",
  kind: "passive",
  async run(ctx) {
    if (ctx.target.protocol !== "https:") return { findings: [], skippedReason: "Target is not HTTPS, so there is no TLS to review." };
    const info = await ctx.tls(ctx.target.hostname, Number(ctx.target.port || 443));
    // Limitation: only the protocol negotiated by this client is observed; supported-protocol enumeration is not performed.
    return { findings: analyzeTls(info, ctx.target.hostname) };
  },
};
