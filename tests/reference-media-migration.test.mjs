import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202607160003_reference_media.sql",
  import.meta.url,
);

test("keeps reference uploads capability-scoped and tightly limited", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /workshop_media_session_create/);
  assert.match(migration, /workshop_submit_with_references/);
  assert.match(migration, /workshop_admin_reference_update/);
  assert.match(migration, /workshop-references/);
  assert.match(migration, /file_size_limit[\s\S]*10485760/);
  assert.match(migration, /at most four references/i);
  assert.match(migration, /at most three uploaded files/i);
  assert.match(migration, /at most two HTTPS links/i);
  assert.match(migration, /at most 25 MiB/i);
  assert.match(migration, /token_hash = extensions\.digest/);
  assert.match(migration, /consumed_at is null/);
  assert.match(migration, /for insert\s+to anon/i);
  assert.doesNotMatch(migration, /create policy[\s\S]{0,160}for select\s+to anon/i);
  assert.doesNotMatch(
    migration,
    /pptm|docm|xlsm|application\/zip|text\/html|image\/svg\+xml|video\//i,
  );
});

test("publishes only included references from approved visible responses", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /response\.status = 'approved'/);
  assert.match(migration, /response\.is_visible = true/);
  assert.match(migration, /reference\.is_visible = true/);
  assert.match(migration, /'references'/);
});
