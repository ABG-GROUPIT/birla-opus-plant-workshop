import {
  PLANT_NAMES,
  SUBMISSION_STATUSES,
  type PlantName,
  type SubmissionStatus,
} from "@/lib/submission-domain";
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
  useCaseTitle: string;
  useCaseTheme: string;
  /** Legacy projection retained for the direct Supabase adapter. */
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

interface CreateSubmissionInput {
  plant: PlantName;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCaseTitle: string;
  useCaseTheme: string;
  valueStreams: ValueStream[];
  expectedBenefits: string;
  action: "draft" | "submit";
}

interface UpdateSubmissionInput {
  plant?: PlantName;
  submitterName?: string;
  submitterEmail?: string;
  designation?: string;
  useCaseTitle?: string;
  useCaseTheme?: string;
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
  useCaseTitle: string;
  useCaseTheme: string;
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
    useCaseTitle: parseString(value.useCaseTitle, "useCaseTitle", 200),
    useCaseTheme: parseString(value.useCaseTheme, "useCaseTheme", 2_000),
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
    "useCaseTitle",
    "useCaseTheme",
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
  if (hasOwn(value, "useCaseTitle")) {
    input.useCaseTitle = parseString(value.useCaseTitle, "useCaseTitle", 200);
  }
  if (hasOwn(value, "useCaseTheme")) {
    input.useCaseTheme = parseString(value.useCaseTheme, "useCaseTheme", 2_000);
  }
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
    useCaseTitle: input.useCaseTitle,
    useCaseTheme: input.useCaseTheme,
    useCases: [input.useCaseTheme, "", "", ""],
    valueStreams: input.valueStreams,
    expectedBenefits: input.expectedBenefits,
    status,
    isVisible: false,
    createdAt: now,
    updatedAt: now,
    submittedAt: status === "submitted" ? now : null,
    reviewedAt: null,
  };

  const store = getConfiguredSupabaseSubmissionStore();
  const created = await store.create(pending);
  queueConfiguredSubmissionMirror("submission.created", created);
  return created;
}

export async function getSubmission(id: string): Promise<Submission> {
  const submission = await getConfiguredSupabaseSubmissionStore().get(id);
  if (!submission) {
    throw new SubmissionError("Response not found", 404);
  }
  return submission;
}

export async function listSubmissions(
  filters: SubmissionFilters,
): Promise<Submission[]> {
  return getConfiguredSupabaseSubmissionStore().list(filters);
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
    useCases: input.useCaseTheme === undefined
      ? existing.useCases
      : [input.useCaseTheme, "", "", ""],
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

  const updated = await getConfiguredSupabaseSubmissionStore().update(
    next,
    existing.updatedAt,
  );
  if (!updated) {
    throw new SubmissionError(
      "This response changed while it was being updated. Refresh and try again.",
      409,
    );
  }
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
