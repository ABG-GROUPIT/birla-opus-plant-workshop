import assert from "node:assert/strict";
import test from "node:test";

import {
  REFERENCE_FILE_ACCEPT,
  REFERENCE_LIMITS,
  classifyReferenceFile,
  expectedReferenceExtensions,
  expectedReferenceMimeType,
  formatReferenceSize,
  referenceKindLabel,
  sanitizeReferenceFileName,
  validateReferenceFiles,
  validateReferenceLinks,
  validateReferenceSelection,
} from "../lib/reference-media.ts";

const MiB = 1024 * 1024;

function file(name, size = MiB, type = "") {
  return { name, size, type };
}

test("exports the decided media limits and a narrow file-input accept list", () => {
  assert.deepEqual(REFERENCE_LIMITS, {
    maxItems: 4,
    maxFiles: 3,
    maxLinks: 2,
    maxFileBytes: 10 * MiB,
    maxTotalFileBytes: 25 * MiB,
    maxTitleLength: 120,
    maxUrlLength: 2048,
  });

  for (const extension of [
    ".pdf",
    ".pptx",
    ".docx",
    ".xlsx",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
  ]) {
    assert.match(REFERENCE_FILE_ACCEPT, new RegExp(`(?:^|,)\\${extension}(?:,|$)`));
  }
  assert.doesNotMatch(REFERENCE_FILE_ACCEPT, /\.ppt(?:,|$)|\.docm|\.xlsm|\.svg|\.html|\.zip|video\//);
});

test("classifies allowed files with exact extension-to-MIME mappings", () => {
  assert.deepEqual(classifyReferenceFile(file("brief.pdf", 1, "application/pdf")), {
    kind: "pdf",
    extension: ".pdf",
    mimeType: "application/pdf",
    browserMimeType: "application/pdf",
    mimeMatches: true,
  });

  const presentation = classifyReferenceFile(file(
    "brief.PPTX",
    1,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ));
  assert.equal(presentation.kind, "powerpoint");
  assert.equal(referenceKindLabel(presentation.kind), "PowerPoint");

  assert.equal(
    expectedReferenceMimeType("report.xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.deepEqual(expectedReferenceExtensions("image/jpeg"), [".jpg", ".jpeg"]);
});

test("accepts an empty browser MIME but rejects a non-empty mismatch", () => {
  const missingMime = validateReferenceFiles([file("photo.jpg", MiB, "")]);
  assert.equal(missingMime.valid, true);
  assert.equal(classifyReferenceFile(file("photo.jpg")).mimeMatches, true);

  const mismatch = validateReferenceFiles([
    file("report.pdf", MiB, "image/png"),
  ]);
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.errors.some((error) => /does not match its MIME type/i.test(error)));

  const parameterized = validateReferenceFiles([
    file("report.pdf", MiB, "application/pdf; charset=binary"),
  ]);
  assert.equal(parameterized.valid, false);
});

test("allows the exact per-file and aggregate byte boundaries", () => {
  const exactFileLimit = validateReferenceFiles([
    file("one.pdf", 10 * MiB, "application/pdf"),
  ]);
  assert.equal(exactFileLimit.valid, true);

  const oneByteOver = validateReferenceFiles([
    file("one.pdf", 10 * MiB + 1, "application/pdf"),
  ]);
  assert.equal(oneByteOver.valid, false);

  const exactTotal = validateReferenceSelection([
    file("one.pdf", 10 * MiB, "application/pdf"),
    file("two.png", 10 * MiB, "image/png"),
    file("three.webp", 5 * MiB, "image/webp"),
  ], []);
  assert.equal(exactTotal.valid, true);
  assert.equal(exactTotal.totalFileBytes, 25 * MiB);

  const overTotal = validateReferenceSelection([
    file("one.pdf", 10 * MiB, "application/pdf"),
    file("two.png", 10 * MiB, "image/png"),
    file("three.webp", 5 * MiB + 1, "image/webp"),
  ], []);
  assert.equal(overTotal.valid, false);
  assert.ok(overTotal.errors.some((error) => /total 25 MB or less/i.test(error)));
});

test("enforces file, link, and combined item counts", () => {
  const files = [
    file("one.pdf"),
    file("two.pdf"),
    file("three.pdf"),
  ];
  const links = [
    { title: "First", url: "https://example.com/first" },
    { title: "Second", url: "https://example.com/second" },
  ];

  assert.equal(validateReferenceSelection(files, links.slice(0, 1)).valid, true);
  assert.equal(validateReferenceFiles([...files, file("four.pdf")]).valid, false);
  assert.equal(validateReferenceLinks([
    ...links,
    { title: "Third", url: "https://example.com/third" },
  ]).valid, false);

  const fiveItems = validateReferenceSelection(files, links);
  assert.equal(fiveItems.valid, false);
  assert.ok(fiveItems.errors.some((error) => /4 reference items/i.test(error)));
});

test("validates titles and exact HTTPS URL length boundaries", () => {
  const titleAtLimit = "T".repeat(REFERENCE_LIMITS.maxTitleLength);
  const base = "https://example.com/";
  const urlAtLimit = base + "a".repeat(REFERENCE_LIMITS.maxUrlLength - base.length);

  assert.equal(validateReferenceLinks([
    { title: titleAtLimit, url: urlAtLimit },
  ]).valid, true);

  assert.equal(validateReferenceLinks([
    { title: `${titleAtLimit}x`, url: urlAtLimit },
  ]).valid, false);
  assert.equal(validateReferenceLinks([
    { title: "Too long", url: `${urlAtLimit}x` },
  ]).valid, false);
});

test("rejects unsafe, incomplete, credentialed, and non-HTTPS URLs", () => {
  for (const url of [
    "http://example.com",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///tmp/report.pdf",
    "/relative/path",
    "https://",
    "https://user:password@example.com/report",
  ]) {
    const validation = validateReferenceLinks([{ title: "Unsafe", url }]);
    assert.equal(validation.valid, false, url);
  }
});

test("rejects legacy, macro-enabled, archive, HTML, SVG, and video formats", () => {
  const blocked = [
    ["legacy.ppt", "application/vnd.ms-powerpoint"],
    ["legacy.doc", "application/msword"],
    ["legacy.xls", "application/vnd.ms-excel"],
    ["macro.pptm", "application/vnd.ms-powerpoint.presentation.macroEnabled.12"],
    ["macro.docm", "application/vnd.ms-word.document.macroEnabled.12"],
    ["macro.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"],
    ["archive.zip", "application/zip"],
    ["page.html", "text/html"],
    ["vector.svg", "image/svg+xml"],
    ["clip.mp4", "video/mp4"],
  ];

  for (const [name, type] of blocked) {
    assert.equal(classifyReferenceFile(file(name, MiB, type)), null, name);
    assert.equal(validateReferenceFiles([file(name, MiB, type)]).valid, false, name);
  }
});

test("formats readable sizes and sanitizes upload filenames", () => {
  assert.equal(formatReferenceSize(512), "512 B");
  assert.equal(formatReferenceSize(1536), "1.5 KB");
  assert.equal(formatReferenceSize(10 * MiB), "10 MB");
  assert.equal(formatReferenceSize(Number.NaN), "Unknown size");

  assert.equal(
    sanitizeReferenceFileName("C:\\fakepath\\ Qúarterly Plan (Final) 🚀.PPTX"),
    "Quarterly-Plan-Final.pptx",
  );
  assert.equal(sanitizeReferenceFileName("../../.pdf"), "reference.pdf");
});
