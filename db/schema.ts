import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const PLANT_NAMES = [
  "Panipat",
  "Ludhiana",
  "Cheyyar",
  "Chamarajanagar",
  "Mahad",
  "Kharagpur",
] as const;

export const SUBMISSION_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
] as const;

export type PlantName = (typeof PLANT_NAMES)[number];
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const workshopSubmissions = sqliteTable(
  "workshop_submissions",
  {
    id: text("id").primaryKey(),
    plant: text("plant").$type<PlantName>().notNull(),
    submitterName: text("submitter_name").notNull().default(""),
    submitterEmail: text("submitter_email").notNull().default(""),
    useCase1: text("use_case_1").notNull().default(""),
    useCase2: text("use_case_2").notNull().default(""),
    useCase3: text("use_case_3").notNull().default(""),
    useCase4: text("use_case_4").notNull().default(""),
    valueStream1Selected: integer("value_stream_1_selected", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    valueStream2Selected: integer("value_stream_2_selected", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    valueStream3Selected: integer("value_stream_3_selected", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    valueStream4Selected: integer("value_stream_4_selected", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    expectedBenefits: text("expected_benefits").notNull().default(""),
    status: text("status").$type<SubmissionStatus>().notNull().default("draft"),
    isVisible: integer("is_visible", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    submittedAt: text("submitted_at"),
    reviewedAt: text("reviewed_at"),
  },
  (table) => [
    index("workshop_submissions_plant_idx").on(table.plant),
    index("workshop_submissions_status_visibility_idx").on(
      table.status,
      table.isVisible,
    ),
    index("workshop_submissions_created_at_idx").on(table.createdAt),
    check(
      "workshop_submissions_plant_check",
      sql`${table.plant} in ('Panipat', 'Ludhiana', 'Cheyyar', 'Chamarajanagar', 'Mahad', 'Kharagpur')`,
    ),
    check(
      "workshop_submissions_status_check",
      sql`${table.status} in ('draft', 'submitted', 'approved', 'rejected')`,
    ),
    check(
      "workshop_submissions_visibility_check",
      sql`${table.isVisible} in (0, 1)`,
    ),
  ],
);

export type WorkshopSubmissionRow = typeof workshopSubmissions.$inferSelect;
