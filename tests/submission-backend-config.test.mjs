import assert from "node:assert/strict";
import test from "node:test";

import { parseSubmissionBackendConfig } from "../lib/submission-backend-config.ts";

test("uses D1 when no production credentials are configured", () => {
  const config = parseSubmissionBackendConfig({});
  assert.equal(config.requestedStorage, "auto");
  assert.equal(config.selectedStorage, "d1");
  assert.equal(config.supabase, null);
  assert.equal(config.googleSheetsMirror, null);
});

test("selects Supabase when both server credentials are configured", () => {
  const config = parseSubmissionBackendConfig({
    SUPABASE_URL: "https://example.supabase.co/",
    SUPABASE_SECRET_KEY: "sb_secret_server_only",
  });

  assert.equal(config.selectedStorage, "supabase");
  assert.deepEqual(config.supabase, {
    url: "https://example.supabase.co",
    secretKey: "sb_secret_server_only",
  });
});

test("fails fast instead of silently falling back on partial Supabase config", () => {
  assert.throws(
    () =>
      parseSubmissionBackendConfig({
        SUBMISSIONS_STORAGE: "supabase",
        SUPABASE_URL: "https://example.supabase.co",
      }),
    /requires both SUPABASE_URL and SUPABASE_SECRET_KEY/,
  );
});

test("requires a shared secret for the optional Sheets webhook", () => {
  assert.throws(
    () =>
      parseSubmissionBackendConfig({
        GOOGLE_SHEETS_WEBHOOK_URL:
          "https://script.google.com/macros/s/example/exec",
      }),
    /requires both GOOGLE_SHEETS_WEBHOOK_URL and GOOGLE_SHEETS_WEBHOOK_SECRET/,
  );
});

