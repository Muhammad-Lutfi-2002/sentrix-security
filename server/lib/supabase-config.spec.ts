import { describe, expect, it } from "vitest";
import { getSupabasePublicConfig, requireServiceConfig } from "./supabase-config";

const ok = { SUPABASE_URL: "https://abc.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "x".repeat(20) };
describe("supabase config", () => {
  it("accepts valid public config", () => expect(getSupabasePublicConfig(ok).url).toBe("https://abc.supabase.co"));
  it("gives actionable errors when missing", () => {
    expect(() => getSupabasePublicConfig({})).toThrow(/SUPABASE_URL[\s\S]*Dashboard/);
  });
  it("requires the secret key only for privileged paths", () => {
    expect(() => requireServiceConfig(ok)).toThrow(/SUPABASE_SECRET_KEY/);
    expect(requireServiceConfig({ ...ok, SUPABASE_SECRET_KEY: "sb_secret_" + "y".repeat(20) }).secretKey).toBeTruthy();
  });
});
