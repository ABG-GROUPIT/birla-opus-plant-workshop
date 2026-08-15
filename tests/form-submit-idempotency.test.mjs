import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const formUrl = new URL("../app/workshop-canvas.tsx", import.meta.url);
const apiUrl = new URL("../lib/browser-submission-api.ts", import.meta.url);

test("keeps one client retry key for unchanged form content", async () => {
  const source = await readFile(formUrl, "utf8");

  assert.match(source, /submissionAttemptFingerprint\(form, referenceFiles\)/);
  assert.match(source, /clientSubmissionId: clientSubmissionId \|\| crypto\.randomUUID\(\)/);
  assert.match(source, /window\.sessionStorage\.getItem\(SUBMISSION_ATTEMPT_KEY\)/);
  assert.match(source, /submissionAttemptRef\.current = attempt/);
  assert.match(source, /clientSubmissionId: attempt\.clientSubmissionId/);
  assert.match(source, /submissionAttemptRef\.current = null/);
});

test("reuses completed uploads while retrying the final database call", async () => {
  const source = await readFile(formUrl, "utf8");

  assert.match(source, /attempt\.uploadedReferences === null/);
  assert.match(source, /attempt\.mediaSession = activeSession/);
  assert.match(source, /attempt\.uploadedReferences = uploadedReferences/);
  assert.match(source, /Date\.parse\(mediaSession\.expiresAt\) <= Date\.now\(\)/);
});

test("browser API sends the retry key only in the idempotent RPC body", async () => {
  const source = await readFile(apiUrl, "utf8");

  assert.match(source, /callRpc\("workshop_submit_single_use_case_idempotent"/);
  assert.match(source, /p_client_submission_id: input\.clientSubmissionId/);
  assert.doesNotMatch(source, /client_submission_id=.*(?:\?|&)/);
});
