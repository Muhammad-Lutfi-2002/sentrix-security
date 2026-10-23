import { describe, expect, it } from "vitest";
import { validateTargetUrl } from "../../app/lib/target-url";
import { assertPublicDestination, assertRedirectAllowed, canonicalizeTargetUrl, isBlockedIp, TargetRejected } from "./target-guard";

const pub = async () => ["93.184.216.34"];
describe("static validator", () => {
  it.each(["http://localhost./", "http://LOCALHOST/", "http://127.1/", "http://2130706433/", "http://0x7f.0.0.1/",
    "http://[::1]/", "http://[::ffff:127.0.0.1]/", "https://metadata.google.internal/", "http://169.254.169.254/",
    "https://user:pw@example.com/", "ftp://example.com/", "http://10.0.0.1/", "http://foo.local./"])("rejects %s", (u) => {
    expect(validateTargetUrl(u)).not.toBeNull();
  });
  it("allows ordinary public hosts", () => {
    expect(validateTargetUrl("https://example.com:8443/app")).toBeNull();
  });
});
describe("isBlockedIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254",
    "64:ff9b::a00:1", "2002:7f00:1::", "ff02::1", "not-an-ip"])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) =>
    expect(isBlockedIp(ip)).toBe(false));
});
describe("canonicalizeTargetUrl", () => {
  it("normalizes case, default port, trailing dot, fragment", () => {
    expect(canonicalizeTargetUrl("HTTPS://Example.COM.:443/a#x")).toBe("https://example.com/a");
  });
});
describe("DNS checks", () => {
  it("rejects hostnames that resolve to private space (nip.io style)", async () => {
    await expect(assertPublicDestination("https://a.nip.io/", async () => ["127.0.0.1"])).rejects.toBeInstanceOf(TargetRejected);
  });
  it("rejects when ANY answer is private (mixed A/AAAA)", async () => {
    await expect(assertPublicDestination("https://a.test/", async () => ["93.184.216.34", "::1"])).rejects.toThrow(/private/);
  });
  it("fails closed on resolution failure", async () => {
    await expect(assertPublicDestination("https://a.test/", async () => { throw new Error("nx"); })).rejects.toThrow(/resolved/);
  });
  it("accepts public answers", async () => {
    await expect(assertPublicDestination("https://a.test/", pub)).resolves.toEqual(["93.184.216.34"]);
  });
});
describe("redirects", () => {
  const reg = "https://app.example.com/";
  it("allows same-origin redirects", async () => {
    await expect(assertRedirectAllowed(reg, "/login", reg, [], pub)).resolves.toBe("https://app.example.com/login");
  });
  it("blocks cross-origin, scheme downgrade, and excluded paths", async () => {
    await expect(assertRedirectAllowed(reg, "https://evil.example.net/", reg, [], pub)).rejects.toThrow(/origin/);
    await expect(assertRedirectAllowed(reg, "http://app.example.com/", reg, [], pub)).rejects.toThrow(/origin/);
    await expect(assertRedirectAllowed(reg, "/admin/users", reg, ["/admin"], pub)).rejects.toThrow(/excluded/);
  });
  it("blocks same-origin redirect if DNS now points to a private IP (rebinding)", async () => {
    await expect(assertRedirectAllowed(reg, "/x", reg, [], async () => ["10.0.0.5"])).rejects.toThrow(/private/);
  });
});
