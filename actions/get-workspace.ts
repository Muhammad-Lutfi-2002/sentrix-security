import { defineAction } from "@agent-native/core/action";

import { userScope } from "../server/lib/scope.js";

export default defineAction({
  description: "Return the signed-in user's current workspace and role (null workspace means onboarding is needed).",
  http: { method: "GET" },
  run: async () => {
    const s = await userScope();
    return { user: { id: s.userId, email: s.email }, workspace: s.workspaceId ? { id: s.workspaceId, name: s.workspaceName, role: s.role } : null };
  },
});
