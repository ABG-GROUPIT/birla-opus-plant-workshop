import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const originalReferenceMigrationUrl = new URL(
  "../supabase/migrations/202607160003_reference_media.sql",
  import.meta.url,
);
const hardeningMigrationUrl = new URL(
  "../supabase/migrations/202608170008_live_role_and_delete_hardening.sql",
  import.meta.url,
);

test("replaces the consumed-session SET NULL conflict with a cascading foreign key", async () => {
  const [originalMigration, hardeningMigration] = await Promise.all([
    readFile(originalReferenceMigrationUrl, "utf8"),
    readFile(hardeningMigrationUrl, "utf8"),
  ]);
  const effectiveContract = `${originalMigration}\n${hardeningMigration}`;

  assert.match(originalMigration, /submission_id uuid unique[\s\S]*on delete set null/i);
  assert.match(
    hardeningMigration,
    /drop constraint reference_upload_sessions_submission_id_fkey[\s\S]*foreign key \(submission_id\)[\s\S]*references public\.workshop_submissions \(id\)[\s\S]*on delete cascade/i,
  );
  assert.match(
    hardeningMigration,
    /validate constraint reference_upload_sessions_submission_id_fkey/i,
  );
  assert.ok(
    effectiveContract.toLowerCase().lastIndexOf("on delete cascade") >
      effectiveContract.toLowerCase().lastIndexOf("on delete set null"),
    "the final upload-session deletion contract must be cascading",
  );
});

test("removes browser and service role execution from trigger-only routines", async () => {
  const hardeningMigration = await readFile(hardeningMigrationUrl, "utf8");

  assert.match(
    hardeningMigration,
    /revoke all on function public\.record_workshop_submission_audit\(\)[\s\S]*from public, anon, authenticated, service_role/i,
  );
  assert.match(
    hardeningMigration,
    /to_regprocedure\('public\.rls_auto_enable\(\)'\)[\s\S]*revoke all on function public\.rls_auto_enable\(\)[\s\S]*from public, anon, authenticated, service_role/i,
  );
  assert.doesNotMatch(hardeningMigration, /drop\s+(?:event\s+)?trigger/i);
  assert.doesNotMatch(hardeningMigration, /drop\s+function/i);
});
