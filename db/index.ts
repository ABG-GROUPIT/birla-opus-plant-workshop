import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

const CREATE_WORKSHOP_SUBMISSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS workshop_submissions (
  id text PRIMARY KEY NOT NULL,
  plant text NOT NULL,
  submitter_name text DEFAULT '' NOT NULL,
  submitter_email text DEFAULT '' NOT NULL,
  use_case_1 text DEFAULT '' NOT NULL,
  use_case_2 text DEFAULT '' NOT NULL,
  use_case_3 text DEFAULT '' NOT NULL,
  use_case_4 text DEFAULT '' NOT NULL,
  value_stream_1_selected integer DEFAULT 0 NOT NULL,
  value_stream_2_selected integer DEFAULT 0 NOT NULL,
  value_stream_3_selected integer DEFAULT 0 NOT NULL,
  value_stream_4_selected integer DEFAULT 0 NOT NULL,
  expected_benefits text DEFAULT '' NOT NULL,
  status text DEFAULT 'draft' NOT NULL,
  is_visible integer DEFAULT 0 NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  submitted_at text,
  reviewed_at text,
  CONSTRAINT workshop_submissions_plant_check CHECK (plant in ('Panipat', 'Ludhiana', 'Cheyyar', 'Chamarajanagar', 'Mahad', 'Kharagpur')),
  CONSTRAINT workshop_submissions_status_check CHECK (status in ('draft', 'submitted', 'approved', 'rejected')),
  CONSTRAINT workshop_submissions_visibility_check CHECK (is_visible in (0, 1))
)`;

const CREATE_PLANT_INDEX =
  "CREATE INDEX IF NOT EXISTS workshop_submissions_plant_idx ON workshop_submissions (plant)";
const CREATE_STATUS_VISIBILITY_INDEX =
  "CREATE INDEX IF NOT EXISTS workshop_submissions_status_visibility_idx ON workshop_submissions (status, is_visible)";
const CREATE_CREATED_AT_INDEX =
  "CREATE INDEX IF NOT EXISTS workshop_submissions_created_at_idx ON workshop_submissions (created_at)";

const initializationByBinding = new WeakMap<D1Database, Promise<void>>();

function getD1Binding(): D1Database {
  const database = env.DB as D1Database | undefined;

  if (!database) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return database;
}

/**
 * Lazily initializes a fresh local/preview D1 database before any statement is
 * prepared. Migrations remain the source of truth for hosted deployments; the
 * idempotent initialization also makes first-request development reliable.
 */
export async function getDatabase(): Promise<D1Database> {
  const database = getD1Binding();
  const existingInitialization = initializationByBinding.get(database);

  if (existingInitialization) {
    await existingInitialization;
    return database;
  }

  const initialization: Promise<void> = database
    .batch([
      database.prepare(CREATE_WORKSHOP_SUBMISSIONS_TABLE),
      database.prepare(CREATE_PLANT_INDEX),
      database.prepare(CREATE_STATUS_VISIBILITY_INDEX),
      database.prepare(CREATE_CREATED_AT_INDEX),
    ])
    .then(() => undefined)
    .catch((error: unknown) => {
      initializationByBinding.delete(database);
      throw error;
    });
  initializationByBinding.set(database, initialization);

  await initialization;
  return database;
}

/** Retained for Drizzle-based reads in starter examples and future routes. */
export function getDb() {
  return drizzle(getD1Binding(), { schema });
}
