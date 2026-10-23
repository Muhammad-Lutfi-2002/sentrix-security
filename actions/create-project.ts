import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { mapProject } from "../server/lib/mappers.js";
import { dbFail, requireWorkspace } from "../server/lib/scope.js";

export default defineAction({
  description: "Create a security assessment project in the current workspace.",
  schema: z.object({
    name: z.string().trim().min(1).max(120).describe("Project name"),
    description: z.string().max(500).optional().describe("Short description"),
    environment: z.enum(["production", "staging", "development"]).default("production").describe("Environment the project covers"),
  }),
  run: async ({ name, description, environment }) => {
    const s = await requireWorkspace();
    const { data, error } = await s.sb.from("projects")
      .insert({ workspace_id: s.workspaceId, name, description: description?.trim() ?? "", environment, created_by: s.userId })
      .select().single();
    if (error) dbFail(error, "Could not create project");
    return mapProject(data);
  },
});
