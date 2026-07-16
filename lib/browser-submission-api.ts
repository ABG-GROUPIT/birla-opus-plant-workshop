import type {
  PlantName,
  SubmissionStatus,
} from "./submission-domain.ts";
import {
  REFERENCE_LIMITS,
  classifyReferenceFile,
  sanitizeReferenceFileName,
} from "./reference-media.ts";
import type { ReferenceKind } from "./reference-media.ts";
import { Upload } from "tus-js-client";

export type BrowserValueStream = "1" | "2" | "3" | "4";

const REFERENCE_BUCKET = "workshop-references";
const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;

export interface BrowserReferenceMedia {
  id: string;
  title: string;
  kind: ReferenceKind;
  externalUrl: string | null;
  objectPath: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  isVisible: boolean;
  sortOrder: number;
  /** Direct browser-safe URL for either an HTTPS link or a stored object. */
  openUrl: string;
}

export interface ReferenceUploadSession {
  sessionId: string;
  uploadToken: string;
  expiresAt: string | null;
}

export interface ReferenceUploadTransport {
  endpoint: string;
  headers: Record<string, string>;
  objectPath: string;
}

export interface ReferenceManifestInput {
  title: string;
  kind: ReferenceKind;
  externalUrl?: string | null;
  objectPath?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sortOrder?: number;
}

export interface AdminReferenceUpdateInput {
  id: string;
  title: string;
  externalUrl: string | null;
  isVisible: boolean;
}

export interface BrowserSubmission {
  id: string;
  plant: PlantName;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCaseTitle: string;
  useCaseTheme: string;
  /** Legacy four-slot shape retained while older published clients drain. */
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
  references: BrowserReferenceMedia[];
}

export type PublicBrowserSubmission = Pick<
  BrowserSubmission,
  | "id"
  | "plant"
  | "submitterName"
  | "createdAt"
  | "useCaseTitle"
  | "useCaseTheme"
  | "useCases"
  | "valueStreams"
  | "expectedBenefits"
  | "status"
  | "isVisible"
  | "references"
>;

export interface SubmitWorkshopResponseInput {
  plant: PlantName;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCaseTitle: string;
  useCaseTheme: string;
  valueStreams: readonly BrowserValueStream[];
  expectedBenefits: string;
  references?: readonly ReferenceManifestInput[];
  mediaSession?: ReferenceUploadSession | null;
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
  useCaseTitle: string;
  useCaseTheme: string;
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

function storageUploadEndpoint(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname.endsWith(".supabase.co")) {
    const projectRef = parsed.hostname.slice(0, -".supabase.co".length);
    return `${parsed.protocol}//${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  }
  return `${url.replace(/\/+$/, "")}/storage/v1/upload/resumable`;
}

function requiredSingleValueStream(
  valueStreams: readonly BrowserValueStream[],
): BrowserValueStream {
  if (valueStreams.length !== 1) {
    throw new BrowserSubmissionApiError(
      "Choose exactly one value stream.",
      null,
      "invalid_value_stream",
    );
  }
  return valueStreams[0];
}

/** Browser-safe TUS request settings for one capability-scoped upload slot. */
export function referenceUploadTransport(
  session: ReferenceUploadSession,
  slot: number,
): ReferenceUploadTransport {
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) {
    throw new BrowserSubmissionApiError(
      "Reference file slot must be 1, 2, or 3.",
      null,
      "invalid_reference_slot",
    );
  }

  const config = browserApiConfig();
  return {
    endpoint: storageUploadEndpoint(config.url),
    headers: {
      apikey: config.publishableKey,
      authorization: `Bearer ${config.publishableKey}`,
    },
    objectPath: `${session.sessionId}/${session.uploadToken}/${slot}`,
  };
}

function encodedObjectPath(path: string): string {
  return path
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function publicObjectUrl(path: string): string {
  const { url } = browserApiConfig();
  return `${url}/storage/v1/object/public/${REFERENCE_BUCKET}/${encodedObjectPath(path)}`;
}

function secureExternalUrl(value: unknown): string | null {
  const text = errorText(value);
  if (!text) return null;

  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function referenceKind(value: unknown): ReferenceKind | null {
  return [
    "link",
    "pdf",
    "powerpoint",
    "word",
    "spreadsheet",
    "image",
  ].includes(String(value))
    ? (String(value) as ReferenceKind)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normaliseReferenceMedia(
  value: unknown,
  index = 0,
): BrowserReferenceMedia | null {
  if (!isRecord(value)) return null;

  const kind = referenceKind(value.kind);
  const id = errorText(value.id);
  if (!kind || !id) return null;

  const objectPath = errorText(value.objectPath);
  const externalUrl = secureExternalUrl(value.externalUrl);
  const fileName = errorText(value.fileName);
  const mimeType = errorText(value.mimeType);
  const rawSize = finiteNumber(value.sizeBytes);
  const sizeBytes = rawSize !== null && rawSize >= 0 ? Math.floor(rawSize) : null;
  const rawSortOrder = finiteNumber(value.sortOrder);
  const sortOrder = rawSortOrder === null ? index : Math.floor(rawSortOrder);

  return {
    id,
    title: errorText(value.title) ?? fileName ?? "Reference material",
    kind,
    externalUrl,
    objectPath,
    fileName,
    mimeType,
    sizeBytes,
    isVisible: value.isVisible !== false,
    sortOrder,
    openUrl: externalUrl ?? (objectPath ? publicObjectUrl(objectPath) : ""),
  };
}

function withNormalisedReferences<T>(row: T): T {
  if (!isRecord(row)) return row;
  const legacyUseCases = Array.isArray(row.useCases)
    ? row.useCases.map((value) => errorText(value) ?? "").slice(0, 4)
    : [];
  const legacyIndex = legacyUseCases.findIndex(Boolean);
  const references = Array.isArray(row.references)
    ? row.references
        .map((reference, index) => normaliseReferenceMedia(reference, index))
        .filter((reference): reference is BrowserReferenceMedia => Boolean(reference))
        .sort((left, right) => left.sortOrder - right.sortOrder)
    : [];

  return {
    ...row,
    useCaseTitle:
      errorText(row.useCaseTitle) ??
      (legacyIndex >= 0 ? `Use Case ${legacyIndex + 1}` : ""),
    useCaseTheme:
      errorText(row.useCaseTheme) ??
      (legacyIndex >= 0 ? legacyUseCases[legacyIndex] : ""),
    references,
  } as T;
}

function referenceUploadSession(payload: unknown): ReferenceUploadSession {
  const envelope = isRecord(payload) ? payload : null;
  const candidate = envelope && isRecord(envelope.session)
    ? envelope.session
    : envelope;
  const sessionId = candidate
    ? errorText(candidate.sessionId) ??
      errorText(candidate.session_id) ??
      errorText(candidate.id)
    : null;
  const uploadToken = candidate
    ? errorText(candidate.uploadToken) ??
      errorText(candidate.upload_token) ??
      errorText(candidate.token) ??
      errorText(candidate.sessionToken) ??
      errorText(candidate.capability)
    : null;

  if (!candidate || !sessionId || !uploadToken) {
    throw new BrowserSubmissionApiError(
      "The workshop data service did not return a valid media upload session.",
      null,
      "invalid_response",
    );
  }

  return {
    sessionId,
    uploadToken,
    expiresAt: errorText(candidate.expiresAt) ?? errorText(candidate.expires_at),
  };
}

function referenceManifestPayload(
  reference: ReferenceManifestInput,
  index: number,
): Record<string, unknown> {
  return {
    title: reference.title.trim(),
    kind: reference.kind,
    externalUrl: reference.externalUrl?.trim() || null,
    objectPath: reference.objectPath?.trim() || null,
    fileName: reference.fileName?.trim() || null,
    mimeType: reference.mimeType?.trim() || null,
    sizeBytes: reference.sizeBytes ?? null,
    sortOrder: reference.sortOrder ?? index,
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

  return {
    submissions: rows.map((row) => withNormalisedReferences(row)) as T[],
    count,
  };
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

  return withNormalisedReferences(candidate) as unknown as BrowserSubmission;
}

function updatedReference(payload: unknown): BrowserReferenceMedia {
  const envelope = isRecord(payload) ? payload : null;
  const candidate = envelope && isRecord(envelope.reference)
    ? envelope.reference
    : envelope;
  const reference = normaliseReferenceMedia(candidate);

  if (!reference) {
    throw new BrowserSubmissionApiError(
      "The workshop data service did not return the updated reference material.",
      null,
      "invalid_response",
    );
  }
  return reference;
}

export async function listPresentationSubmissions(): Promise<
  BrowserSubmissionList<PublicBrowserSubmission>
> {
  return submissionList<PublicBrowserSubmission>(
    await callRpc("workshop_public_list", {}),
  );
}

export async function createReferenceUploadSession(): Promise<ReferenceUploadSession> {
  return referenceUploadSession(
    await callRpc("workshop_media_session_create", {}),
  );
}

export async function uploadReferenceFile(
  session: ReferenceUploadSession,
  file: File,
  slot: number,
  onProgress?: (progress: number) => void,
): Promise<ReferenceManifestInput> {
  const classification = classifyReferenceFile(file);
  if (!classification || !classification.mimeMatches) {
    throw new BrowserSubmissionApiError(
      "Choose a supported PDF, Office document, or image.",
      null,
      "invalid_reference_file",
    );
  }

  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new BrowserSubmissionApiError(
      "Choose a non-empty reference file.",
      null,
      "invalid_reference_file",
    );
  }

  if (file.size > REFERENCE_LIMITS.maxFileBytes) {
    throw new BrowserSubmissionApiError(
      `Reference files must be ${Math.floor(REFERENCE_LIMITS.maxFileBytes / (1024 * 1024))} MB or smaller.`,
      null,
      "reference_file_too_large",
    );
  }

  const transport = referenceUploadTransport(session, slot);
  const safeFileName = sanitizeReferenceFileName(file.name);
  const objectPath = transport.objectPath;
  const kind = classification.kind;
  const mimeType = classification.mimeType;

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: transport.endpoint,
      retryDelays: [0, 1_000, 3_000, 5_000, 10_000],
      headers: transport.headers,
      metadata: {
        bucketName: REFERENCE_BUCKET,
        objectName: objectPath,
        contentType: mimeType,
        cacheControl: "3600",
      },
      chunkSize: TUS_CHUNK_SIZE_BYTES,
      fingerprint: async () => [
        "birla-opus-reference",
        session.sessionId,
        String(slot),
        safeFileName,
        String(file.size),
        String(file.lastModified),
      ].join("-"),
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      onError(error) {
        reject(
          new BrowserSubmissionApiError(
            error.message || "The reference file could not be uploaded.",
            null,
            "reference_upload_failed",
          ),
        );
      },
      onProgress(bytesUploaded, bytesTotal) {
        onProgress?.(bytesTotal > 0 ? bytesUploaded / bytesTotal : 0);
      },
      onSuccess() {
        onProgress?.(1);
        resolve();
      },
    });

    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }
      upload.start();
    }).catch((error: unknown) => {
      reject(
        new BrowserSubmissionApiError(
          error instanceof Error && error.message
            ? error.message
            : "The reference upload could not be started.",
          null,
          "reference_upload_failed",
        ),
      );
    });
  });

  return {
    title: safeFileName,
    kind,
    externalUrl: null,
    objectPath,
    fileName: safeFileName,
    mimeType,
    sizeBytes: file.size,
  };
}

export async function submitWorkshopResponse(
  input: SubmitWorkshopResponseInput,
): Promise<{ submission: SubmittedWorkshopResponse }> {
  const valueStream = requiredSingleValueStream(input.valueStreams);
  return {
    submission: submittedResponse(await callRpc("workshop_submit_single_use_case_with_references", {
      p_plant: input.plant,
      p_submitter_name: input.submitterName,
      p_submitter_email: input.submitterEmail,
      p_designation: input.designation,
      p_use_case_title: input.useCaseTitle,
      p_use_case_theme: input.useCaseTheme,
      p_value_stream: valueStream,
      p_expected_benefits: input.expectedBenefits,
      p_media_session_id: input.mediaSession?.sessionId ?? null,
      p_media_upload_token: input.mediaSession?.uploadToken ?? null,
      p_references: (input.references ?? []).map(referenceManifestPayload),
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
  const valueStream = requiredSingleValueStream(input.valueStreams);
  return {
    submission: updatedSubmission(await callRpc("workshop_admin_single_use_case_update", {
      p_capability: capability,
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_plant: input.plant,
      p_submitter_name: input.submitterName,
      p_submitter_email: input.submitterEmail,
      p_designation: input.designation,
      p_use_case_title: input.useCaseTitle,
      p_use_case_theme: input.useCaseTheme,
      p_value_stream: valueStream,
      p_expected_benefits: input.expectedBenefits,
      p_status: input.status,
    })),
  };
}

export async function updateAdminReference(
  capability: string,
  input: AdminReferenceUpdateInput,
): Promise<{ reference: BrowserReferenceMedia }> {
  return {
    reference: updatedReference(await callRpc("workshop_admin_reference_update", {
      p_capability: capability,
      p_reference_id: input.id,
      p_title: input.title,
      p_external_url: input.externalUrl,
      p_is_visible: input.isVisible,
    })),
  };
}
