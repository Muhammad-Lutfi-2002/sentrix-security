import { z } from "zod";

// Validates Supabase configuration with actionable errors. The secret key is optional here and
// only required by code paths that call requireServiceConfig() (worker, trusted server tasks).
const publicSchema = z.object({
  SUPABASE_URL: z.string().url("SUPABASE_URL must be the project URL, e.g. https://<ref>.supabase.co"),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20, "SUPABASE_PUBLISHABLE_KEY is missing or too short"),
});

export function getSupabasePublicConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = publicSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Supabase is not configured:\n${lines.join("\n")}\nFind both values in Supabase Dashboard > Project Settings > API Keys.`,
    );
  }
  return { url: parsed.data.SUPABASE_URL, publishableKey: parsed.data.SUPABASE_PUBLISHABLE_KEY };
}

/** Server-only. Never import this module from code that is bundled for the browser. */
export function requireServiceConfig(env: Record<string, string | undefined> = process.env) {
  const base = getSupabasePublicConfig(env);
  const key = env.SUPABASE_SECRET_KEY;
  if (!key || key.length < 20) {
    throw new Error("SUPABASE_SECRET_KEY is required for this server-side operation (Dashboard > Project Settings > API Keys > secret key). Never expose it to the browser.");
  }
  return { ...base, secretKey: key };
}
