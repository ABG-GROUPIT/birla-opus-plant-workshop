const MEBIBYTE = 1024 * 1024;

export const REFERENCE_LIMITS = {
  maxItems: 4,
  maxFiles: 3,
  maxLinks: 2,
  maxFileBytes: 10 * MEBIBYTE,
  maxTotalFileBytes: 25 * MEBIBYTE,
  maxTitleLength: 120,
  maxUrlLength: 2048,
} as const;

export type ReferenceKind =
  | "link"
  | "pdf"
  | "powerpoint"
  | "word"
  | "spreadsheet"
  | "image";

export type ReferenceFileExtension =
  | ".pdf"
  | ".pptx"
  | ".docx"
  | ".xlsx"
  | ".jpg"
  | ".jpeg"
  | ".png"
  | ".webp";

export type ReferenceMimeType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

type ReferenceFileRule = {
  kind: Exclude<ReferenceKind, "link">;
  mimeType: ReferenceMimeType;
};

const REFERENCE_FILE_RULES: Readonly<
  Record<ReferenceFileExtension, ReferenceFileRule>
> = {
  ".pdf": { kind: "pdf", mimeType: "application/pdf" },
  ".pptx": {
    kind: "powerpoint",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  ".docx": {
    kind: "word",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  ".xlsx": {
    kind: "spreadsheet",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  ".jpg": { kind: "image", mimeType: "image/jpeg" },
  ".jpeg": { kind: "image", mimeType: "image/jpeg" },
  ".png": { kind: "image", mimeType: "image/png" },
  ".webp": { kind: "image", mimeType: "image/webp" },
};

const REFERENCE_EXTENSIONS = Object.keys(
  REFERENCE_FILE_RULES,
) as ReferenceFileExtension[];

const REFERENCE_MIME_TYPES = Array.from(
  new Set(
    Object.values(REFERENCE_FILE_RULES).map((rule) => rule.mimeType),
  ),
);

/** Suitable for an HTML file input's `accept` attribute. */
export const REFERENCE_FILE_ACCEPT = [
  ...REFERENCE_EXTENSIONS,
  ...REFERENCE_MIME_TYPES,
].join(",");

/** Structurally compatible with a browser `File`. */
export interface ReferenceFileLike {
  name: string;
  size: number;
  type?: string | null;
  /** Optional display title; the filename stem is used when omitted. */
  title?: string;
}

export interface ReferenceLinkLike {
  title: string;
  url: string;
}

export interface ReferenceFileClassification {
  kind: Exclude<ReferenceKind, "link">;
  extension: ReferenceFileExtension;
  mimeType: ReferenceMimeType;
  browserMimeType: string | null;
  mimeMatches: boolean;
}

export interface ReferenceValidationResult {
  valid: boolean;
  errors: string[];
  itemCount: number;
  fileCount: number;
  linkCount: number;
  totalFileBytes: number;
}

function normalizedMimeType(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function result(
  errors: string[],
  files: readonly ReferenceFileLike[],
  links: readonly ReferenceLinkLike[],
): ReferenceValidationResult {
  const totalFileBytes = files.reduce(
    (total, file) =>
      total + (Number.isFinite(file.size) && file.size > 0 ? file.size : 0),
    0,
  );

  return {
    valid: errors.length === 0,
    errors,
    itemCount: files.length + links.length,
    fileCount: files.length,
    linkCount: links.length,
    totalFileBytes,
  };
}

function titleErrors(title: string, subject: string): string[] {
  const trimmed = title.trim();
  if (!trimmed) return [`${subject} title is required.`];
  if (trimmed.length > REFERENCE_LIMITS.maxTitleLength) {
    return [
      `${subject} title must be ${REFERENCE_LIMITS.maxTitleLength} characters or fewer.`,
    ];
  }
  return [];
}

function basename(value: string): string {
  return value.trim().split(/[\\/]/).pop() ?? "";
}

export function referenceFileExtension(
  name: string,
): ReferenceFileExtension | null {
  const filename = basename(name).toLowerCase();
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;

  const extension = filename.slice(dot) as ReferenceFileExtension;
  return Object.hasOwn(REFERENCE_FILE_RULES, extension) ? extension : null;
}

export function expectedReferenceMimeType(
  nameOrExtension: string,
): ReferenceMimeType | null {
  const extension = nameOrExtension.trim().startsWith(".")
    ? (nameOrExtension.trim().toLowerCase() as ReferenceFileExtension)
    : referenceFileExtension(nameOrExtension);

  return extension && Object.hasOwn(REFERENCE_FILE_RULES, extension)
    ? REFERENCE_FILE_RULES[extension].mimeType
    : null;
}

export function expectedReferenceExtensions(
  mimeType: string,
): ReferenceFileExtension[] {
  const normalized = normalizedMimeType(mimeType);
  return REFERENCE_EXTENSIONS.filter(
    (extension) => REFERENCE_FILE_RULES[extension].mimeType === normalized,
  );
}

export function classifyReferenceFile(
  file: ReferenceFileLike,
): ReferenceFileClassification | null {
  const extension = referenceFileExtension(file.name);
  if (!extension) return null;

  const rule = REFERENCE_FILE_RULES[extension];
  const browserMimeType = normalizedMimeType(file.type);
  return {
    kind: rule.kind,
    extension,
    mimeType: rule.mimeType,
    browserMimeType: browserMimeType || null,
    // Some browsers leave File.type empty. The allowed extension remains the
    // authoritative client-side classification in that case.
    mimeMatches: !browserMimeType || browserMimeType === rule.mimeType,
  };
}

export function defaultReferenceTitle(name: string): string {
  const filename = basename(name);
  const extension = referenceFileExtension(filename);
  const withoutExtension = extension
    ? filename.slice(0, -extension.length)
    : filename.replace(/\.[^.]*$/, "");
  return withoutExtension.trim() || "Reference file";
}

export function validateReferenceFiles(
  files: readonly ReferenceFileLike[],
): ReferenceValidationResult {
  const errors: string[] = [];

  if (files.length > REFERENCE_LIMITS.maxFiles) {
    errors.push(`Add no more than ${REFERENCE_LIMITS.maxFiles} uploaded files.`);
  }

  files.forEach((file, index) => {
    const subject = `File ${index + 1}`;
    const title = file.title ?? defaultReferenceTitle(file.name);
    errors.push(...titleErrors(title, subject));

    if (!file.name.trim()) {
      errors.push(`${subject} must have a filename.`);
      return;
    }

    const classification = classifyReferenceFile(file);
    if (!classification) {
      errors.push(`${subject} uses a file type that is not allowed.`);
    } else if (!classification.mimeMatches) {
      errors.push(
        `${subject} extension ${classification.extension} does not match its MIME type.`,
      );
    }

    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      errors.push(`${subject} must be a non-empty file with a valid size.`);
    } else if (file.size > REFERENCE_LIMITS.maxFileBytes) {
      errors.push(
        `${subject} must be ${formatReferenceSize(REFERENCE_LIMITS.maxFileBytes)} or smaller.`,
      );
    }
  });

  const totalFileBytes = files.reduce(
    (total, file) =>
      total + (Number.isSafeInteger(file.size) && file.size > 0 ? file.size : 0),
    0,
  );
  if (totalFileBytes > REFERENCE_LIMITS.maxTotalFileBytes) {
    errors.push(
      `Uploaded files must total ${formatReferenceSize(REFERENCE_LIMITS.maxTotalFileBytes)} or less.`,
    );
  }

  return result(errors, files, []);
}

export function validateReferenceLinks(
  links: readonly ReferenceLinkLike[],
): ReferenceValidationResult {
  const errors: string[] = [];

  if (links.length > REFERENCE_LIMITS.maxLinks) {
    errors.push(`Add no more than ${REFERENCE_LIMITS.maxLinks} HTTPS links.`);
  }

  links.forEach((link, index) => {
    const subject = `Link ${index + 1}`;
    errors.push(...titleErrors(link.title, subject));
    const urlText = link.url.trim();

    if (!urlText) {
      errors.push(`${subject} URL is required.`);
      return;
    }
    if (urlText.length > REFERENCE_LIMITS.maxUrlLength) {
      errors.push(
        `${subject} URL must be ${REFERENCE_LIMITS.maxUrlLength} characters or fewer.`,
      );
      return;
    }

    try {
      const url = new URL(urlText);
      if (url.protocol !== "https:" || !url.hostname) {
        errors.push(`${subject} must use a complete HTTPS URL.`);
      } else if (url.username || url.password) {
        errors.push(`${subject} URL must not contain embedded credentials.`);
      }
    } catch {
      errors.push(`${subject} must use a complete HTTPS URL.`);
    }
  });

  return result(errors, [], links);
}

export function validateReferenceSelection(
  files: readonly ReferenceFileLike[],
  links: readonly ReferenceLinkLike[],
): ReferenceValidationResult {
  const fileValidation = validateReferenceFiles(files);
  const linkValidation = validateReferenceLinks(links);
  const errors = [...fileValidation.errors, ...linkValidation.errors];

  if (files.length + links.length > REFERENCE_LIMITS.maxItems) {
    errors.push(
      `Add no more than ${REFERENCE_LIMITS.maxItems} reference items in total.`,
    );
  }

  return result(errors, files, links);
}

export function formatReferenceSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function referenceKindLabel(kind: ReferenceKind): string {
  switch (kind) {
    case "link":
      return "Web link";
    case "pdf":
      return "PDF";
    case "powerpoint":
      return "PowerPoint";
    case "word":
      return "Word document";
    case "spreadsheet":
      return "Excel workbook";
    case "image":
      return "Image";
  }
}

export function sanitizeReferenceFileName(name: string): string {
  const original = basename(name).normalize("NFKD").replace(/\p{M}/gu, "");
  const extension = referenceFileExtension(original);
  const rawStem = extension
    ? original.slice(0, -extension.length)
    : original.replace(/\.[^.]*$/, "");
  const safeStem = rawStem
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 100)
    .replace(/[-_.]+$/g, "");
  const safeExtension = extension ?? "";

  return `${safeStem || "reference"}${safeExtension}`;
}
