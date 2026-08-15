import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import * as XLSXModule from "@e965/xlsx";

const XLSX = XLSXModule.default ?? XLSXModule;

export const WORKBOOK_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
export const WORKBOOK_ROW_LIMIT = 501;
export const WORKBOOK_COLUMN_LIMIT = 32;
export const WORKBOOK_ZIP_ENTRY_LIMIT = 2_000;
export const WORKBOOK_ZIP_TOTAL_UNCOMPRESSED_LIMIT_BYTES = 128 * 1024 * 1024;
export const WORKBOOK_ZIP_ENTRY_UNCOMPRESSED_LIMIT_BYTES = 64 * 1024 * 1024;
export const WORKBOOK_ZIP_COMPRESSION_RATIO_LIMIT = 500;

function workbookError(message) {
  const error = new Error(message);
  error.name = "WorkbookSourceError";
  return error;
}

function safeCellValue(cell) {
  if (!cell || cell.v === null || cell.v === undefined) return "";
  if (cell.v instanceof Date) return cell.v.toISOString();
  if (["string", "number", "boolean"].includes(typeof cell.v)) return cell.v;
  return String(cell.v);
}

function zipPackageInspection(bytes) {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  if (bytes.length < 22) {
    throw workbookError("The .xlsx package is too short to contain a ZIP directory.");
  }
  const searchStart = Math.max(0, bytes.length - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw workbookError("The .xlsx package does not contain a valid ZIP directory.");
  }

  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw workbookError("ZIP64 workbook packages are not supported.");
  }
  if (entryCount > WORKBOOK_ZIP_ENTRY_LIMIT) {
    throw workbookError(
      `The workbook package contains ${entryCount} entries; the supported maximum is ${WORKBOOK_ZIP_ENTRY_LIMIT}.`,
    );
  }
  if (centralOffset + centralSize > eocdOffset) {
    throw workbookError("The workbook ZIP directory is malformed.");
  }

  let offset = centralOffset;
  let totalUncompressedBytes = 0;
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== centralSignature) {
      throw workbookError("The workbook ZIP directory contains an invalid entry.");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const compressedBytes = bytes.readUInt32LE(offset + 20);
    const uncompressedBytes = bytes.readUInt32LE(offset + 24);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const end = offset + 46 + fileNameLength + extraLength + commentLength;
    if (end > bytes.length) {
      throw workbookError("The workbook ZIP directory contains a truncated entry.");
    }
    if ((flags & 0x0001) !== 0) {
      throw workbookError("Encrypted workbook package entries are not supported.");
    }
    const name = bytes
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8")
      .replaceAll("\\", "/");
    if (
      name.startsWith("/") ||
      /^[a-zA-Z]:\//u.test(name) ||
      name.split("/").includes("..")
    ) {
      throw workbookError("The workbook package contains an unsafe entry path.");
    }
    if (uncompressedBytes > WORKBOOK_ZIP_ENTRY_UNCOMPRESSED_LIMIT_BYTES) {
      throw workbookError("One workbook package entry exceeds the 64 MiB expansion limit.");
    }
    if (
      uncompressedBytes > 1024 * 1024 &&
      uncompressedBytes / Math.max(1, compressedBytes) >
        WORKBOOK_ZIP_COMPRESSION_RATIO_LIMIT
    ) {
      throw workbookError("One workbook package entry has an unsafe compression ratio.");
    }
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > WORKBOOK_ZIP_TOTAL_UNCOMPRESSED_LIMIT_BYTES) {
      throw workbookError("The workbook package exceeds the 128 MiB expansion limit.");
    }
    entries.push(name);
    offset = end;
  }

  return { entries, totalUncompressedBytes };
}

function sheetDimensions(sheet) {
  if (!sheet?.["!ref"]) return { rowCount: 1, columnCount: 6 };
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  return {
    rowCount: Math.max(1, range.e.r + 1),
    columnCount: Math.max(6, range.e.c + 1),
  };
}

function sheetInspection(sheetName, sheet, hidden) {
  const { rowCount, columnCount } = sheetDimensions(sheet);
  if (rowCount > WORKBOOK_ROW_LIMIT) {
    throw workbookError(
      `Sheet “${sheetName}” uses ${rowCount} rows; the supported maximum is ${WORKBOOK_ROW_LIMIT}.`,
    );
  }
  if (columnCount > WORKBOOK_COLUMN_LIMIT) {
    throw workbookError(
      `Sheet “${sheetName}” uses ${columnCount} columns; the supported maximum is ${WORKBOOK_COLUMN_LIMIT}.`,
    );
  }

  const values = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => ""),
  );
  const formulas = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => ""),
  );
  const comments = [];
  const hiddenRows = (sheet["!rows"] ?? [])
    .map((row, index) => row?.hidden ? index : null)
    .filter((index) => index !== null);
  const hiddenColumns = (sheet["!cols"] ?? [])
    .map((column, index) => column?.hidden ? index : null)
    .filter((index) => index !== null);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[address];
      values[rowIndex][columnIndex] = safeCellValue(cell);
      if (cell?.f) formulas[rowIndex][columnIndex] = "FORMULA";
      if (Array.isArray(cell?.c) && cell.c.length > 0) comments.push(address);
    }
  }

  return {
    name: sheetName,
    hidden,
    values,
    formulas,
    merges: (sheet["!merges"] ?? []).map((range) => XLSX.utils.encode_range(range)),
    commentCells: comments,
    hiddenRows,
    hiddenColumns,
  };
}

export async function readWorkbookSource(sourcePath) {
  const requestedPath = path.resolve(sourcePath);
  if (path.extname(requestedPath).toLocaleLowerCase("en-IN") !== ".xlsx") {
    throw workbookError("Only macro-free .xlsx workbooks are accepted.");
  }

  const resolvedPath = await fs.realpath(requestedPath);
  const bytes = await fs.readFile(resolvedPath);
  if (bytes.length > WORKBOOK_FILE_LIMIT_BYTES) {
    throw workbookError("The workbook exceeds the 20 MB import limit.");
  }
  const zipPackage = zipPackageInspection(bytes);

  let workbook;
  try {
    workbook = XLSX.read(bytes, {
      type: "buffer",
      bookFiles: true,
      bookVBA: true,
      cellStyles: true,
      cellDates: true,
      cellFormula: true,
      cellText: false,
    });
  } catch (error) {
    throw workbookError(
      error instanceof Error
        ? `The workbook could not be parsed: ${error.message}`
        : "The workbook could not be parsed.",
    );
  }

  const hiddenBySheet = new Map(
    (workbook.Workbook?.Sheets ?? []).map((sheet) => [
      String(sheet.name ?? ""),
      Number(sheet.Hidden ?? 0),
    ]),
  );
  const packageEntries = Array.isArray(workbook.keys)
    ? workbook.keys.map((entry) => String(entry).replaceAll("\\", "/"))
    : zipPackage.entries;
  const externalLinkEntries = packageEntries.filter((entry) =>
    /(^|\/)externalLinks\//iu.test(entry),
  );
  const embeddedObjectEntries = packageEntries.filter((entry) =>
    /(^|\/)(embeddings|activeX|ctrlProps)\//iu.test(entry),
  );
  const hasVba = Boolean(workbook.vbaraw) || packageEntries.some((entry) =>
    /(^|\/)vbaProject\.bin$/iu.test(entry),
  );

  return {
    sourcePath: resolvedPath,
    sourceName: path.basename(resolvedPath),
    sizeBytes: bytes.length,
    workbookHash: createHash("sha256").update(bytes).digest("hex"),
    hasVba,
    externalLinkEntries,
    embeddedObjectEntries,
    packageEntryCount: zipPackage.entries.length,
    packageUncompressedBytes: zipPackage.totalUncompressedBytes,
    sheets: workbook.SheetNames.map((sheetName) =>
      sheetInspection(
        sheetName,
        workbook.Sheets[sheetName],
        hiddenBySheet.get(sheetName) ?? 0,
      ),
    ),
  };
}

export function workbookSafetyFindings(inspection) {
  const errors = [];
  const warnings = [];

  if (inspection.hasVba) {
    errors.push("The workbook contains a VBA project or macro payload.");
  }
  if (inspection.externalLinkEntries.length > 0) {
    errors.push("The workbook contains external-link package parts.");
  }
  if (inspection.embeddedObjectEntries.length > 0) {
    errors.push("The workbook contains embedded or ActiveX package parts.");
  }

  for (const sheet of inspection.sheets) {
    const responseFormulaCells = [];
    for (let rowIndex = 1; rowIndex < sheet.formulas.length; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < 6; columnIndex += 1) {
        if (sheet.formulas[rowIndex]?.[columnIndex]) {
          responseFormulaCells.push(
            XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex }),
          );
        }
      }
    }
    if (responseFormulaCells.length > 0) {
      errors.push(
        `Sheet “${sheet.name}” contains formula-backed response cells: ${responseFormulaCells.slice(0, 12).join(", ")}${responseFormulaCells.length > 12 ? "…" : ""}.`,
      );
    }
    if (sheet.merges.length > 0) {
      errors.push(
        `Sheet “${sheet.name}” contains merged cells (${sheet.merges.slice(0, 8).join(", ")}).`,
      );
    }
    if (sheet.commentCells.length > 0) {
      warnings.push(
        `Sheet “${sheet.name}” contains ${sheet.commentCells.length} cell comment(s); comments are ignored.`,
      );
    }
    const hiddenPopulatedRows = sheet.hiddenRows.filter((rowIndex) =>
      (sheet.values[rowIndex] ?? []).some((value) => String(value ?? "").trim()),
    );
    if (hiddenPopulatedRows.length > 0) {
      errors.push(
        `Sheet "${sheet.name}" contains populated hidden rows: ${hiddenPopulatedRows.slice(0, 12).map((index) => index + 1).join(", ")}.`,
      );
    }
    const hiddenPopulatedColumns = sheet.hiddenColumns.filter((columnIndex) =>
      sheet.values.some((row) => String(row?.[columnIndex] ?? "").trim()),
    );
    if (hiddenPopulatedColumns.length > 0) {
      errors.push(
        `Sheet "${sheet.name}" contains populated hidden columns: ${hiddenPopulatedColumns.slice(0, 12).map((index) => XLSX.utils.encode_col(index)).join(", ")}.`,
      );
    }
  }

  return { errors, warnings };
}
