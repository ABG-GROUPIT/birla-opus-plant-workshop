import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const canvasUrl = new URL("../app/workshop-canvas.tsx", import.meta.url);

test("ends an admin session explicitly and clears tab-local access state", async () => {
  const canvas = await readFile(canvasUrl, "utf8");

  assert.match(canvas, /End admin session/);
  assert.match(canvas, /window\.sessionStorage\.removeItem\(ADMIN_CAPABILITY_KEY\)/);
  assert.match(canvas, /setCapability\(null\)/);
  assert.match(canvas, /setSubmissions\(\[\]\)/);
  assert.match(canvas, /adminRequestRef\.current \+= 1/);
  assert.match(canvas, /requestId !== adminRequestRef\.current/);
  assert.match(canvas, /Admin session ended on this tab/);
});

test("invalid admin capability errors end the session across admin operations", async () => {
  const canvas = await readFile(canvasUrl, "utf8");

  assert.match(canvas, /error instanceof BrowserSubmissionApiError && error\.code === "28000"/);
  assert.match(canvas, /This admin session is no longer valid/);
  assert.ok(
    (canvas.match(/onCapabilityError/g) ?? []).length >= 6,
    "queue mutations and reference mutations should share capability recovery",
  );
  assert.match(canvas, /if \(handleCapabilityError\(error\)\) return false/);
  assert.match(canvas, /if \(onCapabilityError\(updateError\)\) return/);
  assert.match(canvas, /if \(!onCapabilityError\(error\)\)/);
});
