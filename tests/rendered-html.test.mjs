import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the complete Birla Opus workshop canvas", async () => {
  const canvas = await readFile(
    new URL("../app/workshop-canvas.tsx", import.meta.url),
    "utf8",
  );
  assert.match(canvas, /One workshop/);
  assert.match(canvas, /Six points of view/);
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

test("keeps durable storage and finished metadata configured", async () => {
  const [hosting, page, layout, packageJson] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(hosting, /"d1"\s*:\s*"DB"/);
  assert.match(page, /WorkshopCanvas/);
  assert.match(layout, /Birla Opus Plant Workshop Canvas/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page + layout, /codex-preview|_sites-preview/);
});
