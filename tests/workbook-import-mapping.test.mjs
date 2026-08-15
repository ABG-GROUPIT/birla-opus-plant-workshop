import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKBOOK_VALUE_STREAMS,
  inferValueStream,
  parseWorkbookSheets,
  toImportPayloadEntry,
  validateImportEntries,
  validateWorkbookSchema,
} from "../scripts/workbook-import-mapping.mjs";

const CURRENT_HEADERS = [
  "Sr No.",
  "Name",
  "Use Case Theme (100 charac)",
  "Use Case Description",
  "Value Streams (Please Select DROP DOWN)",
  "Expected Benefits",
];

const REQUIRED_SHEETS = [
  "Panipat (Haryana)",
  "Ludhiana (Punjab)",
  "Cheyyar (tamil nadu)",
  "Chamarajanagar (Karnataka)",
  "Mahad (Maharashtra)",
  "Kharagpur (West Bengal)",
  "Mumbai (Head Office)",
];

test("recognises all eight workbook value streams", () => {
  const sheets = WORKBOOK_VALUE_STREAMS.map((valueStream, index) => ({
    name: "Cheyyar (tamil nadu)",
    values: [
      ["Sr No.", "Name", "Use Case Theme", "Use Case Description", "Value Streams", "Expected Benefits"],
      [index + 1, "Leader Name", `Theme ${index + 1}`, "Description", valueStream, "Benefit"],
    ],
  }));

  for (const [index, sheet] of sheets.entries()) {
    const result = parseWorkbookSheets([sheet]);
    assert.equal(result.publishableEntries.length, 1);
    assert.equal(result.publishableEntries[0].valueStream, WORKBOOK_VALUE_STREAMS[index]);
  }
});

test("validates the complete workbook sheet and header contract", () => {
  const sheets = REQUIRED_SHEETS.map((name) => ({
    name,
    hidden: 0,
    values: [CURRENT_HEADERS],
  }));

  assert.deepEqual(validateWorkbookSchema(sheets), { errors: [], warnings: [] });
});

test("rejects missing, reordered, hidden, and extra workbook fields", () => {
  const sheets = REQUIRED_SHEETS.slice(0, -1).map((name, index) => ({
    name,
    hidden: index === 0 ? 1 : 0,
    values: [[
      ...(index === 1
        ? [CURRENT_HEADERS[1], CURRENT_HEADERS[0], ...CURRENT_HEADERS.slice(2)]
        : CURRENT_HEADERS),
      ...(index === 2 ? ["Unexpected"] : []),
    ]],
  }));
  sheets[3].values.push([1, "Leader", "Title", "Description", "Safety", "Benefit", "Hidden extra"]);

  const result = validateWorkbookSchema(sheets);
  assert.ok(result.errors.some((message) => /must be visible/i.test(message)));
  assert.ok(result.errors.some((message) => /column 1/i.test(message)));
  assert.ok(result.errors.some((message) => /after column F/i.test(message)));
  assert.ok(result.errors.some((message) => /Mumbai \(Head Office\)/i.test(message)));
});

test("ignores the one hundred serial-only template rows", () => {
  const rows = [
    ["Sr No.", "Name", "Use Case Theme", "Use Case Description", "Value Streams", "Expected Benefits"],
    ...Array.from({ length: 100 }, (_, index) => [index + 1, "", "", "", "", ""]),
  ];
  const result = parseWorkbookSheets([{ name: "Ludhiana (Punjab)", values: rows }]);
  assert.equal(result.entries.length, 0);
});

test("maps the shifted Panipat layout without inventing a contributor or duplicating text", () => {
  const repeatedDetail = "Equipment operation\nTroubleshooting\nSpare parts";
  const result = parseWorkbookSheets([
    {
      name: "Panipat (Haryana)",
      values: [
        ["Sr No.", "Name", "Use Case Theme", "Use Case Description", "Value Streams", "Expected Benefits"],
        [
          1,
          "EQUIBOT – Equipment troubleshooting",
          `AI assistant for the plant.\n${repeatedDetail}`,
          repeatedDetail,
          "Process Optimization",
          "Faster troubleshooting",
        ],
      ],
    },
  ], { panipatLayout: "shifted" });

  assert.equal(result.publishableEntries.length, 1);
  const [entry] = result.publishableEntries;
  assert.equal(entry.submitterName, "");
  assert.equal(entry.useCaseTitle, "EQUIBOT – Equipment troubleshooting");
  assert.equal(entry.useCaseDescription.match(/Equipment operation/g)?.length, 1);
  assert.equal(entry.sourceKey, "excel-v1|panipat|1");
  assert.match(entry.warnings.join(" "), /left blank/i);
  assert.equal(entry.layoutKind, "shifted");
});

test("requires an explicit Panipat layout decision for populated legacy sheets", () => {
  const result = parseWorkbookSheets([{
    name: "Panipat (Haryana)",
    values: [CURRENT_HEADERS, [1, "Leader", "Title", "Description", "Safety", "Benefit"]],
  }]);
  assert.equal(result.entries.length, 1);
  assert.match(result.workbookErrors.join(" "), /explicit layout decision/i);
});

test("maps standard rows and infers a blank value stream instead of blocking", () => {
  const result = parseWorkbookSheets([
    {
      name: "Cheyyar (tamil nadu)",
      values: [
        ["Sr No.", "Name", "Use Case Theme", "Use Case Description", "Value Streams", "Expected Benefits"],
        [1, "Rajakumar M", "Filler analytics", "Long description", "Quality", "Higher accuracy"],
        [2, "Rajakumar M", "Warehouse dispatch analytics", "Long description", "", "Fewer errors"],
      ],
    },
  ]);

  assert.equal(result.entries.length, 2);
  assert.equal(result.publishableEntries.length, 2);
  assert.equal(result.incompleteEntries.length, 0);
  assert.equal(result.publishableEntries[1].valueStream, "Supply Chain");
  assert.equal(result.publishableEntries[1].valueStreamInferred, true);
  assert.match(result.publishableEntries[1].warnings.join(" "), /was inferred/i);
  assert.equal(result.publishableEntries[0].submitterName, "Rajakumar M");
});

test("infers specialized value streams and keeps explicit workbook choices", () => {
  assert.equal(
    inferValueStream(
      "Finished goods warehouse throughput and dispatch accuracy",
      "Inventory picking, staging and truck loading",
      "Better stock accuracy",
    ),
    "Supply Chain",
  );
  assert.equal(
    inferValueStream(
      "AI-based 360 degree bucket inspection",
      "OCR and QR validation identifies defective buckets",
      "Higher quality assurance and fewer complaints",
    ),
    "Quality",
  );
  assert.equal(inferValueStream("Novel idea", "Unclassified improvement", "Benefit"), "Process Optimization");

  const explicit = parseWorkbookSheets([{
    name: "Cheyyar (Tamil Nadu)",
    values: [
      ["Sr No.", "Name", "Use Case Theme", "Use Case Description", "Value Streams", "Expected Benefits"],
      [1, "Leader", "Warehouse dispatch", "Inventory logistics", "Safety", "Fewer incidents"],
    ],
  }]).publishableEntries[0];
  assert.equal(explicit.valueStream, "Safety");
  assert.equal(explicit.valueStreamInferred, false);
});

test("derives a concise title while preserving an overlong theme in the description", () => {
  const longTheme = `${"Long manufacturing theme ".repeat(12)}ending`;
  const result = parseWorkbookSheets([
    {
      name: "Mahad (Maharashtra)",
      values: [
        ["Sr No.", "Name", "Use Case Theme", "Use Case Description", "Value Streams", "Expected Benefits"],
        [1, "Leader Name", longTheme, "Description", "Safety", "Benefit"],
      ],
    },
  ]);

  const [entry] = result.publishableEntries;
  assert.ok(entry.useCaseTitle.length <= 200);
  assert.match(entry.useCaseDescription, /Original theme:/);
  assert.match(entry.useCaseDescription, /ending/);
});

test("emits the source serial and complete worker payload contract", () => {
  const result = parseWorkbookSheets([
    {
      name: "Kharagpur (West Bengal)",
      values: [
        ["Sr No.", "Name", "Use Case Theme", "Use Case Description", "Value Streams", "Expected Benefits"],
        ["UC-17", "Leader Name", "Planning assistant", "Description", "Supply Chain", "Benefit"],
      ],
    },
  ]);

  const payload = toImportPayloadEntry(result.publishableEntries[0]);
  assert.deepEqual(Object.keys(payload), [
    "sourceKey",
    "sourceBusinessKey",
    "sourceSheet",
    "sourceRow",
    "sourceSerial",
    "plant",
    "submitterName",
    "useCaseTitle",
    "useCaseDescription",
    "valueStream",
    "valueStreamInferred",
    "expectedBenefits",
  ]);
  assert.equal(payload.sourceSerial, "UC-17");
  assert.equal(payload.sourceKey, "excel-v1|kharagpur|uc-17");
  assert.equal(result.publishableEntries[0].normalizationVersion, "excel-v1.1");
  assert.match(result.publishableEntries[0].rawColumnsSha256, /^[a-f0-9]{64}$/);
});

test("matches the database ASCII source-key contract and detects duplicate keys", () => {
  const result = parseWorkbookSheets([{
    name: "Cheyyar (Tamil Nadu)",
    values: [
      CURRENT_HEADERS,
      ["\u00c5-17", "Leader", "First", "Description", "Quality", "Benefit"],
      ["A 17", "Leader", "Second", "Description", "Quality", "Benefit"],
      ["\u2603", "Leader", "Third", "Description", "Quality", "Benefit"],
    ],
  }]);

  assert.equal(result.entries[0].sourceKey, "excel-v1|cheyyar|17");
  assert.equal(result.entries[1].sourceKey, "excel-v1|cheyyar|a-17");
  assert.equal(result.entries[2].sourceKey, "");
  assert.ok(result.entries[2].missingFields.includes("sourceKey"));

  const duplicate = { ...result.entries[1], sourceKey: result.entries[0].sourceKey };
  assert.match(
    validateImportEntries([result.entries[0], duplicate]).errors.join(" "),
    /duplicate source key/i,
  );
});

test("mirrors server field limits before commit", () => {
  const result = parseWorkbookSheets([{
    name: "Cheyyar (Tamil Nadu)",
    values: [
      CURRENT_HEADERS,
      [1, "L".repeat(121), "Title", "D".repeat(12001), "Quality", "Benefit"],
    ],
  }]);
  const errors = validateImportEntries(result.entries).errors.join(" ");
  assert.match(errors, /submitterName exceeds 120/i);
  assert.match(errors, /useCaseDescription exceeds 12000/i);
});
