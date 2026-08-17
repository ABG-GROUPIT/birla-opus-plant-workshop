import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const excelMigrationUrl = new URL(
  "../supabase/migrations/202607160005_excel_batch_import.sql",
  import.meta.url,
);
const conflictMigrationUrl = new URL(
  "../supabase/migrations/202608170009_postgrest_conflict_hardening.sql",
  import.meta.url,
);

test("converts both browser-reachable concurrency branches to explicit HTTP 409", async () => {
  const [excelMigration, conflictMigration] = await Promise.all([
    readFile(excelMigrationUrl, "utf8"),
    readFile(conflictMigrationUrl, "utf8"),
  ]);

  assert.equal(
    [...excelMigration.matchAll(/errcode\s*=\s*'40001'/gi)].length,
    2,
    "migration 005 should contain only the admin stale-write and Excel insertion concurrency branches",
  );
  assert.match(
    excelMigration,
    /workshop_admin_single_use_case_update[\s\S]*public\.workshop_admin_update\(/i,
  );
  assert.match(
    excelMigration,
    /public\.workshop_admin_excel_batch_import[\s\S]*workshop_private\.excel_batch_import\(/i,
  );

  assert.match(
    conflictMigration,
    /to_regprocedure\([\s\S]*public\.workshop_admin_update\(text,uuid,timestamp with time zone,text,text,text,text,text\[\],text,text,text\)/i,
  );
  assert.match(
    conflictMigration,
    /to_regprocedure\([\s\S]*workshop_private\.excel_batch_import\(text,text,jsonb,boolean\)/i,
  );
  assert.match(conflictMigration, /http_conflict_code constant text := '''PT409'''/i);
  assert.equal(
    [
      ...conflictMigration.matchAll(
        /legacy_occurrence_count\s*=\s*1\s+and\s+conflict_occurrence_count\s*=\s*0/gi,
      ),
    ].length,
    2,
    "each effective legacy branch must be replaced exactly once",
  );
  assert.equal(
    [
      ...conflictMigration.matchAll(
        /legacy_occurrence_count\s*=\s*0\s+and\s+conflict_occurrence_count\s*=\s*1/gi,
      ),
    ].length,
    2,
    "an already-hardened migration rerun must be a safe no-op",
  );
  assert.equal(
    [...conflictMigration.matchAll(/execute pg_catalog\.replace\(/gi)].length,
    2,
  );
  assert.doesNotMatch(conflictMigration, /errcode\s*=\s*'40[0-9A-Z]{3}'/i);
  assert.doesNotMatch(conflictMigration, /drop\s+function/i);
});

test("preserves the public/private execution boundary after function replacement", async () => {
  const migration = await readFile(conflictMigrationUrl, "utf8");

  assert.match(
    migration,
    /revoke all on function public\.workshop_admin_update\([\s\S]*from public, anon, authenticated, service_role[\s\S]*grant execute on function public\.workshop_admin_update\([\s\S]*to anon/i,
  );
  assert.match(
    migration,
    /revoke all on function workshop_private\.excel_batch_import\([\s\S]*from public, anon, authenticated, service_role/i,
  );
  assert.match(migration, /notify pgrst, 'reload schema'/i);
});
