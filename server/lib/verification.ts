import { createHmac } from "node:crypto";
import { resolveTxt } from "node:dns/promises";

import { safeFetch } from "./safe-fetch.js";

export const DNS_LABEL = "_sentrix-challenge";
export const FILE_PATH = "/.well-known/sentrix-verification.txt";

function secret() {
  const s = process.env.VERIFICATION_SECRET || process.env.SUPABASE_SECRET_KEY;
  if (!s) throw new Error("Set VERIFICATION_SECRET (or SUPABASE_SECRET_KEY) to enable target verification.");
  return s;
}
/** Deterministic per-target proof token; the secret never leaves the server, so users cannot forge it for other targets. */
export const challengeToken = (targetId: string) =>
  "sentrix-verification=" + createHmac("sha256", secret()).update(`target:${targetId}`).digest("hex").slice(0, 40);

export const instructions = (targetId: string, canonicalUrl: string) => {
  const u = new URL(canonicalUrl);
  const token = challengeToken(targetId);
  return {
    token,
    dns: { host: `${DNS_LABEL}.${u.hostname}`, type: "TXT", value: token },
    file: { url: `${u.origin}${FILE_PATH}`, content: token },
  };
};

export interface CheckResult { ok: boolean; detail: string }

export async function checkDns(targetId: string, canonicalUrl: string, resolver = resolveTxt): Promise<CheckResult> {
  const host = `${DNS_LABEL}.${new URL(canonicalUrl).hostname}`;
  try {
    const records = (await resolver(host)).map((chunks) => chunks.join(""));
    return records.includes(challengeToken(targetId)) ? { ok: true, detail: "TXT record matched" } : { ok: false, detail: `No matching TXT record at ${host}` };
  } catch {
    return { ok: false, detail: `Could not read TXT records at ${host}` };
  }
}

export async function checkFile(targetId: string, canonicalUrl: string, fetcher = safeFetch): Promise<CheckResult> {
  const url = `${new URL(canonicalUrl).origin}${FILE_PATH}`;
  try {
    const r = await fetcher(url, { maxBytes: 4096, timeoutMs: 8000 });
    if (r.status !== 200) return { ok: false, detail: `Verification file returned HTTP ${r.status}` };
    return r.body.trim() === challengeToken(targetId) ? { ok: true, detail: "Verification file matched" } : { ok: false, detail: "Verification file content did not match" };
  } catch (e) {
    return { ok: false, detail: `Could not fetch verification file: ${(e as Error).message}`.slice(0, 200) };
  }
}
