import { getDatabase } from "@/db";
import {
  PLANT_NAMES,
  SUBMISSION_STATUSES,
  type PlantName,
  type SubmissionStatus,
} from "@/db/schema";
import {
  getSubmissionCompletionErrors,
  requiresCompleteResponse,
} from "@/lib/submission-validation";
import {
  getConfiguredSupabaseSubmissionStore,
  queueConfiguredSubmissionMirror,
} from "@/lib/configured-submission-backends";

export const VALUE_STREAMS = ["1", "2", "3", "4"] as const;

export type ValueStream = (typeof VALUE_STREAMS)[number];

export interface Submission {
  id: string;
  plant: PlantName;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCases: [string, string, string, string];
  valueStreams: ValueStream[];
  expectedBenefits: string;
  status: SubmissionStatus;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
}

interface SubmissionRow {
  id: string;
  plant: PlantName;
  submitter_name: string;
  submitter_email: string;
  designation: string;
  use_case_1: string;
  use_case_2: string;
  use_case_3: string;
  use_case_4: string;
  value_stream_1_selected: number;
  value_stream_2_selected: number;
  value_stream_3_selected: number;
  value_stream_4_selected: number;
  expected_benefits: string;
  status: SubmissionStatus;
  is_visible: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
}

interface CreateSubmissionInput {
  plant: PlantName;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCases: [string, string, string, string];
  valueStreams: ValueStream[];
  expectedBenefits: string;
  action: "draft" | "submit";
}

interface UpdateSubmissionInput {
  plant?: PlantName;
  submitterName?: string;
  submitterEmail?: string;
  designation?: string;
  useCases?: [string, string, string, string];
  valueStreams?: ValueStream[];
  expectedBenefits?: string;
  status?: SubmissionStatus;
  isVisible?: boolean;
}

export interface SubmissionFilters {
  presentation?: boolean;
  plant?: PlantName;
  status?: SubmissionStatus;
  isVisible?: boolean;
}

const PLANT_SET = new Set<string>(PLANT_NAMES);
const STATUS_SET = new Set<string>(SUBMISSION_STATUSES);
const VALUE_STREAM_SET = new Set<string>(VALUE_STREAMS);
const SELECT_SUBMISSION_COLUMNS = `
SELECT
  id,
  plant,
  submitter_name,
  submitter_email,
  designation,
  use_case_1,
  use_case_2,
  use_case_3,
  use_case_4,
  value_stream_1_selected,
  value_stream_2_selected,
  value_stream_3_selected,
  value_stream_4_selected,
  expected_benefits,
  status,
  is_visible,
  created_at,
  updated_at,
  submitted_at,
  reviewed_at
FROM workshop_submissions`;

export class SubmissionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: string[],
  ) {
    super(message);
    this.name = "SubmissionError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseString(
  value: unknown,
  field: string,
  maximumLength: number,
  fallback = "",
): string {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new SubmissionError(`${field} must be a string`, 400);
  }

  const parsed = value.trim();
  if (parsed.length > maximumLength) {
    throw new SubmissionError(
      `${field} must be ${maximumLength} characters or fewer`,
      400,
    );
  }

  return parsed;
}

function parsePlant(value: unknown): PlantName {
  if (typeof value !== "string" || !PLANT_SET.has(value)) {
    throw new SubmissionError(
      `plant must be one of: ${PLANT_NAMES.join(", ")}`,
      400,
    );
  }

  return value as PlantName;
}

function parseStatus(value: unknown): SubmissionStatus {
  if (typeof value !== "string" || !STATUS_SET.has(value)) {
    throw new SubmissionError(
      `status must be one of: ${SUBMISSION_STATUSES.join(", ")}`,
      400,
    );
  }

  return value as SubmissionStatus;
}

function parseUseCases(
  value: unknown,
  fallback: [string, string, string, string] = ["", "", "", ""],
): [string, string, string, string] {
  if (value === undefined) {
    return fallback;
  }

  if (!Array.isArray(value) || value.length !== 4) {
    throw new SubmissionError(
      "useCases must contain exactly four fixed slots",
      400,
    );
  }

  return [
    parseString(value[0], "useCases[0]", 2_000),
    parseString(value[1], "useCases[1]", 2_000),
    parseString(value[2], "useCases[2]", 2_000),
    parseString(value[3], "useCases[3]", 2_000),
  ];
}

function parseValueStreams(
  value: unknown,
  fallback: ValueStream[] = [],
): ValueStream[] {
  if (value === undefined) {
    return fallback;
  }

  if (!Array.isArray(value)) {
    throw new SubmissionError("valueStreams must be an array", 400);
  }

  const uniqueValues = new Set<ValueStream>();
  for (const item of value) {
    if (typeof item !== "string" || !VALUE_STREAM_SET.has(item)) {
      throw new SubmissionError(
        `valueStreams may only contain: ${VALUE_STREAMS.join(", ")}`,
        400,
      );
    }
    uniqueValues.add(item as ValueStream);
  }

  return VALUE_STREAMS.filter((item) => uniqueValues.has(item));
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new SubmissionError(`${field} must be a boolean`, 400);
  }

  return value;
}

function assertComplete(submission: {
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCases: readonly string[];
  valueStreams: readonly ValueStream[];
  expectedBenefits: string;
}): void {
  const details = getSubmissionCompletionErrors(submission);

  if (details.length > 0) {
    throw new SubmissionError(
      "The response cannot be submitted",
      422,
      details,
    );
  }
}

function mapRow(row: SubmissionRow): Submission {
  const valueStreams = VALUE_STREAMS.filter(
    (_, index) =>
      [
        row.value_stream_1_selected,
        row.value_stream_2_selected,
        row.value_stream_3_selected,
        row.value_stream_4_selected,
      ][index] === 1,
  );

  return {
    id: row.id,
    plant: row.plant,
    submitterName: row.submitter_name,
    submitterEmail: row.submitter_email,
    designation: row.designation,
    useCases: [row.use_case_1, row.use_case_2, row.use_case_3, row.use_case_4],
    valueStreams,
    expectedBenefits: row.expected_benefits,
    status: row.status,
    isVisible: row.is_visible === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
  };
}

async function findSubmissionRow(id: string): Promise<SubmissionRow | null> {
  const database = await getDatabase();
  return database
    .prepare(`${SELECT_SUBMISSION_COLUMNS} WHERE id = ?1`)
    .bind(id)
    .first<SubmissionRow>();
}

export function parseCreateSubmission(value: unknown): CreateSubmissionInput {
  if (!isObject(value)) {
    throw new SubmissionError("Request body must be a JSON object", 400);
  }

  const action = value.action ?? "draft";
  if (action !== "draft" && action !== "submit") {
    throw new SubmissionError("action must be either draft or submit", 400);
  }

  const input: CreateSubmissionInput = {
    plant: parsePlant(value.plant),
    submitterName: parseString(value.submitterName, "submitterName", 120),
    submitterEmail: parseString(value.submitterEmail, "submitterEmail", 254),
    designation: parseString(value.designation, "designation", 160),
    useCases: parseUseCases(value.useCases),
    valueStreams: parseValueStreams(value.valueStreams),
    expectedBenefits: parseString(
      value.expectedBenefits,
      "expectedBenefits",
      4_000,
    ),
    action,
  };

  if (action === "submit") {
    assertComplete(input);
  }

  return input;
}

export function parseUpdateSubmission(value: unknown): UpdateSubmissionInput {
  if (!isObject(value)) {
    throw new SubmissionError("Request body must be a JSON object", 400);
  }

  const recognizedFields = [
    "plant",
    "submitterName",
    "submitterEmail",
    "designation",
    "useCases",
    "valueStreams",
    "expectedBenefits",
    "status",
    "isVisible",
  ];

  if (!recognizedFields.some((field) => hasOwn(value, field))) {
    throw new SubmissionError("No supported fields were provided", 400);
  }

  const input: UpdateSubmissionInput = {};
  if (hasOwn(value, "plant")) input.plant = parsePlant(value.plant);
  if (hasOwn(value, "submitterName")) {
    input.submitterName = parseString(value.submitterName, "submitterName", 120);
  }
  if (hasOwn(value, "submitterEmail")) {
    input.submitterEmail = parseString(value.submitterEmail, "submitterEmail", 254);
  }
  if (hasOwn(value, "designation")) {
    input.designation = parseString(value.designation, "designation", 160);
  }
  if (hasOwn(value, "useCases")) input.useCases = parseUseCases(value.useCases);
  if (hasOwn(value, "valueStreams")) {
    input.valueStreams = parseValueStreams(value.valueStreams);
  }
  if (hasOwn(value, "expectedBenefits")) {
    input.expectedBenefits = parseString(
      value.expectedBenefits,
      "expectedBenefits",
      4_000,
    );
  }
  if (hasOwn(value, "status")) input.status = parseStatus(value.status);
  if (hasOwn(value, "isVisible")) {
    input.isVisible = parseBoolean(value.isVisible, "isVisible");
  }

  return input;
}

export function parsePlantFilter(value: string | null): PlantName | undefined {
  return value === null ? undefined : parsePlant(value);
}

export function parseStatusFilter(
  value: string | null,
): SubmissionStatus | undefined {
  return value === null ? undefined : parseStatus(value);
}

export function parseBooleanFilter(
  value: string | null,
  field: string,
): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new SubmissionError(`${field} must be true or false`, 400);
}

export async function createSubmission(
  input: CreateSubmissionInput,
): Promise<Submission> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status: SubmissionStatus =
    input.action === "submit" ? "submitted" : "draft";
  const pending: Submission = {
    id,
    plant: input.plant,
    submitterName: input.submitterName,
    submitterEmail: input.submitterEmail,
    designation: input.designation,
    useCases: input.useCases,
    valueStreams: input.valueStreams,
    expectedBenefits: input.expectedBenefits,
    status,
    isVisible: false,
    createdAt: now,
    updatedAt: now,
    submittedAt: status === "submitted" ? now : null,
    reviewedAt: null,
  };

  const externalStore = getConfiguredSupabaseSubmissionStore();
  if (externalStore) {
    const created = await externalStore.create(pending);
    queueConfiguredSubmissionMirror("submission.created", created);
    return created;
  }

  const database = await getDatabase();
  const selected = new Set<ValueStream>(input.valueStreams);

  await database
    .prepare(`
INSERT INTO workshop_submissions (
  id,
  plant,
  submitter_name,
  submitter_email,
  designation,
  use_case_1,
  use_case_2,
  use_case_3,
  use_case_4,
  value_stream_1_selected,
  value_stream_2_selected,
  value_stream_3_selected,
  value_stream_4_selected,
  expected_benefits,
  status,
  is_visible,
  created_at,
  updated_at,
  submitted_at,
  reviewed_at
) VALUES (
  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 0, ?16, ?16, ?17, NULL
)`)
    .bind(
      id,
      input.plant,
      input.submitterName,
      input.submitterEmail,
      input.designation,
      input.useCases[0],
      input.useCases[1],
      input.useCases[2],
      input.useCases[3],
      selected.has("1") ? 1 : 0,
      selected.has("2") ? 1 : 0,
      selected.has("3") ? 1 : 0,
      selected.has("4") ? 1 : 0,
      input.expectedBenefits,
      status,
      now,
      status === "submitted" ? now : null,
    )
    .run();

  const created = await findSubmissionRow(id);
  if (!created) {
    throw new Error("The response was saved but could not be read back");
  }

  const submission = mapRow(created);
  queueConfiguredSubmissionMirror("submission.created", submission);
  return submission;
}

export async function getSubmission(id: string): Promise<Submission> {
  const externalStore = getConfiguredSupabaseSubmissionStore();
  if (externalStore) {
    const submission = await externalStore.get(id);
    if (!submission) {
      throw new SubmissionError("Response not found", 404);
    }
    return submission;
  }

  const row = await findSubmissionRow(id);
  if (!row) {
    throw new SubmissionError("Response not found", 404);
  }
  return mapRow(row);
}

export async function listSubmissions(
  filters: SubmissionFilters,
): Promise<Submission[]> {
  const externalStore = getConfiguredSupabaseSubmissionStore();
  if (externalStore) {
    return externalStore.list(filters);
  }

  const database = await getDatabase();
  const clauses: string[] = [];
  const bindings: Array<string | number> = [];

  if (filters.presentation) {
    clauses.push("status = 'approved'", "is_visible = 1");
  }
  if (filters.plant) {
    bindings.push(filters.plant);
    clauses.push(`plant = ?${bindings.length}`);
  }
  if (filters.status) {
    bindings.push(filters.status);
    clauses.push(`status = ?${bindings.length}`);
  }
  if (filters.isVisible !== undefined) {
    bindings.push(filters.isVisible ? 1 : 0);
    clauses.push(`is_visible = ?${bindings.length}`);
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  const statement = database.prepare(
    `${SELECT_SUBMISSION_COLUMNS}${where} ORDER BY created_at DESC, id DESC`,
  );
  const result = await (bindings.length > 0
    ? statement.bind(...bindings)
    : statement
  ).all<SubmissionRow>();

  return (result.results ?? []).map(mapRow);
}

export async function updateSubmission(
  id: string,
  input: UpdateSubmissionInput,
): Promise<Submission> {
  const existing = await getSubmission(id);
  const now = new Date().toISOString();
  const next: Submission = {
    ...existing,
    ...input,
    useCases: input.useCases ?? existing.useCases,
    valueStreams: input.valueStreams ?? existing.valueStreams,
    updatedAt: now,
  };

  if (requiresCompleteResponse(next.status)) {
    assertComplete(next);
  }

  if (input.isVisible === true && next.status !== "approved") {
    throw new SubmissionError(
      "Only approved responses can be shown in the presentation",
      409,
    );
  }

  if (input.status === "approved") {
    next.isVisible = true;
  } else if (next.status !== "approved") {
    next.isVisible = false;
  }

  if (input.status === "submitted") {
    next.submittedAt = existing.submittedAt ?? now;
    next.reviewedAt = null;
  } else if (input.status === "approved" || input.status === "rejected") {
    next.submittedAt = existing.submittedAt ?? now;
    next.reviewedAt = now;
  }

  const externalStore = getConfiguredSupabaseSubmissionStore();
  if (externalStore) {
    const updated = await externalStore.update(next, existing.updatedAt);
    if (!updated) {
      throw new SubmissionError(
        "This response changed while it was being updated. Refresh and try again.",
        409,
      );
    }
    queueConfiguredSubmissionMirror("submission.updated", updated);
    return updated;
  }

  const selected = new Set<ValueStream>(next.valueStreams);
  const database = await getDatabase();
  const result = await database
    .prepare(`
UPDATE workshop_submissions
SET
  plant = ?1,
  submitter_name = ?2,
  submitter_email = ?3,
  designation = ?4,
  use_case_1 = ?5,
  use_case_2 = ?6,
  use_case_3 = ?7,
  use_case_4 = ?8,
  value_stream_1_selected = ?9,
  value_stream_2_selected = ?10,
  value_stream_3_selected = ?11,
  value_stream_4_selected = ?12,
  expected_benefits = ?13,
  status = ?14,
  is_visible = ?15,
  updated_at = ?16,
  submitted_at = ?17,
  reviewed_at = ?18
WHERE id = ?19 AND updated_at = ?20`)
    .bind(
      next.plant,
      next.submitterName,
      next.submitterEmail,
      next.designation,
      next.useCases[0],
      next.useCases[1],
      next.useCases[2],
      next.useCases[3],
      selected.has("1") ? 1 : 0,
      selected.has("2") ? 1 : 0,
      selected.has("3") ? 1 : 0,
      selected.has("4") ? 1 : 0,
      next.expectedBenefits,
      next.status,
      next.isVisible ? 1 : 0,
      now,
      next.submittedAt,
      next.reviewedAt,
      id,
      existing.updatedAt,
    )
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    throw new SubmissionError(
      "This response changed while it was being updated. Refresh and try again.",
      409,
    );
  }

  const updated = await getSubmission(id);
  queueConfiguredSubmissionMirror("submission.updated", updated);
  return updated;
}

export function submissionErrorResponse(error: unknown): Response {
  if (error instanceof SubmissionError) {
    return Response.json(
      {
        error: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  if (error instanceof SyntaxError) {
    return Response.json({ error: "Request body must contain valid JSON" }, { status: 400 });
  }

  console.error("Submission API error", error);
  return Response.json(
    { error: "Unable to process the response right now" },
    { status: 500 },
  );
}
