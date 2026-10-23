import { describe, expect, it } from "vitest";

import { validateTargetUrl } from "./target-url";

describe("validateTargetUrl", () => {
  it.each([
    "https://example.com",
    "http://app.example.com:8080/path",
    "https://93.184.216.34",
  ])("accepts public target %s", (url) => {
    expect(validateTargetUrl(url)).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://example.com",
    "data:text/html,hi",
    "https://user:pass@example.com",
    "http://localhost:3000",
    "http://api.localhost",
    "http://printer.local",
    "http://127.0.0.1",
    "http://2130706433",
    "http://10.0.0.5",
    "http://172.16.4.1",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1",
    "http://[::1]/",
    "not a url",
  ])("rejects unsafe target %s", (url) => {
    expect(validateTargetUrl(url)).not.toBeNull();
  });
});
