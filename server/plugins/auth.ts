import { createAuthPlugin } from "@agent-native/core/server";

import { supabaseForEvent } from "../lib/supabase.js";

// Supabase Auth is the identity provider (custom-session mode: framework Better Auth is not mounted).
// The session is verified on the server for every request (JWT signature via getClaims), never
// trusted from client state. The access token is exposed as session.token so actions can build a
// user-context client and let Postgres RLS enforce authorization.
export default createAuthPlugin({
  rootAuth: true,
  publicPaths: ["/login", "/api/auth/login", "/api/auth/register", "/api/auth/reset", "/api/auth/update-password", "/api/auth/callback", "/api/auth/logout"],
  loginHtml: `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/login"><a href="/login">Sign in</a>`,
  trustCustomEmailVerification: true,
  getSession: async (event) => {
    try {
      const sb = supabaseForEvent(event);
      const { data, error } = await sb.auth.getClaims();
      const claims = data?.claims;
      if (error || !claims?.sub || !claims.email) return null;
      const { data: s } = await sb.auth.getSession();
      if (!s.session?.access_token) return null;
      return {
        email: String(claims.email),
        userId: claims.sub,
        token: s.session.access_token,
        name: (claims.user_metadata as { name?: string } | undefined)?.name,
        emailVerified: true,
      };
    } catch (e) {
      console.error("[auth] supabase session resolution failed:", (e as Error).message);
      return null;
    }
  },
});
