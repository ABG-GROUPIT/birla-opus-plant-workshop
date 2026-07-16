import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKBOOK_VALUE_STREAMS,
  parseWorkbookSheets,
  toImportPayloadEntry,
} from "../scripts/workbook-import-mapping.mjs";

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
  ]);

  assert.equal(result.publishableEntries.length, 1);
  const [entry] = result.publishableEntries;
  assert.equal(entry.submitterName, "");
  assert.equal(entry.useCaseTitle, "EQUIBOT – Equipment troubleshooting");
  assert.equal(entry.useCaseDescription.match(/Equipment operation/g)?.length, 1);
  assert.equal(entry.sourceKey, "excel-v1|panipat|1");
  assert.match(entry.warnings.join(" "), /left blank/i);
});

test("maps a standard plant row and blocks an incomplete row from publishing", () => {
  const result = parseWorkbookSheets([
    {
      name: "Cheyyar (tamil nadu)",
      values: [
        ["Sr No.", "Name", "Use Case Theme", "Use Case Description", "Value Streams", "Expected Benefits"],
        [1, "Rajakumar M", "Filler analytics", "Long description", "Quality", "Higher accuracy"],
        [2, "Rajakumar M", "Warehouse analytics", "Long description", "", "Fewer errors"],
      ],
    },
  ]);

  assert.equal(result.entries.length, 2);
  assert.equal(result.publishableEntries.length, 1);
  assert.equal(result.incompleteEntries.length, 1);
  assert.deepEqual(result.incompleteEntries[0].missingFields, ["valueStream"]);
  assert.equal(result.publishableEntries[0].submitterName, "Rajakumar M");
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
    "expectedBenefits",
  ]);
  assert.equal(payload.sourceSerial, "UC-17");
  assert.equal(payload.sourceKey, "excel-v1|kharagpur|uc-17");
});
