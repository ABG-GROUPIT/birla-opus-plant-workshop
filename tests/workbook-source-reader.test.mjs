import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as XLSXModule from "@e965/xlsx";

import {
  readWorkbookSource,
  workbookSafetyFindings,
} from "../scripts/workbook-source-reader.mjs";

const XLSX = XLSXModule.default ?? XLSXModule;
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
  "Use Case Theme (100 charac)",
  "Use Case Description",
  "Value Streams (Please Select DROP DOWN)",
  "Expected Benefits",
];

async function writeWorkbook({ formula = false, merge = false, hidden = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "birla-workbook-reader-"));
  const workbookPath = path.join(directory, "synthetic-workshop.xlsx");
  const workbook = XLSX.utils.book_new();

  for (const [index, name] of SHEETS.entries()) {
    const worksheet = XLSX.utils.aoa_to_sheet([
      HEADERS,
      [1, "Fictional Leader", "Synthetic use case", "Synthetic description", "Quality", "Synthetic benefit"],
    ]);
    if (formula && index === 0) worksheet.B2 = { t: "n", f: "1+1", v: 2 };
    if (merge && index === 0) worksheet["!merges"] = [XLSX.utils.decode_range("A5:B5")];
    if (hidden && index === 0) {
      worksheet["!rows"] = [{}, { hidden: true }];
      worksheet["!cols"] = [{}, {}, { hidden: true }];
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }

  await fs.writeFile(
    workbookPath,
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  );
  return { directory, workbookPath };
}

test("reads one workbook into a source-bound inspection", async (t) => {
  const fixture = await writeWorkbook();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));

  const inspection = await readWorkbookSource(fixture.workbookPath);
  assert.equal(inspection.sheets.length, 7);
  assert.match(inspection.workbookHash, /^[a-f0-9]{64}$/);
  assert.equal(inspection.sourceName, "synthetic-workshop.xlsx");
  assert.equal(inspection.hasVba, false);
  assert.ok(inspection.packageEntryCount > 0);
  assert.ok(inspection.packageUncompressedBytes > 0);
  assert.deepEqual(workbookSafetyFindings(inspection), { errors: [], warnings: [] });
});

test("blocks populated hidden rows and columns", async (t) => {
  const fixture = await writeWorkbook({ hidden: true });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));

  const findings = workbookSafetyFindings(await readWorkbookSource(fixture.workbookPath));
  assert.ok(findings.errors.some((message) => /populated hidden rows/i.test(message)));
  assert.ok(findings.errors.some((message) => /populated hidden columns/i.test(message)));
});

test("blocks formula-backed and merged response workbooks", async (t) => {
  const fixture = await writeWorkbook({ formula: true, merge: true });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));

  const findings = workbookSafetyFindings(await readWorkbookSource(fixture.workbookPath));
  assert.ok(findings.errors.some((message) => /formula-backed response cells/i.test(message)));
  assert.ok(findings.errors.some((message) => /merged cells/i.test(message)));
});

test("rejects macro-enabled and legacy workbook extensions", async (t) => {
  const fixture = await writeWorkbook();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const macroPath = path.join(fixture.directory, "synthetic-workshop.xlsm");
  await fs.copyFile(fixture.workbookPath, macroPath);

  await assert.rejects(
    readWorkbookSource(macroPath),
    /Only macro-free \.xlsx workbooks are accepted/i,
  );
});
