import { defineEventHandler, getRequestHeader, getRequestURL, HTTPError, type H3Event } from "h3";
import { z } from "zod";

import { safeNext } from "./auth-pages.js";
import { supabaseForEvent } from "./supabase.js";

export const signupEnabled = () => process.env.SIGNUP_ENABLED === "true";

const creds = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200),
  next: z.string().max(500).optional(),
});

async function readJson(event: H3Event) {
  // Require JSON content type: blocks cross-site <form> posts (simple CSRF) since browsers cannot send it without CORS preflight.
  if (!(getRequestHeader(event, "content-type") ?? "").toLowerCase().startsWith("application/json"))
    throw new HTTPError({ status: 415, statusText: "Unsupported Media Type" });
  try { return await event.req.json(); } catch { throw new HTTPError({ status: 400, statusText: "Invalid JSON" }); }
}
const fail = (event: H3Event, status: number, message: string) => {
  event.res.status = status;
  return { ok: false, message };
};

export const loginHandler = defineEventHandler(async (event) => {
  const p = creds.safeParse(await readJson(event));
  if (!p.success) return fail(event, 400, "Enter a valid email and a password of at least 8 characters.");
  const { error } = await supabaseForEvent(event).auth.signInWithPassword({ email: p.data.email, password: p.data.password });
  // Generic message: do not reveal whether the account exists.
  if (error) return fail(event, 401, error.code === "email_not_confirmed" ? "Confirm your email address first." : "Invalid email or password.");
  return { ok: true, redirect: safeNext(p.data.next) };
});

export const registerHandler = defineEventHandler(async (event) => {
  if (!signupEnabled()) return fail(event, 403, "Registration is disabled. Ask a workspace owner for an invitation.");
  const p = creds.safeParse(await readJson(event));
  if (!p.success) return fail(event, 400, "Enter a valid email and a password of at least 8 characters.");
  const origin = getRequestURL(event).origin;
  const { data, error } = await supabaseForEvent(event).auth.signUp({
    email: p.data.email, password: p.data.password, options: { emailRedirectTo: `${origin}/api/auth/callback` },
  });
  if (error) return fail(event, 400, "Could not create the account. Try a stronger password or sign in instead.");
  if (data.session) return { ok: true, redirect: safeNext(p.data.next) };
  return { ok: true, message: "Check your email to confirm your account, then sign in." };
});

export const resetHandler = defineEventHandler(async (event) => {
  const p = z.object({ email: z.string().trim().email().max(254) }).safeParse(await readJson(event));
  if (!p.success) return fail(event, 400, "Enter a valid email.");
  const origin = getRequestURL(event).origin;
  await supabaseForEvent(event).auth.resetPasswordForEmail(p.data.email, {
    redirectTo: `${origin}/api/auth/callback?next=${encodeURIComponent("/login?mode=update")}`,
  });
  return { ok: true, message: "If that email has an account, a reset link is on its way." }; // same response either way
});

export const updatePasswordHandler = defineEventHandler(async (event) => {
  const p = z.object({ password: z.string().min(8).max(200) }).safeParse(await readJson(event));
  if (!p.success) return fail(event, 400, "Password must be at least 8 characters.");
  const sb = supabaseForEvent(event);
  const { data } = await sb.auth.getUser();
  if (!data.user) return fail(event, 401, "Reset link expired. Request a new one.");
  const { error } = await sb.auth.updateUser({ password: p.data.password });
  if (error) return fail(event, 400, "Could not update the password.");
  return { ok: true, redirect: "/" };
});

export const callbackHandler = defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (code) {
    const { error } = await supabaseForEvent(event).auth.exchangeCodeForSession(code);
    if (error) return Response.redirect(new URL("/login?error=callback", url.origin).toString(), 302);
  }
  return Response.redirect(new URL(next, url.origin).toString(), 302);
});

export const logoutHandler = defineEventHandler(async (event) => {
  await supabaseForEvent(event).auth.signOut();
  return { ok: true, redirect: "/login" };
});
