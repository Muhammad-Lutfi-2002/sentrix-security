import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { dbFail, requireWorkspace } from "../server/lib/scope.js";
import { assertPublicDestination, canonicalizeTargetUrl, TargetRejected } from "../server/lib/target-guard.js";
import { instructions } from "../server/lib/verification.js";

export default defineAction({
  description: "Register a target URL for a project. It starts unverified; prove ownership with verify-target before any assessment can be queued.",
  schema: z.object({
    projectId: z.string().uuid(),
    url: z.string().max(2048),
    environment: z.enum(["production", "staging", "development"]).default("production"),
    approvedScope: z.string().trim().max(1000).default(""),
    excludedPaths: z.array(z.string().trim().min(1).max(200).startsWith("/")).max(50).default([]),
  }),
  run: async ({ projectId, url, environment, approvedScope, excludedPaths }) => {
    const s = await requireWorkspace();
    let canonical: string;
    try {
      canonical = canonicalizeTargetUrl(url);
      await assertPublicDestination(canonical);
    } catch (e) {
      if (e instanceof TargetRejected) fail(e.message, { statusCode: 400 });
      throw e;
    }
    const { data, error } = await s.sb.from("authorized_targets")
      .insert({ workspace_id: s.workspaceId, project_id: projectId, canonical_url: canonical, environment, approved_scope: approvedScope, excluded_paths: excludedPaths, created_by: s.userId })
      .select().single();
    if (error) dbFail(error, "Could not register target");
    return { id: data.id, canonicalUrl: data.canonical_url, verificationStatus: data.verification_status, verification: instructions(data.id, data.canonical_url) };
  },
});
