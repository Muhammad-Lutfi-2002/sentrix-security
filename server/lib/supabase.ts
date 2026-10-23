// Supabase clients. Server-only: never import from app/ (browser) code.
//  - supabaseForEvent(): cookie-bound client for the signed-in user (official @supabase/ssr pattern).
//  - supabaseForToken(): user-context client built from the verified session's access token; RLS applies.
//  - supabaseAdmin(): service client. Use ONLY for narrow trusted tasks (worker, verification) after
//    explicit authorization checks. Nothing in the request path should need it.
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { parseCookies, setCookie, type H3Event } from "h3";

import { getSupabasePublicConfig, requireServiceConfig } from "./supabase-config.js";

export function supabaseForEvent(event: H3Event) {
  const { url, publishableKey } = getSupabasePublicConfig();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => Object.entries(parseCookies(event)).flatMap(([name, value]) => (value === undefined ? [] : [{ name, value }])),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          setCookie(event, name, value, { ...options, httpOnly: true, sameSite: "lax", secure: event.url.protocol === "https:" });
        }
      },
    },
  });
}

export function supabaseForToken(accessToken: string) {
  const { url, publishableKey } = getSupabasePublicConfig();
  return createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function supabaseAdmin() {
  const { url, secretKey } = requireServiceConfig();
  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
