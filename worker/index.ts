// SENTRIX scanner worker. Run: `pnpm worker` (loop) or `pnpm worker -- --once`.
// Requires SUPABASE_URL + SUPABASE_SECRET_KEY. Run it in an environment whose outbound network is restricted
// to the internet (no access to your private networks or cloud metadata endpoints): the application-level
// guards are defense in depth, not a replacement for network egress policy.
import "dotenv/config";
import { hostname } from "node:os";

import { createClient } from "@supabase/supabase-js";

import { requireServiceConfig } from "../server/lib/supabase-config.js";
import { guardedContext } from "./context.js";
import { processNext } from "./runner.js";
import { supabaseStore } from "./store.js";

const { url, secretKey } = requireServiceConfig();
const db = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const store = supabaseStore(db);
const concurrency = Math.min(4, Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 1)));
const once = process.argv.includes("--once");
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; console.log(`[worker] ${sig}: finishing current job then exiting`); });

async function loop(n: number) {
  const workerId = `${hostname()}:${process.pid}:${n}`;
  while (!stopping) {
    try {
      const r = await processNext({ store, workerId, makeContext: guardedContext });
      if (once) return;
      if (r === "idle") await new Promise((res) => setTimeout(res, 5000));
    } catch (e) {
      console.error("[worker] loop error:", (e as Error).message);
      if (once) return;
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
}
console.log(`[worker] started (concurrency=${concurrency})`);
await Promise.all(Array.from({ length: concurrency }, (_, i) => loop(i)));
console.log("[worker] stopped");
