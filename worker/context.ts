import { safeFetch, tlsInspect, type SafeResponse } from "../server/lib/safe-fetch.js";
import { assertPublicDestination, assertRedirectAllowed, canonicalizeTargetUrl } from "../server/lib/target-guard.js";
import type { ModuleContext } from "./modules/types.js";
import type { AssessmentCtx } from "./store.js";

const MAX_REQUESTS = 12;
const MAX_REDIRECTS = 5;

/** Guarded network access for modules: destination re-validated now, same-origin redirects only, excluded paths honored, request budget. */
export async function guardedContext(a: AssessmentCtx, isCancelled: () => Promise<boolean>): Promise<ModuleContext> {
  const registered = canonicalizeTargetUrl(a.target!.canonical_url);
  await assertPublicDestination(registered); // revalidate DNS at execution time
  const target = new URL(registered);
  const excluded = a.target!.excluded_paths ?? [];
  let budget = MAX_REQUESTS;

  const isExcluded = (p: string) => excluded.some((x) => p === x || p.startsWith(x.endsWith("/") ? x : x + "/"));
  return {
    target,
    isCancelled,
    async get(path = "/") {
      let url = new URL(path, registered).toString();
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (await isCancelled()) throw new Error("cancelled");
        if (budget-- <= 0) throw new Error("request budget exhausted");
        if (isExcluded(new URL(url).pathname)) throw new Error("path is excluded from scope");
        const r: SafeResponse = await safeFetch(url, { method: "GET", maxBytes: 256 * 1024, timeoutMs: 10_000 });
        if (r.status >= 300 && r.status < 400 && r.location) {
          url = await assertRedirectAllowed(url, r.location, registered, excluded);
          continue;
        }
        return r;
      }
      throw new Error("too many redirects");
    },
    async tls(host, port) {
      if (host !== target.hostname) throw new Error("TLS inspection is limited to the registered host");
      await assertPublicDestination(`https://${host}:${port}/`);
      return tlsInspect(host, port);
    },
  };
}
