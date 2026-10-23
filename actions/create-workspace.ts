import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { dbFail, userScope } from "../server/lib/scope.js";

export default defineAction({
  description: "Create the user's first workspace; the caller becomes its owner. Fails if they already belong to one.",
  schema: z.object({ name: z.string().trim().min(1).max(120).describe("Workspace name") }),
  run: async ({ name }) => {
    const s = await userScope();
    if (s.workspaceId) fail("You already belong to a workspace.", { statusCode: 409 });
    await s.sb.from("profiles").upsert({ id: s.userId, display_name: s.email.split("@")[0] }, { onConflict: "id", ignoreDuplicates: true });
    const { data, error } = await s.sb.rpc("create_workspace", { p_name: name });
    if (error) dbFail(error, "Could not create workspace");
    return { id: data as string, name, role: "owner" };
  },
});
