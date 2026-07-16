import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const canvasUrl = new URL("../app/workshop-canvas.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);

test("keeps presentation selection stable across live refreshes", async () => {
  const canvas = await readFile(canvasUrl, "utf8");

  assert.match(canvas, /selectedResponseId/);
  assert.match(canvas, /latestRequestRef/);
  assert.match(canvas, /refreshInFlightRef/);
  assert.match(canvas, /requestId !== latestRequestRef\.current/);
  assert.match(canvas, /left\.id\.localeCompare\(right\.id\)/);
  assert.match(canvas, /onResponseChange\(plantResponses\[nextIndex\]\.id\)/);
});

test("renders eight named value streams while retaining numbered wire codes", async () => {
  const canvas = await readFile(canvasUrl, "utf8");

  for (const label of [
    "Productivity",
    "Quality",
    "Process Optimization",
    "Reliability",
    "Energy Efficiency",
    "Safety",
    "Sustainability",
    "Supply Chain",
  ]) {
    assert.match(canvas, new RegExp(`"${label}"`));
  }
  assert.match(
    canvas,
    /const VALUE_STREAM_LABELS = \[\s*"Productivity",\s*"Quality",\s*"Process Optimization",\s*"Reliability",\s*"Energy Efficiency",\s*"Safety",\s*"Sustainability",\s*"Supply Chain",\s*\] as const;/,
  );
  assert.match(canvas, /"Value Stream 8"/);
  assert.match(canvas, /\^\[1-8\]\$/);
  assert.match(canvas, /String\(VALUE_STREAMS\.indexOf\(form\.valueStreams\[0\]\) \+ 1\)/);
  assert.match(canvas, /function valueStreamWireCode/);
  assert.match(canvas, /valueStreamIndex\(submission\.valueStreams\[0\] \?\? ""\)/);
  assert.doesNotMatch(canvas, /VALUE_STREAMS\.indexOf\(stream\) \+ 1/);
});

test("provides independent readable regions for long workbook copy", async () => {
  const [canvas, css] = await Promise.all([
    readFile(canvasUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(canvas, /function PresentationScrollRegion/);
  assert.match(canvas, /responseKey=\{response\.id\}/);
  assert.match(canvas, /Scroll for more ↓/);
  assert.match(canvas, /aria-label=\{label\}/);
  assert.match(canvas, /Workbook entry/);
  assert.match(canvas, /· Entry /);
  assert.match(canvas, /response\.useCaseTitle\.length > 120 \? "long-copy"/);

  assert.match(css, /\.response-stage-compact\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 0\.82fr\) minmax\(0, 1\.18fr\)/);
  assert.match(css, /\.selected-use-case-description\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*pre-wrap;/);
  assert.match(css, /\.expected-benefits-copy\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*pre-wrap;/);
  assert.match(css, /\.scroll-more-cue\s*\{/);
  assert.match(css, /\.selected-use-case-heading h2\.long-copy\s*\{/);
  assert.match(css, /minmax\(160px, min\(38vh, 280px\)\)/);
  assert.match(css, /max-height:\s*52vh;/);
});
