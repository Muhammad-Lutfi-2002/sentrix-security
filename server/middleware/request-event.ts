import { defineEventHandler } from "h3";

import { bindEvent } from "../lib/scope.js";

// Makes the current request available to actions so they can build a cookie-bound, RLS-enforced
// Supabase client. Actions invoked without an HTTP request (e.g. CLI) fail closed with 401.
export default defineEventHandler((event) => {
  bindEvent(event);
});
