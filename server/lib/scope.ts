import { AsyncLocalStorage } from "node:async_hooks";
import { fail } from "@agent-native/core/action";
import type { H3Event } from "h3";

import { supabaseForEvent } from "./supabase.js";

const als = new AsyncLocalStorage<H3Event>();
export const bindEvent = (event: H3Event) => als.enterWith(event);
export const currentEvent = () => als.getStore();

export type UserClient = ReturnType<typeof supabaseForEvent>;
export interface UserScope {
  sb: UserClient;
  userId: string;
  email: string;
  workspaceId: string | null;
  workspaceName: string | null;
  role: string | null;
}

/** Verified identity (JWT signature checked) + the user's current workspace. Never trusts client-supplied ids. */
export async function userScope(): Promise<UserScope> {
  const event = currentEvent();
  if (!event) fail("Authentication required", { statusCode: 401 });
  const sb = supabaseForEvent(event);
  const { data, error } = await sb.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) fail("Authentication required", { statusCode: 401 });
  const { data: rows, error: mErr } = await sb
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name)")
    .eq("user_id", claims.sub)
    .order("created_at", { ascending: true })
    .limit(1);
  if (mErr) fail("Could not load workspace", { statusCode: 500 });
  const m = rows?.[0] as { workspace_id: string; role: string; workspaces: { name: string } | { name: string }[] | null } | undefined;
  const ws = Array.isArray(m?.workspaces) ? m?.workspaces[0] : m?.workspaces;
  return {
    sb, userId: claims.sub, email: String(claims.email ?? ""),
    workspaceId: m?.workspace_id ?? null, workspaceName: ws?.name ?? null, role: m?.role ?? null,
  };
}

export async function requireWorkspace(): Promise<UserScope & { workspaceId: string; role: string }> {
  const s = await userScope();
  if (!s.workspaceId || !s.role) fail("No workspace yet. Create one first.", { statusCode: 409, errorCode: "no_workspace" });
  return s as UserScope & { workspaceId: string; role: string };
}

/** Translate Postgres/PostgREST errors into safe action failures. Our trigger messages are intentionally user-readable. */
export function dbFail(error: { code?: string; message?: string } | null | undefined, fallback = "Request failed"): never {
  const code = error?.code ?? "";
  if (code === "42501" || code === "PGRST301") fail(error?.message?.includes("row-level security") ? "You do not have permission to do that." : (error?.message ?? "Forbidden"), { statusCode: 403 });
  if (code === "23514" || code === "23505" || code === "23503") fail(code === "23505" ? "That already exists." : (error?.message ?? fallback), { statusCode: 409 });
  if (code === "PGRST116") fail("Not found", { statusCode: 404 });
  fail(fallback, { statusCode: 500 });
}
