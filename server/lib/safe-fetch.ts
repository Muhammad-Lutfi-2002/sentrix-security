// HTTP(S) client for talking to registered targets. Differences from fetch():
//  - every resolved address is validated AT CONNECTION TIME via a custom `lookup` (closes DNS-rebinding TOCTOU);
//  - redirects are never followed automatically (caller decides via assertRedirectAllowed);
//  - hard timeout and response-size cap; no credentials; no proxy env.
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";

import { canonicalizeTargetUrl, isBlockedIp, TargetRejected } from "./target-guard.js";

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  /** TEST ONLY: skips URL and IP policy so fixtures on loopback can be used. Never set in production code. */
  _unsafeAllowPrivate?: boolean;
}
export interface SafeResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: string[];
  body: string;
  truncated: boolean;
  remoteAddress: string;
  location: string | null;
}

export function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: any, cb: any) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addrs: any) => {
      if (err) return cb(err);
      const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: 4 }];
      if (!allowPrivate && list.some((a: any) => isBlockedIp(a.address)))
        return cb(new TargetRejected("Target resolves to a private, loopback, or reserved address."));
      if (options?.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  };
}

export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const allow = opts._unsafeAllowPrivate === true;
  const target = allow ? url : canonicalizeTargetUrl(url);
  const u = new URL(target);
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  const lib = u.protocol === "https:" ? https : http;
  return await new Promise<SafeResponse>((resolve, reject) => {
    const req = lib.request(
      u,
      {
        method: opts.method ?? "GET",
        headers: { "user-agent": "SENTRIX-Assessment/2.0 (+authorized security assessment)", accept: "*/*", ...opts.headers },
        lookup: guardedLookup(allow) as any,
        agent: false,
        timeout: opts.timeoutMs ?? 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) { truncated = true; res.destroy(); return; }
          chunks.push(c);
        });
        const done = () => resolve({
          status: res.statusCode ?? 0, headers: res.headers, rawHeaders: res.rawHeaders,
          body: Buffer.concat(chunks).toString("utf8"), truncated, remoteAddress: res.socket?.remoteAddress ?? "",
          location: typeof res.headers.location === "string" ? res.headers.location : null,
        });
        res.on("end", done);
        res.on("close", () => { if (truncated) done(); });
        res.on("error", (e) => (truncated ? done() : reject(e)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}

export interface TlsInfo {
  protocol: string | null;
  authorized: boolean;
  authorizationError: string | null;
  validFrom: string | null;
  validTo: string | null;
  subjectCN: string | null;
  issuerCN: string | null;
  altNames: string | null;
  daysRemaining: number | null;
  selfSigned: boolean;
}

/** TLS handshake only (no HTTP request). Certificate problems are reported, not thrown. */
export function tlsInspect(host: string, port = 443, opts: { timeoutMs?: number; _unsafeAllowPrivate?: boolean } = {}): Promise<TlsInfo> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({
      host, port, servername: host, rejectUnauthorized: false, timeout: opts.timeoutMs ?? 10_000,
      lookup: guardedLookup(opts._unsafeAllowPrivate === true) as any,
    }, () => {
      const cert = sock.getPeerCertificate();
      const to = cert?.valid_to ? new Date(cert.valid_to) : null;
      const info: TlsInfo = {
        protocol: sock.getProtocol(),
        authorized: sock.authorized,
        authorizationError: sock.authorizationError ? String(sock.authorizationError) : null,
        validFrom: cert?.valid_from ?? null, validTo: cert?.valid_to ?? null,
        subjectCN: (cert?.subject as any)?.CN ?? null, issuerCN: (cert?.issuer as any)?.CN ?? null,
        altNames: cert?.subjectaltname ?? null,
        daysRemaining: to ? Math.floor((to.getTime() - Date.now()) / 86_400_000) : null,
        selfSigned: Boolean(cert?.subject && cert?.issuer && JSON.stringify(cert.subject) === JSON.stringify(cert.issuer)),
      };
      sock.end();
      resolve(info);
    });
    sock.on("timeout", () => sock.destroy(new Error("TLS handshake timed out")));
    sock.on("error", reject);
  });
}
