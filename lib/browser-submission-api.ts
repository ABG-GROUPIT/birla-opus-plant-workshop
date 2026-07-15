import type {
  PlantName,
  SubmissionStatus,
} from "./submission-domain.ts";

export type BrowserValueStream = "1" | "2" | "3" | "4";

export interface BrowserSubmission {
  id: string;
  plant: PlantName;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCases: [string, string, string, string];
  valueStreams: BrowserValueStream[];
  expectedBenefits: string;
  status: SubmissionStatus;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  referenceId?: string;
}

export type PublicBrowserSubmission = Pick<
  BrowserSubmission,
  | "id"
  | "plant"
  | "submitterName"
  | "useCases"
  | "valueStreams"
  | "expectedBenefits"
  | "status"
  | "isVisible"
>;

export interface SubmitWorkshopResponseInput {
  plant: PlantName;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCases: readonly [string, string, string, string];
  valueStreams: readonly BrowserValueStream[];
  expectedBenefits: string;
}

export interface SubmittedWorkshopResponse {
  id: string;
  referenceId: string;
  submittedAt: string | null;
}

export interface BrowserSubmissionList<T = BrowserSubmission> {
  submissions: T[];
  count: number;
}

export interface AdminSubmissionUpdateInput {
  id: string;
  expectedUpdatedAt: string;
  plant: PlantName;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCases: readonly [string, string, string, string];
  valueStreams: readonly BrowserValueStream[];
  expectedBenefits: string;
  status: SubmissionStatus;
}

interface PostgrestErrorPayload {
  code?: unknown;
  details?: unknown;
  error?: unknown;
  hint?: unknown;
  message?: unknown;
}

export class BrowserSubmissionApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly details: string | null;

  constructor(
    message: string,
    status: number | null,
    code: string | null = null,
    details: string | null = null,
  ) {
    super(message);
    this.name = "BrowserSubmissionApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function browserApiConfig(): { url: string; publishableKey: string } {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!configuredUrl || !publishableKey) {
    throw new BrowserSubmissionApiError(
      "The workshop data service is not configured for this site.",
      null,
      "missing_configuration",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new BrowserSubmissionApiError(
      "The workshop data service URL is invalid.",
      null,
      "invalid_configuration",
    );
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost") {
    throw new BrowserSubmissionApiError(
      "The workshop data service must use a secure URL.",
      null,
      "invalid_configuration",
    );
  }

  return {
    url: configuredUrl.replace(/\/+$/, ""),
    publishableKey,
  };
}

function errorText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function responsePayload(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body) return null;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function rpcError(response: Response, payload: unknown): BrowserSubmissionApiError {
  const record: PostgrestErrorPayload = isRecord(payload) ? payload : {};
  const message =
    errorText(record.message) ??
    errorText(record.error) ??
    (typeof payload === "string" ? errorText(payload) : null) ??
    `The workshop data service returned ${response.status}.`;

  return new BrowserSubmissionApiError(
    message,
    response.status,
    errorText(record.code),
    errorText(record.details) ?? errorText(record.hint),
  );
}

async function callRpc(
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const config = browserApiConfig();
  let response: Response;

  try {
    response = await fetch(
      `${config.url}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          apikey: config.publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parameters),
        cache: "no-store",
      },
    );
  } catch (error) {
    throw new BrowserSubmissionApiError(
      error instanceof Error && error.message
        ? `Unable to reach the workshop data service: ${error.message}`
        : "Unable to reach the workshop data service.",
      null,
      "network_error",
    );
  }

  const payload = await responsePayload(response);
  if (!response.ok) throw rpcError(response, payload);
  return payload;
}

function submissionList<T>(payload: unknown): BrowserSubmissionList<T> {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.submissions)
      ? payload.submissions
      : null;

  if (!rows) {
    throw new BrowserSubmissionApiError(
      "The workshop data service returned an invalid response list.",
      null,
      "invalid_response",
    );
  }

  const count =
    isRecord(payload) &&
    typeof payload.count === "number" &&
    Number.isFinite(payload.count)
      ? payload.count
      : rows.length;

  return { submissions: rows as T[], count };
}

function submittedResponse(payload: unknown): SubmittedWorkshopResponse {
  const envelope = isRecord(payload) ? payload : null;
  const submission =
    envelope && isRecord(envelope.submission) ? envelope.submission : envelope;
  const id = submission ? errorText(submission.id) : null;

  if (!submission || !id) {
    throw new BrowserSubmissionApiError(
      "The workshop data service did not return a response reference.",
      null,
      "invalid_response",
    );
  }

  const submittedAtValue = submission.submittedAt;
  const submittedAt =
    submittedAtValue === null ? null : errorText(submittedAtValue);

  return {
    id,
    referenceId:
      errorText(submission.referenceId) ??
      (envelope ? errorText(envelope.referenceId) : null) ??
      id,
    submittedAt,
  };
}

function updatedSubmission(payload: unknown): BrowserSubmission {
  const candidate =
    isRecord(payload) && isRecord(payload.submission)
      ? payload.submission
      : payload;

  if (!isRecord(candidate) || !errorText(candidate.id)) {
    throw new BrowserSubmissionApiError(
      "The workshop data service did not return the updated response.",
      null,
      "invalid_response",
    );
  }

  return candidate as unknown as BrowserSubmission;
}

export async function listPresentationSubmissions(): Promise<
  BrowserSubmissionList<PublicBrowserSubmission>
> {
  return submissionList<PublicBrowserSubmission>(
    await callRpc("workshop_public_list", {}),
  );
}

export async function submitWorkshopResponse(
  input: SubmitWorkshopResponseInput,
): Promise<{ submission: SubmittedWorkshopResponse }> {
  return {
    submission: submittedResponse(await callRpc("workshop_submit", {
      p_plant: input.plant,
      p_submitter_name: input.submitterName,
      p_submitter_email: input.submitterEmail,
      p_designation: input.designation,
      p_use_cases: input.useCases,
      p_value_stream: input.valueStreams[0] ?? null,
      p_expected_benefits: input.expectedBenefits,
    })),
  };
}

export async function listAdminSubmissions(
  capability: string,
): Promise<BrowserSubmissionList> {
  return submissionList<BrowserSubmission>(
    await callRpc("workshop_admin_list", { p_capability: capability }),
  );
}

export async function updateAdminSubmission(
  capability: string,
  input: AdminSubmissionUpdateInput,
): Promise<{ submission: BrowserSubmission }> {
  return {
    submission: updatedSubmission(await callRpc("workshop_admin_update", {
      p_capability: capability,
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_plant: input.plant,
      p_submitter_name: input.submitterName,
      p_submitter_email: input.submitterEmail,
      p_designation: input.designation,
      p_use_cases: input.useCases,
      p_value_stream: input.valueStreams[0] ?? null,
      p_expected_benefits: input.expectedBenefits,
      p_status: input.status,
    })),
  };
}
