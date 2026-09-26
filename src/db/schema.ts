import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import type { VideoDoc } from "@/core/types";
import type { Composition } from "@/core/types";

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  doc: jsonb("doc").$type<VideoDoc>(),
  width: integer("width"),
  height: integer("height"),
  durationFrames: integer("duration_frames"),
  templateId: text("template_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sceneGraphs = pgTable("scene_graphs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  doc: jsonb("doc").$type<VideoDoc>().notNull(),
  version: integer("version").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const presets = pgTable("presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind"),
  category: text("category"),
  nodeType: text("node_type"),
  data: jsonb("data").notNull(),
  tags: jsonb("tags").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  data: jsonb("data").notNull(),
});

/** Validated, data-only scene graphs saved from the studio. */
export const studioCompositions = pgTable("studio_compositions", {
  compositionId: text("composition_id").primaryKey(),
  name: text("name").notNull(),
  data: jsonb("data").$type<Composition>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
