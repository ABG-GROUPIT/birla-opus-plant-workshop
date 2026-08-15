import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608150007_private_reference_delivery.sql",
  import.meta.url,
);
const functionUrl = new URL(
  "../supabase/functions/workshop-reference-access/index.ts",
  import.meta.url,
);
const functionConfigUrl = new URL("../supabase/config.toml", import.meta.url);
const browserApiUrl = new URL("../lib/browser-submission-api.ts", import.meta.url);

test("makes reference Storage private and authorizes every file read", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /update storage\.buckets[\s\S]*set public = false[\s\S]*workshop-references/i);
  assert.match(migration, /workshop_reference_access\([\s\S]*p_reference_id uuid[\s\S]*p_capability text/i);
  assert.match(migration, /reference_is_visible = true/);
  assert.match(migration, /response_status = 'approved'/);
  assert.match(migration, /response_is_visible = true/);
  assert.match(migration, /require_admin_capability\(p_capability\)/);
  assert.match(migration, /grant execute on function public\.workshop_reference_access\(uuid, text\)[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]{0,160}workshop_reference_access[\s\S]{0,80}to anon/i);
});

test("streams private objects through a no-store server-side function", async () => {
  const [source, config, browserApi] = await Promise.all([
    readFile(functionUrl, "utf8"),
    readFile(functionConfigUrl, "utf8"),
    readFile(browserApiUrl, "utf8"),
  ]);

  assert.match(config, /\[functions\.workshop-reference-access\][\s\S]*verify_jwt = false/);
  assert.match(source, /withSupabase\(\{ auth: "none" \}/);
  assert.match(source, /adminClient\.rpc\("workshop_reference_access"/);
  assert.match(source, /adminClient[\s\S]*\.storage[\s\S]*\.download\(authorized\.objectPath\)/);
  assert.match(source, /export default \{ fetch: handleRequest \}/);
  assert.match(source, /cache-control[\s\S]*private, no-store/);
  assert.match(source, /p_capability: isAdminRequest \? capability : null/);
  assert.match(browserApi, /functions\/v1\/\$\{REFERENCE_ACCESS_FUNCTION\}/);
  assert.doesNotMatch(browserApi, /storage\/v1\/object\/public/);
  assert.doesNotMatch(browserApi, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(browserApi, /SUPABASE_SECRET_KEYS/);
});
