import { createHash } from "node:crypto";

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

export const WORKBOOK_SHEET_BINDINGS = Object.freeze([
    ["Panipat (Haryana)", "Panipat"],
    ["Ludhiana (Punjab)", "Ludhiana"],
    ["Cheyyar (Tamil Nadu)", "Cheyyar"],
    ["Chamarajanagar (Karnataka)", "Chamarajanagar"],
    ["Mahad (Maharashtra)", "Mahad"],
    ["Kharagpur (West Bengal)", "Kharagpur"],
    ["Mumbai (Head Office)", "Head Office (Mumbai)"],
]);

const SHEET_PLANTS = new Map(
  WORKBOOK_SHEET_BINDINGS.map(([sheet, plant]) => [normaliseKeyPart(sheet), plant]),
);

const PLANT_SOURCE_SLUGS = new Map([
  ["Panipat", "panipat"],
  ["Ludhiana", "ludhiana"],
  ["Cheyyar", "cheyyar"],
  ["Chamarajanagar", "chamarajanagar"],
  ["Mahad", "mahad"],
  ["Kharagpur", "kharagpur"],
  ["Head Office (Mumbai)", "head-office-mumbai"],
]);

export const WORKBOOK_NORMALIZATION_VERSION = "excel-v1.1";

const WORKBOOK_HEADER_ALIASES = Object.freeze([
  new Set(["sr no", "serial no", "serial number"]),
  new Set(["name", "leader name"]),
  new Set(["use case theme", "use case theme 100 charac", "use case title"]),
  new Set(["use case description", "use case theme description"]),
  new Set(["value streams", "value streams please select drop down", "value stream"]),
  new Set(["expected benefits", "expected benefit"]),
]);

const VALUE_STREAM_LOOKUP = new Map(
  WORKBOOK_VALUE_STREAMS.map((stream) => [normaliseKeyPart(stream), stream]),
);

const VALUE_STREAM_INFERENCE_RULES = Object.freeze([
  ["Safety", [["near miss", 6], ["safety", 6], ["hazard", 5], ["incident", 5], ["ppe", 5], ["injury", 5], ["fire", 3]]],
  ["Quality", [["quality assurance", 7], ["inspection", 6], ["defective", 6], ["defect", 6], ["tolerance", 5], ["rework", 5], ["complaint", 4], ["validation", 4], ["ocr", 4], ["qr", 3], ["accuracy", 1]]],
  ["Supply Chain", [["supply chain", 8], ["finished goods", 7], ["warehouse", 7], ["dispatch", 7], ["inventory", 6], ["logistics", 6], ["truck loading", 5], ["customer order", 5], ["picking", 3], ["staging", 3], ["stock", 2]]],
  ["Reliability", [["predictive maintenance", 8], ["condition monitoring", 7], ["asset health", 7], ["breakdown", 6], ["downtime", 6], ["failure", 5], ["reliability", 5], ["maintenance", 4], ["mtbf", 5], ["mttr", 5]]],
  ["Energy Efficiency", [["energy efficiency", 8], ["energy consumption", 7], ["compressed air", 6], ["electricity", 6], ["power consumption", 6], ["kwh", 6], ["fuel", 5], ["steam", 5], ["energy", 3]]],
  ["Sustainability", [["sustainability", 8], ["water reuse", 7], ["carbon", 6], ["emission", 6], ["recycle", 6], ["effluent", 6], ["environment", 5], ["waste", 4], ["water", 2]]],
  ["Productivity", [["manpower efficiency", 7], ["cycle time", 6], ["throughput", 5], ["productivity", 5], ["utilization", 4], ["oee", 5], ["output", 3], ["capacity", 3]]],
  ["Process Optimization", [["process optimization", 8], ["parameter optimization", 7], ["resource allocation", 6], ["plan adherence", 6], ["process control", 6], ["bottleneck", 5], ["sequencing", 5], ["scheduling", 5], ["workflow", 4], ["automation", 3], ["analytics", 2], ["process", 1]]],
]);

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

function asciiSourceSlug(value) {
  return cellText(value)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase("en-IN");
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

export function validateWorkbookSchema(sheets) {
  const errors = [];
  const warnings = [];
  const recognized = new Map();

  for (const sheet of sheets) {
    const sheetName = cellText(sheet?.name);
    const key = normaliseKeyPart(sheetName);
    if (!SHEET_PLANTS.has(key)) {
      warnings.push(`Ignored unrecognised sheet “${sheetName || "Untitled"}”.`);
      continue;
    }
    if (recognized.has(key)) {
      errors.push(`Workbook contains the required sheet “${sheetName}” more than once.`);
      continue;
    }
    recognized.set(key, sheet);

    if (Number(sheet?.hidden ?? 0) !== 0) {
      errors.push(`Required sheet “${sheetName}” must be visible.`);
    }
    const header = Array.isArray(sheet?.values?.[0]) ? sheet.values[0] : [];
    WORKBOOK_HEADER_ALIASES.forEach((aliases, index) => {
      const normalized = normaliseKeyPart(header[index]);
      if (!aliases.has(normalized)) {
        errors.push(
          `Sheet “${sheetName}” column ${index + 1} has an unsupported header.`,
        );
      }
    });
    if (header.slice(6).some((value) => cellText(value))) {
      errors.push(`Sheet “${sheetName}” contains unexpected populated columns after column F.`);
    }
    if (
      (sheet?.values ?? []).slice(1).some((row) =>
        (Array.isArray(row) ? row : []).slice(6).some((value) => cellText(value)),
      )
    ) {
      errors.push(
        `Sheet "${sheetName}" contains populated response cells after column F.`,
      );
    }
  }

  for (const [requiredSheet] of WORKBOOK_SHEET_BINDINGS) {
    if (!recognized.has(normaliseKeyPart(requiredSheet))) {
      errors.push(`Workbook is missing required sheet “${requiredSheet}”.`);
    }
  }

  return { errors, warnings };
}

export function inferValueStream(title, description, expectedBenefits) {
  const weightedFields = [
    [normaliseKeyPart(title), 3],
    [normaliseKeyPart(description), 2],
    [normaliseKeyPart(expectedBenefits), 1],
  ];
  let bestStream = "Process Optimization";
  let bestScore = 0;

  for (const [stream, terms] of VALUE_STREAM_INFERENCE_RULES) {
    let score = 0;
    for (const [field, fieldWeight] of weightedFields) {
      for (const [term, termWeight] of terms) {
        if (field.includes(term)) score += fieldWeight * termWeight;
      }
    }
    if (score > bestScore) {
      bestStream = stream;
      bestScore = score;
    }
  }

  return bestStream;
}

function meaningfulResponseCells(row) {
  return row.slice(1, 6).some((value) => cellText(value).length > 0);
}

function rawColumnsHash(row) {
  const canonical = JSON.stringify(
    Array.from({ length: 6 }, (_, index) => cellText(row[index])),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function parseResponseRow({ plant, sheetName, row, rowIndex, layout }) {
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

  const panipatShiftedLayout = plant === "Panipat" && layout === "shifted";

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
  const suppliedValueStream = canonicalValueStream(rawValueStream);
  const valueStream = suppliedValueStream ?? inferValueStream(
    titleResult.title,
    titleResult.description,
    expectedBenefits,
  );
  const valueStreamInferred = !suppliedValueStream;

  if (valueStreamInferred) {
    const reason = rawValueStream
      ? "the workbook value-stream cell was not one of the eight supported options"
      : "the workbook value-stream cell was blank";
    warnings.push(`${reason}; “${valueStream}” was inferred from the use-case wording.`);
  }

  const missingFields = [];
  if (!titleResult.title) missingFields.push("useCaseTitle");
  if (!titleResult.description) missingFields.push("useCaseDescription");
  if (!valueStream) missingFields.push("valueStream");
  if (!expectedBenefits) missingFields.push("expectedBenefits");

  const sourceSerialSlug = asciiSourceSlug(serial);
  const plantSlug = PLANT_SOURCE_SLUGS.get(plant) ?? "";
  const sourceKey = sourceSerialSlug && plantSlug
    ? `excel-v1|${plantSlug}|${sourceSerialSlug}`
    : "";
  if (!sourceKey && !missingFields.includes("sourceKey")) {
    missingFields.push("sourceKey");
  }
  if (serial && !sourceSerialSlug) {
    warnings.push(
      "The Sr No. has no ASCII letters or digits, so it cannot receive the database-compatible import identity.",
    );
  }
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
    valueStreamInferred,
    rawValueStream,
    normalizationVersion: WORKBOOK_NORMALIZATION_VERSION,
    layoutKind: panipatShiftedLayout ? "shifted" : "standard",
    rawColumnsSha256: rawColumnsHash(row),
    expectedBenefits,
    complete: Boolean(sourceKey) && missingFields.length === 0,
    missingFields,
    warnings,
  };
}

export function parseWorkbookSheets(sheets, options = {}) {
  const entries = [];
  const workbookWarnings = [];
  const workbookErrors = [];
  const panipatLayout = options.panipatLayout ?? null;

  if (panipatLayout !== null && !["standard", "shifted"].includes(panipatLayout)) {
    throw new Error("panipatLayout must be either standard or shifted.");
  }

  for (const sheet of sheets) {
    const sheetName = cellText(sheet?.name);
    const plant = SHEET_PLANTS.get(normaliseKeyPart(sheetName));
    if (!plant) {
      workbookWarnings.push(`Ignored unrecognised sheet “${sheetName || "Untitled"}”.`);
      continue;
    }

    const rows = Array.isArray(sheet?.values) ? sheet.values : [];
    const meaningfulRows = rows.slice(1).filter((row) =>
      meaningfulResponseCells(Array.isArray(row) ? row : []),
    );
    if (plant === "Panipat" && meaningfulRows.length > 0 && !panipatLayout) {
      workbookErrors.push(
        "The populated Panipat sheet requires an explicit layout decision. Rerun with --panipat-layout standard for the documented A-F template or --panipat-layout shifted for the known legacy shifted rows.",
      );
    }
    rows.slice(1).forEach((row, offset) => {
      const cells = Array.isArray(row) ? row : [];
      if (!meaningfulResponseCells(cells)) return;
      entries.push(
        parseResponseRow({
          plant,
          sheetName,
          row: cells,
          rowIndex: offset + 1,
          layout: plant === "Panipat" ? (panipatLayout ?? "standard") : "standard",
        }),
      );
    });
  }

  return {
    entries,
    publishableEntries: entries.filter((entry) => entry.complete),
    incompleteEntries: entries.filter((entry) => !entry.complete),
    workbookWarnings,
    workbookErrors,
  };
}

export function validateImportEntries(entries) {
  const errors = [];
  const duplicateKeys = new Set();
  const seenKeys = new Set();

  entries.forEach((entry, index) => {
    const position = index + 1;
    const fields = [
      ["sourceSheet", entry.sourceSheet, 120],
      ["sourceSerial", entry.sourceSerial, 80],
      ["submitterName", entry.submitterName, 120],
      ["submitterEmail", entry.submitterEmail ?? "", 254],
      ["designation", entry.designation ?? "", 160],
      ["useCaseTitle", entry.useCaseTitle, 200],
      ["useCaseDescription", entry.useCaseDescription, 12000],
      ["expectedBenefits", entry.expectedBenefits, 12000],
    ];
    for (const [name, value, limit] of fields) {
      if (cellText(value).length > limit) {
        errors.push(`Entry ${position} field ${name} exceeds ${limit} characters.`);
      }
    }
    if (
      entry.submitterEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(entry.submitterEmail)
    ) {
      errors.push(`Entry ${position} contains an invalid optional work email.`);
    }
    if (!WORKBOOK_VALUE_STREAMS.includes(entry.valueStream)) {
      errors.push(`Entry ${position} does not contain one canonical value stream.`);
    }
    if (!Number.isInteger(entry.sourceRow) || entry.sourceRow < 1 || entry.sourceRow > 9_999_999) {
      errors.push(`Entry ${position} has an invalid physical source row.`);
    }
    const key = cellText(entry.sourceKey).toLocaleLowerCase("en-IN");
    if (key) {
      if (seenKeys.has(key)) duplicateKeys.add(key);
      seenKeys.add(key);
    }

    const payloadBytes = Buffer.byteLength(
      JSON.stringify(toImportPayloadEntry(entry)),
      "utf8",
    );
    if (payloadBytes > 65_536) {
      errors.push(`Entry ${position} source provenance exceeds 64 KiB.`);
    }
  });

  for (const key of duplicateKeys) {
    errors.push(`Workbook payload contains a duplicate source key: ${key}.`);
  }

  const rows = entries.map(toImportPayloadEntry);
  if (Buffer.byteLength(JSON.stringify(rows), "utf8") > 5 * 1024 * 1024) {
    errors.push("The normalized workbook payload exceeds the database 5 MiB limit.");
  }

  return { errors };
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
    valueStreamInferred: entry.valueStreamInferred,
    expectedBenefits: entry.expectedBenefits,
  };
}
