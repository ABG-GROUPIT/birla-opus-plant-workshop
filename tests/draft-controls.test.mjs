import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const canvasUrl = new URL("../app/workshop-canvas.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

test("exposes explicit save and clear controls for the device-local draft", async () => {
  const [canvas, styles] = await Promise.all([
    readFile(canvasUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(canvas, /const clearLocalDraft = \(\) =>/);
  assert.match(canvas, /localStorage\.removeItem\(LOCAL_DRAFT_KEY\)/);
  assert.match(canvas, /sessionStorage\.removeItem\(SUBMISSION_ATTEMPT_KEY\)/);
  assert.match(canvas, /submissionAttemptRef\.current = null/);
  assert.match(canvas, /setForm\(EMPTY_FORM\)/);
  assert.match(canvas, />Save draft<\/button>/);
  assert.match(canvas, />Clear draft<\/button>/);
  assert.match(canvas, /onSaved\("Local draft cleared from this device\."\)/);
  assert.match(styles, /\.form-draft-actions\s*\{[\s\S]*display: flex/);
});
