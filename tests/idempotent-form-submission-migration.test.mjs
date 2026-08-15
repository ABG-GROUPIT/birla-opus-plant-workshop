import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608150006_idempotent_form_submission.sql",
  import.meta.url,
);

test("adds a private unique client retry key and payload digest", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /add column if not exists client_submission_id uuid/);
  assert.match(migration, /add column if not exists client_payload_sha256 text/);
  assert.match(
    migration,
    /create unique index if not exists workshop_submissions_client_submission_id_uidx/,
  );
  assert.match(migration, /client_payload_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
});

test("serializes retries and returns the original row only for an exact replay", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /workshop_submit_single_use_case_idempotent/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /hashtextextended\(p_client_submission_id::text, 0\)/);
  assert.match(migration, /extensions\.digest\(/);
  assert.match(migration, /where response\.client_submission_id = p_client_submission_id/);
  assert.match(
    migration,
    /submission\.client_payload_sha256 is distinct from payload_sha256/,
  );
  assert.match(migration, /errcode = '23505'/);
  assert.match(migration, /workshop_private\.submission_json\(submission\)/);
});

test("keeps the legacy RPC available while granting only the idempotent route to anon", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /public\.workshop_submit_with_references\(/);
  assert.doesNotMatch(migration, /drop function/);
  assert.match(
    migration,
    /revoke all on function public\.workshop_submit_single_use_case_idempotent[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.workshop_submit_single_use_case_idempotent[\s\S]*to anon/,
  );
});
