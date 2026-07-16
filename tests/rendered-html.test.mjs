import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the compact Birla Opus presentation experience", async () => {
  const canvas = await readFile(
    new URL("../app/workshop-canvas.tsx", import.meta.url),
    "utf8",
  );
  assert.match(canvas, /One workshop/);
  assert.match(canvas, /Seven points of view/);
  assert.match(canvas, /Use case title/);
  assert.match(canvas, /Theme \/ definition/);
  assert.match(canvas, /Submit a new form for every additional use case/);
  assert.match(canvas, /Use case group/);
  assert.match(canvas, /Selected value stream/);
  assert.match(canvas, /Primary workshop outcome/);
  assert.match(canvas, /Designation \/ role/);
  assert.match(canvas, /Recorded automatically on submission/);
  assert.match(canvas, /Draft saved on this device/);
  assert.match(canvas, /Edit response/);
  assert.match(canvas, /Approve response/);
  assert.match(canvas, /Reject response/);
  assert.match(canvas, /Reference media/);
  assert.match(canvas, /Add HTTPS link/);
  assert.match(canvas, /Open references/);
  assert.match(canvas, /Open in app/);
  assert.match(canvas, /Save reference/);
  assert.match(canvas, /REFERENCE_FILE_ACCEPT/);
  assert.match(canvas, /target="_blank"/);
  assert.match(canvas, /noopener noreferrer/);
  assert.match(canvas, /Refresh now/);
  assert.match(canvas, /3_000/);
  assert.match(canvas, /BroadcastChannel/);
  assert.match(canvas, /pageshow/);
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
  assert.match(canvas, /Head Office \(Mumbai\)/);
  assert.doesNotMatch(canvas, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("separates presentation, leader submission, and admin review routes", async () => {
  const [page, submitPage, adminPage, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/submit/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /WorkshopPresentation/);
  assert.doesNotMatch(page, /LeaderSubmission|AdminReview|\/submit|\/admin/);
  assert.match(submitPage, /LeaderSubmission/);
  assert.doesNotMatch(submitPage, /AdminReview|WorkshopPresentation/);
  assert.match(adminPage, /AdminReview/);
  assert.doesNotMatch(adminPage, /LeaderSubmission|WorkshopPresentation/);
  assert.match(layout, /Birla Opus Leadership Workshop Canvas/);
  assert.match(layout, /og\.png/);
  const packageConfig = JSON.parse(packageJson);
  assert.equal(packageConfig.scripts.dev, "next dev");
  assert.equal(packageConfig.scripts.build, "next build");
  assert.equal(packageConfig.scripts.start, "next start");
  assert.doesNotMatch(packageJson, /vinext|wrangler|cloudflare/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page + layout, /codex-preview|_sites-preview/);
});
