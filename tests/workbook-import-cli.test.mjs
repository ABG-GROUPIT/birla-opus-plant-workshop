import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as XLSXModule from "@e965/xlsx";

const XLSX = XLSXModule.default ?? XLSXModule;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "import-workbook.mjs");
const SHEETS = [
  "Panipat (Haryana)",
  "Ludhiana (Punjab)",
  "Cheyyar (Tamil Nadu)",
  "Chamarajanagar (Karnataka)",
  "Mahad (Maharashtra)",
  "Kharagpur (West Bengal)",
  "Mumbai (Head Office)",
];
const HEADERS = [
  "Sr No.",
  "Name",
  "Use Case Theme",
  "Use Case Description",
  "Value Streams",
  "Expected Benefits",
];

async function fixture({ formula = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "birla-import-cli-"));
  const source = path.join(directory, "synthetic.xlsx");
  const workbook = XLSX.utils.book_new();
  SHEETS.forEach((name, index) => {
    const rows = index === 0
      ? [HEADERS, [1, "Fictional Leader", "Synthetic title", "Synthetic description", "Quality", "Synthetic benefit"]]
      : [HEADERS];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    if (formula && index === 0) worksheet.D2 = { t: "s", f: "\"Formula\"", v: "Formula" };
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  });
  await fs.writeFile(source, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  return { directory, source };
}

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("dry run creates one exclusive machine-readable report", async (t) => {
  const item = await fixture();
  t.after(() => fs.rm(item.directory, { recursive: true, force: true }));
  const report = path.join(item.directory, "preflight.json");

  const first = await run([
    "--source", item.source,
    "--report", report,
    "--panipat-layout", "standard",
  ]);
  assert.equal(first.code, 0, first.stderr);
  const payload = JSON.parse(await fs.readFile(report, "utf8"));
  assert.equal(payload.status, "passed");
  assert.equal(payload.rowsFound, 1);

  const second = await run([
    "--source", item.source,
    "--report", report,
    "--panipat-layout", "standard",
  ]);
  assert.equal(second.code, 1);
  assert.match(second.stderr, /report already exists/i);
});

test("report path can never overwrite or alias the source workbook", async (t) => {
  const item = await fixture();
  t.after(() => fs.rm(item.directory, { recursive: true, force: true }));
  const before = await fs.readFile(item.source);

  const result = await run([
    "--source", item.source,
    "--report", item.source,
    "--panipat-layout", "standard",
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must not resolve to the source workbook/i);
  assert.deepEqual(await fs.readFile(item.source), before);
});

test("formula failure is written as structured preflight evidence", async (t) => {
  const item = await fixture({ formula: true });
  t.after(() => fs.rm(item.directory, { recursive: true, force: true }));
  const report = path.join(item.directory, "formula-preflight.json");

  const result = await run([
    "--source", item.source,
    "--report", report,
    "--panipat-layout", "standard",
  ]);
  assert.equal(result.code, 2, result.stderr);
  const payload = JSON.parse(await fs.readFile(report, "utf8"));
  assert.equal(payload.status, "failed");
  assert.ok(payload.safetyErrorCount > 0);
  assert.match(payload.errors.join(" "), /formula-backed response cells/i);
});

test("commit rejects a non-Supabase or insecure origin before transport", async (t) => {
  const item = await fixture();
  t.after(() => fs.rm(item.directory, { recursive: true, force: true }));

  const result = await run(
    ["--source", item.source, "--panipat-layout", "standard", "--commit"],
    {
      NEXT_PUBLIC_SUPABASE_URL: "http://attacker.invalid",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key",
      BIRLA_OPUS_ADMIN_CAPABILITY: "S".repeat(64),
    },
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must use a hosted .*supabase\.co origin/i);
});
