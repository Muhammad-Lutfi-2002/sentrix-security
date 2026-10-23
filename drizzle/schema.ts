// DEPRECATED (SENTRIX V2): these tables belonged to the original local data layer and are NO LONGER READ OR WRITTEN
// by any action. Supabase Postgres (supabase/migrations) is the single source of truth. Kept only so the framework's
// local store keeps booting; see docs/SUPABASE_PLAN.md for the retirement plan.
import { sql } from "drizzle-orm";
import { boolean, pgTable, text } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  environment: text("environment").notNull().default("production"),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at").notNull().default(sql`now()`),
});

export const assessments = pgTable("assessments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  targetUrl: text("target_url").notNull(),
  targetAttested: boolean("target_attested").notNull().default(false),
  approvedScope: text("approved_scope").notNull().default(""),
  modules: text("modules").notNull().default(""),
  mode: text("mode").notNull().default("passive"),
  status: text("status").notNull().default("queued"),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at").notNull().default(sql`now()`),
  cancelledAt: text("cancelled_at"),
});

export const findings = pgTable("findings", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  assessmentId: text("assessment_id"),
  title: text("title").notNull(),
  severity: text("severity").notNull(),
  confidence: text("confidence").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  affectedAsset: text("affected_asset").notNull(),
  owner: text("owner").notNull().default(""),
  description: text("description").notNull().default(""),
  impact: text("impact").notNull().default(""),
  evidence: text("evidence").notNull().default(""),
  remediation: text("remediation").notNull().default(""),
  referenceLinks: text("reference_links").notNull().default(""),
  discoveredAt: text("discovered_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at").notNull().default(sql`now()`),
});

export const activityEvents = pgTable("activity_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  assessmentId: text("assessment_id"),
  findingId: text("finding_id"),
  createdAt: text("created_at").notNull().default(sql`now()`),
});
