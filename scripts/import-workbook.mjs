import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  parseWorkbookSheets,
  toImportPayloadEntry,
} from "./workbook-import-mapping.mjs";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function hasOption(name) {
  return process.argv.includes(name);
}

function requiredEnvironment(name, fallbacks = []) {
  for (const candidate of [name, ...fallbacks]) {
    const value = process.env[candidate]?.trim();
    if (value) return value;
  }
  throw new Error(`${name} is required for --commit.`);
}

const inspectionPath = optionValue("--inspection");
const workbookPath = optionValue("--source");
const shouldCommit = hasOption("--commit");
const shouldPublish = hasOption("--publish");

if (!inspectionPath || !workbookPath) {
  throw new Error(
    "Usage: node scripts/import-workbook.mjs --inspection <inspection.json> --source <workbook.xlsx> [--commit] [--publish]",
  );
}

const [inspectionText, workbookBytes] = await Promise.all([
  fs.readFile(path.resolve(inspectionPath), "utf8"),
  fs.readFile(path.resolve(workbookPath)),
]);
const inspection = JSON.parse(inspectionText);
if (!Array.isArray(inspection.sheets)) {
  throw new Error("The inspection file does not contain a sheets array.");
}
if (path.extname(workbookPath).toLocaleLowerCase("en-IN") !== ".xlsx") {
  throw new Error("Only macro-free .xlsx workbooks are accepted.");
}
if (workbookBytes.length > 20 * 1024 * 1024) {
  throw new Error("The workbook exceeds the 20 MB import limit.");
}

const formulaCount = inspection.sheets.reduce((sheetTotal, sheet) => {
  const formulas = Array.isArray(sheet.formulas) ? sheet.formulas : [];
  return sheetTotal + formulas.slice(1).reduce((rowTotal, row) => {
    const cells = Array.isArray(row) ? row.slice(1, 6) : [];
    return rowTotal + cells.filter((value) => String(value ?? "").trim()).length;
  }, 0);
}, 0);
if (formulaCount > 0) {
  throw new Error(
    `The workbook contains ${formulaCount} formula-backed response cells. Replace them with values before importing.`,
  );
}

const parsed = parseWorkbookSheets(
  inspection.sheets.map((sheet) => ({ name: sheet.name, values: sheet.values })),
);
const workbookHash = createHash("sha256").update(workbookBytes).digest("hex");
const sourceName = path.basename(workbookPath);
if (parsed.entries.length > 500) {
  throw new Error("The workbook contains more than the 500-entry batch limit.");
}
const byPlant = Object.fromEntries(
  [...new Set(parsed.entries.map((entry) => entry.plant))].map((plant) => [
    plant,
    parsed.entries.filter((entry) => entry.plant === plant).length,
  ]),
);
const publishableByPlant = Object.fromEntries(
  [...new Set(parsed.publishableEntries.map((entry) => entry.plant))].map((plant) => [
    plant,
    parsed.publishableEntries.filter((entry) => entry.plant === plant).length,
  ]),
);
const warnings = [
  ...parsed.workbookWarnings.map((message) => ({ sourceKey: null, message })),
  ...parsed.entries.flatMap((entry) =>
    entry.warnings.map((message) => ({ sourceKey: entry.sourceKey || null, message })),
  ),
];

const preflight = {
  mode: shouldCommit ? "commit" : "dry-run",
  sourceName,
  workbookHash,
  rowsFound: parsed.entries.length,
  rowsPublishable: parsed.publishableEntries.length,
  rowsIncomplete: parsed.incompleteEntries.length,
  warningCount: warnings.length,
  byPlant,
  publishableByPlant,
  warnings,
  incomplete: parsed.incompleteEntries.map((entry) => ({
    sourceKey: entry.sourceKey,
    plant: entry.plant,
    title: entry.useCaseTitle,
    missingFields: entry.missingFields,
  })),
};

if (!shouldCommit) {
  console.log(JSON.stringify(preflight, null, 2));
  process.exit(0);
}

const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL", ["SUPABASE_URL"])
  .replace(/\/+$/u, "");
const publishableKey = requiredEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", [
  "SUPABASE_PUBLISHABLE_KEY",
]);
const adminCapability = requiredEnvironment("BIRLA_OPUS_ADMIN_CAPABILITY");

const rows = parsed.publishableEntries.map(toImportPayloadEntry);

const response = await fetch(
  `${supabaseUrl}/rest/v1/rpc/workshop_admin_excel_batch_import`,
  {
    method: "POST",
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${publishableKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_capability: adminCapability,
      p_workbook_sha256: workbookHash,
      p_file_name: sourceName,
      p_entries: rows,
      p_publish: shouldPublish,
    }),
  },
);

const responseText = await response.text();
let payload;
try {
  payload = responseText ? JSON.parse(responseText) : null;
} catch {
  payload = { message: responseText };
}

if (!response.ok) {
  const message = payload?.message ?? payload?.error ?? `Import failed with HTTP ${response.status}.`;
  throw new Error(message);
}

console.log(JSON.stringify({ preflight, result: payload }, null, 2));
