import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PLANT_NAMES } from "../lib/submission-domain.ts";

const migrationUrl = new URL(
  "../supabase/migrations/202607160004_single_use_case_head_office.sql",
  import.meta.url,
);

test("adds Head Office as the seventh workshop entity", () => {
  assert.deepEqual(PLANT_NAMES, [
    "Panipat",
    "Ludhiana",
    "Cheyyar",
    "Chamarajanagar",
    "Mahad",
    "Kharagpur",
    "Head Office (Mumbai)",
  ]);
});

test("migrates to one titled use case while retaining legacy compatibility", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /add column if not exists use_case_title/);
  assert.match(migration, /add column if not exists use_case_theme/);
  assert.match(migration, /when btrim\(response\.use_case_1\) <> '' then 'Use Case 1'/);
  assert.match(
    migration,
    /where btrim\(response\.use_case_title\) = ''\s+and btrim\(response\.use_case_theme\) = ''/,
  );
  assert.match(migration, /sync_workshop_single_use_case/);
  assert.match(migration, /create or replace function workshop_private\.validate_submission_input/);
  assert.match(migration, /'Head Office \(Mumbai\)'/);
  assert.match(migration, /char_length\(btrim\(use_case_title\)\) <= 200/);
  assert.match(migration, /char_length\(btrim\(use_case_theme\)\) <= 2000/);
});

test("exposes reference-aware submit and admin RPCs for the new contract", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /workshop_submit_single_use_case_with_references/);
  assert.match(migration, /workshop_admin_single_use_case_update/);
  assert.match(migration, /public\.workshop_submit_with_references/);
  assert.match(migration, /public\.workshop_admin_update/);
  assert.match(migration, /'useCaseTitle', listed\.use_case_title/);
  assert.match(migration, /'useCaseTheme', listed\.use_case_theme/);
  assert.match(migration, /'createdAt', listed\.created_at/);
  assert.match(migration, /if described_count > 1 then/);
  assert.match(migration, /listed\.plant,[\s\S]*lower\(btrim\(listed\.use_case_title\)\)/);
  assert.match(
    migration,
    /grant execute on function public\.workshop_submit_single_use_case_with_references[\s\S]*to anon/,
  );
});
