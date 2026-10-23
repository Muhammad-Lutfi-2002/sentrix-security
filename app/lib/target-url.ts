const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain"];

function isBlockedIPv4(host: string) {
  const parts = host.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function validateTargetUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a valid URL.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Only http and https targets are supported.";
  }
  if (url.username || url.password) {
    return "Remove credentials from the target URL.";
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (
    host === "localhost" ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return "Local and internal hostnames cannot be targeted.";
  }
  if (host.startsWith("[")) {
    return "IPv6 literal targets are not supported.";
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isBlockedIPv4(host)) {
    return "Private, loopback, and reserved IP addresses cannot be targeted.";
  }
  return null;
}
