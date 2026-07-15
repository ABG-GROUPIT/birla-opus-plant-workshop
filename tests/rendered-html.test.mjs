import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the compact Birla Opus presentation experience", async () => {
  const canvas = await readFile(
    new URL("../app/workshop-canvas.tsx", import.meta.url),
    "utf8",
  );
  assert.match(canvas, /One workshop/);
  assert.match(canvas, /Six points of view/);
  assert.match(canvas, /Chosen use case/);
  assert.match(canvas, /Selected value stream/);
  assert.match(canvas, /Primary workshop outcome/);
  assert.match(canvas, /Designation \/ role/);
  assert.match(canvas, /Recorded automatically on submission/);
  assert.match(canvas, /Draft saved on this device/);
  assert.match(canvas, /Edit response/);
  assert.match(canvas, /Approve response/);
  assert.match(canvas, /Reject response/);
  assert.match(canvas, /SubmissionView/);
  assert.match(canvas, /ReviewView/);
  assert.match(canvas, /PresentationView/);
  for (const plant of [
    "Panipat",
    "Ludhiana",
    "Cheyyar",
    "Chamarajanagar",
    "Mahad",
    "Kharagpur",
  ]) {
    assert.match(canvas, new RegExp(plant));
  }
  assert.doesNotMatch(canvas, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("separates presentation, leader submission, and admin review routes", async () => {
  const [hosting, page, submitPage, adminPage, layout, packageJson] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/submit/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(hosting, /"d1"\s*:\s*"DB"/);
  assert.match(page, /WorkshopPresentation/);
  assert.doesNotMatch(page, /LeaderSubmission|AdminReview|\/submit|\/admin/);
  assert.match(submitPage, /LeaderSubmission/);
  assert.doesNotMatch(submitPage, /AdminReview|WorkshopPresentation/);
  assert.match(adminPage, /AdminReview/);
  assert.doesNotMatch(adminPage, /LeaderSubmission|WorkshopPresentation/);
  assert.match(layout, /Birla Opus Plant Workshop Canvas/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page + layout, /codex-preview|_sites-preview/);
});
