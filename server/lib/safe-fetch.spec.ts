import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { guardedLookup, safeFetch } from "./safe-fetch";
import { TargetRejected } from "./target-guard";

let server: http.Server; let port: number;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { location: "http://169.254.169.254/latest" }); return res.end(); }
    if (req.url === "/big") { res.writeHead(200); return res.end("x".repeat(2_000_000)); }
    if (req.url === "/slow") return; // never responds
    res.writeHead(200, { "set-cookie": ["a=1; Secure; HttpOnly", "b=2"], "x-test": "yes" });
    res.end("hello");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => { server.closeAllConnections?.(); server.close(); });

describe("safeFetch", () => {
  it("refuses loopback by default (policy applies before any connection)", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(TargetRejected);
  });
  it("connection-time lookup rejects names that resolve to loopback (rebinding defense)", async () => {
    const err = await new Promise<any>((res) => guardedLookup(false)("localhost", { all: true }, (e: any) => res(e)));
    expect(err).toBeInstanceOf(TargetRejected);
  });
  it("connection-time lookup allows loopback only in fixture mode", async () => {
    const out = await new Promise<any>((res) => guardedLookup(true)("localhost", { all: true }, (e: any, a: any) => res(e ?? a)));
    expect(Array.isArray(out)).toBe(true);
  });
  it("returns status, headers and body (fixture mode)", async () => {
    const r = await safeFetch(`http://127.0.0.1:${port}/`, { _unsafeAllowPrivate: true });
    expect(r.status).toBe(200); expect(r.body).toBe("hello"); expect(r.headers["x-test"]).toBe("yes");
    expect(r.headers["set-cookie"]).toHaveLength(2);
  });
  it("does not follow redirects", async () => {
    const r = await safeFetch(`http://127.0.0.1:${port}/redirect`, { _unsafeAllowPrivate: true });
    expect(r.status).toBe(302); expect(r.location).toContain("169.254.169.254");
  });
  it("caps response size", async () => {
    const r = await safeFetch(`http://127.0.0.1:${port}/big`, { _unsafeAllowPrivate: true, maxBytes: 1000 });
    expect(r.truncated).toBe(true); expect(r.body.length).toBeLessThanOrEqual(1000 + 65536);
  });
  it("times out", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/slow`, { _unsafeAllowPrivate: true, timeoutMs: 300 })).rejects.toThrow(/timed out/);
  });
});
