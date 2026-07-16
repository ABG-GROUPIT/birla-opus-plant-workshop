export const WORKBOOK_VALUE_STREAMS = Object.freeze([
  "Productivity",
  "Quality",
  "Process Optimization",
  "Reliability",
  "Energy Efficiency",
  "Safety",
  "Sustainability",
  "Supply Chain",
]);

const SHEET_PLANTS = new Map(
  [
    ["Panipat (Haryana)", "Panipat"],
    ["Ludhiana (Punjab)", "Ludhiana"],
    ["Cheyyar (Tamil Nadu)", "Cheyyar"],
    ["Chamarajanagar (Karnataka)", "Chamarajanagar"],
    ["Mahad (Maharashtra)", "Mahad"],
    ["Kharagpur (West Bengal)", "Kharagpur"],
    ["Mumbai (Head Office)", "Head Office (Mumbai)"],
  ].map(([sheet, plant]) => [normaliseKeyPart(sheet), plant]),
);

const VALUE_STREAM_LOOKUP = new Map(
  WORKBOOK_VALUE_STREAMS.map((stream) => [normaliseKeyPart(stream), stream]),
);

function cellText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normaliseKeyPart(value) {
  return cellText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-IN")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sourceSlug(value) {
  return normaliseKeyPart(value).replace(/\s+/g, "-");
}

function looksLikeContributor(value) {
  const text = cellText(value);
  if (!text || text.length > 60 || /\d|[:;!?]/u.test(text)) return false;

  const words = text.split(/\s+/u);
  if (words.length < 1 || words.length > 5) return false;

  return words.every((word) => /^[\p{L}][\p{L}.']*$/u.test(word));
}

function combineWithoutOverlap(first, second) {
  const left = cellText(first);
  const right = cellText(second);
  if (!left) return right;
  if (!right) return left;

  const normalisedLeft = normaliseKeyPart(left);
  const normalisedRight = normaliseKeyPart(right);
  if (normalisedLeft.includes(normalisedRight)) return left;
  if (normalisedRight.includes(normalisedLeft)) return right;
  return `${left}\n\n${right}`;
}

function conciseTitle(value, description, warnings) {
  const original = cellText(value);
  if (original.length <= 200) {
    return { title: original, description };
  }

  const candidate = original.slice(0, 197);
  const lastWordBoundary = candidate.lastIndexOf(" ");
  const title = `${candidate.slice(0, lastWordBoundary >= 120 ? lastWordBoundary : 197).trim()}…`;
  warnings.push(
    "The theme exceeded 200 characters, so a concise presentation title was derived while the complete wording was preserved in the description.",
  );
  return {
    title,
    description: combineWithoutOverlap(`Original theme: ${original}`, description),
  };
}

function canonicalValueStream(value) {
  return VALUE_STREAM_LOOKUP.get(normaliseKeyPart(value)) ?? null;
}

function meaningfulResponseCells(row) {
  return row.slice(1, 6).some((value) => cellText(value).length > 0);
}

function parseResponseRow({ plant, sheetName, row, rowIndex }) {
  const serial = cellText(row[0]);
  const nameColumn = cellText(row[1]);
  const themeColumn = cellText(row[2]);
  const descriptionColumn = cellText(row[3]);
  const rawValueStream = cellText(row[4]);
  const expectedBenefits = cellText(row[5]);
  const warnings = [];

  if (!serial) {
    warnings.push("The row has no Sr No.; it cannot receive a stable import identity.");
  }

  const panipatShiftedLayout =
    plant === "Panipat" &&
    nameColumn.length > 0 &&
    !looksLikeContributor(nameColumn);

  let submitterName;
  let rawTitle;
  let useCaseDescription;

  if (panipatShiftedLayout) {
    submitterName = "";
    rawTitle = nameColumn;
    useCaseDescription = combineWithoutOverlap(themeColumn, descriptionColumn);
    warnings.push(
      "The Name cell contains a use-case title in this Panipat row; the contributor was left blank instead of being fabricated.",
    );
  } else {
    submitterName = nameColumn;
    rawTitle = themeColumn;
    useCaseDescription = descriptionColumn;
  }

  const titleResult = conciseTitle(rawTitle, useCaseDescription, warnings);
  const valueStream = canonicalValueStream(rawValueStream);

  if (rawValueStream && !valueStream) {
    warnings.push(`The value stream “${rawValueStream}” is not one of the eight workbook options.`);
  }

  const missingFields = [];
  if (!titleResult.title) missingFields.push("useCaseTitle");
  if (!titleResult.description) missingFields.push("useCaseDescription");
  if (!valueStream) missingFields.push("valueStream");
  if (!expectedBenefits) missingFields.push("expectedBenefits");

  const sourceKey = serial
    ? `excel-v1|${sourceSlug(plant)}|${sourceSlug(serial)}`
    : "";
  const businessKey = [plant, submitterName, titleResult.title]
    .map(normaliseKeyPart)
    .join("|");

  return {
    sourceKey,
    sourceBusinessKey: businessKey,
    sourceSheet: sheetName,
    sourceRow: rowIndex + 1,
    sourceSerial: serial,
    plant,
    submitterName,
    useCaseTitle: titleResult.title,
    useCaseDescription: titleResult.description,
    valueStream,
    expectedBenefits,
    complete: Boolean(sourceKey) && missingFields.length === 0,
    missingFields,
    warnings,
  };
}

export function parseWorkbookSheets(sheets) {
  const entries = [];
  const workbookWarnings = [];

  for (const sheet of sheets) {
    const sheetName = cellText(sheet?.name);
    const plant = SHEET_PLANTS.get(normaliseKeyPart(sheetName));
    if (!plant) {
      workbookWarnings.push(`Ignored unrecognised sheet “${sheetName || "Untitled"}”.`);
      continue;
    }

    const rows = Array.isArray(sheet?.values) ? sheet.values : [];
    rows.slice(1).forEach((row, offset) => {
      const cells = Array.isArray(row) ? row : [];
      if (!meaningfulResponseCells(cells)) return;
      entries.push(
        parseResponseRow({
          plant,
          sheetName,
          row: cells,
          rowIndex: offset + 1,
        }),
      );
    });
  }

  return {
    entries,
    publishableEntries: entries.filter((entry) => entry.complete),
    incompleteEntries: entries.filter((entry) => !entry.complete),
    workbookWarnings,
  };
}

/** Keep the CLI payload contract aligned with the atomic Supabase import worker. */
export function toImportPayloadEntry(entry) {
  return {
    sourceKey: entry.sourceKey,
    sourceBusinessKey: entry.sourceBusinessKey,
    sourceSheet: entry.sourceSheet,
    sourceRow: entry.sourceRow,
    sourceSerial: entry.sourceSerial,
    plant: entry.plant,
    submitterName: entry.submitterName,
    useCaseTitle: entry.useCaseTitle,
    useCaseDescription: entry.useCaseDescription,
    valueStream: entry.valueStream,
    expectedBenefits: entry.expectedBenefits,
  };
}
