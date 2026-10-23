import { defineEventHandler, setResponseHeader } from "h3";

import { loginPageHtml } from "../lib/auth-pages.js";
import { signupEnabled } from "../lib/auth-handlers.js";

export default defineEventHandler((event) => {
  setResponseHeader(event, "content-type", "text/html; charset=utf-8");
  setResponseHeader(event, "cache-control", "no-store");
  return loginPageHtml({ signupEnabled: signupEnabled() });
});
