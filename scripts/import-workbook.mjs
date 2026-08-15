import fs from "node:fs/promises";
import path from "node:path";

import {
  parseWorkbookSheets,
  toImportPayloadEntry,
  validateImportEntries,
  validateWorkbookSchema,
} from "./workbook-import-mapping.mjs";
import {
  readWorkbookSource,
  workbookSafetyFindings,
} from "./workbook-source-reader.mjs";

const IMPORT_TIMEOUT_MS = 30_000;

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

function normalizedPathKey(value) {
  const resolved = path.resolve(value).normalize();
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-IN") : resolved;
}

async function existingRealPathOrResolved(value) {
  const resolved = path.resolve(value);
  try {
    return await fs.realpath(resolved);
  } catch (error) {
    if (error?.code === "ENOENT") return resolved;
    throw error;
  }
}

async function assertSafeReportPath(sourcePath, reportPath) {
  if (!reportPath) return;
  const [sourceRealPath, reportRealPath, sourceStat, reportStat] = await Promise.all([
    fs.realpath(path.resolve(sourcePath)),
    existingRealPathOrResolved(reportPath),
    fs.stat(path.resolve(sourcePath)),
    fs.stat(path.resolve(reportPath)).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    }),
  ]);
  if (
    normalizedPathKey(sourceRealPath) === normalizedPathKey(reportRealPath) ||
    (reportStat && sourceStat.dev === reportStat.dev && sourceStat.ino === reportStat.ino)
  ) {
    throw new Error("--report must not resolve to the source workbook.");
  }
}

async function writeReportExclusive(reportPath, reportText) {
  if (!reportPath) return;
  const resolved = path.resolve(reportPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  try {
    await fs.writeFile(resolved, reportText, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `The report already exists: ${resolved}. Choose a new evidence path; existing reports are never overwritten.`,
      );
    }
    throw error;
  }
}

function validatedSupabaseOrigin(rawValue, allowLocal) {
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error("SUPABASE_URL must be an absolute URL.");
  }
  const hostname = url.hostname.toLocaleLowerCase("en-IN");
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  const hostedSupabase = /^[a-z0-9-]+\.supabase\.co$/u.test(hostname);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("SUPABASE_URL must not contain credentials, query text, or a fragment.");
  }
  if (!hostedSupabase && !(allowLocal && loopback)) {
    throw new Error(
      "SUPABASE_URL must use a hosted <project>.supabase.co origin. Use --allow-local-supabase only for an intentional loopback test stack.",
    );
  }
  if (url.protocol !== "https:" && !(allowLocal && loopback && url.protocol === "http:")) {
    throw new Error("SUPABASE_URL must use HTTPS outside an explicitly allowed loopback stack.");
  }
  if (url.pathname !== "/") {
    throw new Error("SUPABASE_URL must contain only the project origin, with no path.");
  }
  return url.origin;
}

function uniqueFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = JSON.stringify([finding.sourceKey ?? null, finding.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fatalReport(error, shouldCommit) {
  return {
    mode: shouldCommit ? "commit" : "dry-run",
    status: "failed_before_preflight",
    errorCount: 1,
    errors: [error instanceof Error ? error.message : "The workbook could not be inspected."],
  };
}

async function main() {
  const workbookPath = optionValue("--source");
  const reportPath = optionValue("--report");
  const panipatLayout = optionValue("--panipat-layout");
  const shouldCommit = hasOption("--commit");
  const shouldPublish = hasOption("--publish");
  const acknowledgesGovernanceBypass = hasOption("--ack-governance-bypass");
  const allowsInferredPublish = hasOption("--allow-inferred-publish");
  const allowLocalSupabase = hasOption("--allow-local-supabase");

  if (!workbookPath) {
    throw new Error(
      "Usage: node scripts/import-workbook.mjs --source <workbook.xlsx> [--report <new-report.json>] [--panipat-layout standard|shifted] [--commit] [--publish --ack-governance-bypass] [--allow-inferred-publish] [--allow-local-supabase]",
    );
  }
  if (shouldPublish && !shouldCommit) {
    throw new Error("--publish may only be used with --commit.");
  }
  if (shouldPublish && !acknowledgesGovernanceBypass) {
    throw new Error(
      "--publish bypasses normal admin review and requires --ack-governance-bypass.",
    );
  }
  if (allowLocalSupabase && !shouldCommit) {
    throw new Error("--allow-local-supabase is only meaningful with --commit.");
  }

  await assertSafeReportPath(workbookPath, reportPath);

  let inspection;
  try {
    inspection = await readWorkbookSource(workbookPath);
  } catch (error) {
    const reportText = `${JSON.stringify(fatalReport(error, shouldCommit), null, 2)}\n`;
    await writeReportExclusive(reportPath, reportText);
    console.log(reportText.trimEnd());
    process.exitCode = 2;
    return;
  }

  const safety = workbookSafetyFindings(inspection);
  const schema = validateWorkbookSchema(inspection.sheets);
  const parsed = parseWorkbookSheets(
    inspection.sheets.map((sheet) => ({
      name: sheet.name,
      hidden: sheet.hidden,
      values: sheet.values,
    })),
    { panipatLayout },
  );
  const entryValidation = validateImportEntries(parsed.entries);
  const workbookHash = inspection.workbookHash;
  const sourceName = inspection.sourceName;
  if (sourceName.length > 260) {
    entryValidation.errors.push("The workbook file name exceeds the database 260-character limit.");
  }
  if (parsed.entries.length > 500) {
    entryValidation.errors.push("The workbook contains more than the 500-entry batch limit.");
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
  const parserWarnings = [
    ...parsed.workbookWarnings.map((message) => ({ sourceKey: null, message })),
    ...parsed.entries.flatMap((entry) =>
      entry.warnings.map((message) => ({ sourceKey: entry.sourceKey || null, message })),
    ),
  ];
  const warnings = uniqueFindings([
    ...safety.warnings.map((message) => ({ sourceKey: null, message })),
    ...schema.warnings.map((message) => ({ sourceKey: null, message })),
    ...parserWarnings,
  ]);
  const errors = [...new Set([
    ...safety.errors,
    ...schema.errors,
    ...parsed.workbookErrors,
    ...entryValidation.errors,
  ])];
  const inferredEntries = parsed.entries.filter((entry) => entry.valueStreamInferred);
  const publishableInferredEntries = parsed.publishableEntries.filter(
    (entry) => entry.valueStreamInferred,
  );

  const preflight = {
    mode: shouldCommit ? "commit" : "dry-run",
    status: errors.length > 0 ? "failed" : "passed",
    sourceName,
    workbookHash,
    normalizationVersion: parsed.entries[0]?.normalizationVersion ?? "excel-v1.1",
    packageEntryCount: inspection.packageEntryCount,
    packageUncompressedBytes: inspection.packageUncompressedBytes,
    rowsFound: parsed.entries.length,
    rowsPublishable: parsed.publishableEntries.length,
    rowsIncomplete: parsed.incompleteEntries.length,
    rowsWithInferredValueStream: inferredEntries.length,
    publishableRowsWithInferredValueStream: publishableInferredEntries.length,
    schemaErrorCount: schema.errors.length,
    safetyErrorCount: safety.errors.length,
    validationErrorCount: parsed.workbookErrors.length + entryValidation.errors.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    byPlant,
    publishableByPlant,
    errors,
    warnings,
    incomplete: parsed.incompleteEntries.map((entry) => ({
      sourceKey: entry.sourceKey || null,
      plant: entry.plant,
      sourceSheet: entry.sourceSheet,
      sourceRow: entry.sourceRow,
      missingFields: entry.missingFields,
    })),
  };

  const reportText = `${JSON.stringify(preflight, null, 2)}\n`;
  await writeReportExclusive(reportPath, reportText);

  if (errors.length > 0) {
    console.log(reportText.trimEnd());
    process.exitCode = 2;
    return;
  }

  if (
    shouldPublish &&
    publishableInferredEntries.length > 0 &&
    !allowsInferredPublish
  ) {
    throw new Error(
      "Direct publication is blocked because one or more publishable value streams were inferred. Use normal admin review, or add --allow-inferred-publish after reviewing the dry-run report.",
    );
  }

  if (!shouldCommit) {
    console.log(reportText.trimEnd());
    return;
  }

  const supabaseOrigin = validatedSupabaseOrigin(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL", ["SUPABASE_URL"]),
    allowLocalSupabase,
  );
  const publishableKey = requiredEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", [
    "SUPABASE_PUBLISHABLE_KEY",
  ]);
  const adminCapability = requiredEnvironment("BIRLA_OPUS_ADMIN_CAPABILITY");
  const rows = parsed.entries.map(toImportPayloadEntry);

  const response = await fetch(
    `${supabaseOrigin}/rest/v1/rpc/workshop_admin_excel_batch_import`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
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
    const message = payload?.message ?? payload?.error ??
      `Import failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  console.log(JSON.stringify({ preflight, result: payload }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Workbook import failed.");
  process.exitCode = 1;
}
