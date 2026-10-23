// Server-side SSRF guard. Static URL checks live in app/lib/target-url.ts; this adds
// canonicalization, IP classification (v4 + v6), DNS-resolution checks and redirect scope checks.
// LIMITATION: validating at registration/job start is not enough on its own. The scanner worker
// must connect to the *resolved, validated IP* (pinning) and egress must be restricted at the
// network layer. This module provides the primitives; the worker is not yet implemented.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { validateTargetUrl } from "../../app/lib/target-url.js";

export class TargetRejected extends Error {}

function v4ToInt(ip: string) {
  return ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
}
const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
];

export function isBlockedIPv4(ip: string) {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = v4ToInt(base);
    return n >= start && n < start + size;
  });
}

function expandV6(ip: string): number[] | null {
  let addr = ip.split("%")[0].toLowerCase();
  const tail = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4ToInt(tail[1]);
    addr = addr.slice(0, -tail[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const [head, rest, extra] = addr.split("::");
  if (extra !== undefined) return null;
  const h = head ? head.split(":") : [];
  const r = rest !== undefined && rest ? rest.split(":") : [];
  const fill = rest === undefined ? 0 : 8 - h.length - r.length;
  const groups = [...h, ...Array(Math.max(fill, 0)).fill("0"), ...r].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

export function isBlockedIPv6(ip: string) {
  const g = expandV6(ip);
  if (!g) return true; // unparsable: fail closed
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (allZero(0, 7) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96): judge by embedded v4
  const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if ((allZero(0, 5) && g[5] === 0xffff) || allZero(0, 6) || (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)))
    return isBlockedIPv4(embedded);
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2002) return true; // 6to4 (embeds arbitrary v4)
  return false;
}

export function isBlockedIp(ip: string) {
  const v = isIP(ip);
  return v === 4 ? isBlockedIPv4(ip) : v === 6 ? isBlockedIPv6(ip) : true;
}

/** Canonical form used as the registered identity of a target. Throws TargetRejected. */
export function canonicalizeTargetUrl(input: string): string {
  const err = validateTargetUrl(input.trim());
  if (err) throw new TargetRejected(err);
  const u = new URL(input.trim());
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/\.+$/, "");
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
  return u.toString();
}

export type Resolver = (host: string) => Promise<string[]>;
export const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Resolve the host and reject if ANY address is non-public (defeats mixed A/AAAA answers). Returns the validated IPs. */
export async function assertPublicDestination(url: string, resolve: Resolver = systemResolver): Promise<string[]> {
  const canonical = canonicalizeTargetUrl(url);
  const host = new URL(canonical).hostname;
  const literal = host.replace(/^\[|\]$/g, "");
  const addrs = isIP(literal) ? [literal] : await resolve(host).catch(() => {
    throw new TargetRejected("Hostname could not be resolved.");
  });
  if (!addrs.length) throw new TargetRejected("Hostname did not resolve to any address.");
  const bad = addrs.find(isBlockedIp);
  if (bad) throw new TargetRejected("Target resolves to a private, loopback, or reserved address.");
  return addrs;
}

/** A redirect may only continue if it stays on the registered origin and is itself a public destination. */
export async function assertRedirectAllowed(
  from: string, location: string, registered: string, excludedPaths: string[] = [], resolve: Resolver = systemResolver,
): Promise<string> {
  const next = new URL(location, from);
  const base = new URL(canonicalizeTargetUrl(registered));
  if (next.origin !== base.origin) throw new TargetRejected("Redirect leaves the registered origin.");
  if (excludedPaths.some((p) => next.pathname === p || next.pathname.startsWith(p.endsWith("/") ? p : p + "/")))
    throw new TargetRejected("Redirect enters an excluded path.");
  await assertPublicDestination(next.toString(), resolve);
  return next.toString();
}
