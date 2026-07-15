import type {
  StoredSubmission,
  StoredValueStream,
  SubmissionStore,
  SubmissionStoreFilters,
} from "./submission-store-contract.ts";
import type { SupabaseSubmissionConfig } from "./submission-backend-config.ts";

interface SupabaseSubmissionRow {
  id: string;
  plant: StoredSubmission["plant"];
  submitter_name: string;
  submitter_email: string;
  designation: string;
  use_case_1: string;
  use_case_2: string;
  use_case_3: string;
  use_case_4: string;
  value_stream_1_selected: boolean;
  value_stream_2_selected: boolean;
  value_stream_3_selected: boolean;
  value_stream_4_selected: boolean;
  expected_benefits: string;
  status: StoredSubmission["status"];
  is_visible: boolean;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
}

export interface SupabaseSubmissionStoreOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class SupabaseSubmissionStoreError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(
    message: string,
    status: number | null,
    code: string | null = null,
  ) {
    super(message);
    this.name = "SupabaseSubmissionStoreError";
    this.status = status;
    this.code = code;
  }
}

const TABLE = "workshop_submissions";
const SELECT_COLUMNS = [
  "id",
  "plant",
  "submitter_name",
  "submitter_email",
  "designation",
  "use_case_1",
  "use_case_2",
  "use_case_3",
  "use_case_4",
  "value_stream_1_selected",
  "value_stream_2_selected",
  "value_stream_3_selected",
  "value_stream_4_selected",
  "expected_benefits",
  "status",
  "is_visible",
  "created_at",
  "updated_at",
  "submitted_at",
  "reviewed_at",
].join(",");

function selectedValueStreams(row: SupabaseSubmissionRow): StoredValueStream[] {
  const flags = [
    row.value_stream_1_selected,
    row.value_stream_2_selected,
    row.value_stream_3_selected,
    row.value_stream_4_selected,
  ];
  return (["1", "2", "3", "4"] as const).filter(
    (_, index) => flags[index],
  );
}

function fromRow(row: SupabaseSubmissionRow): StoredSubmission {
  return {
    id: row.id,
    plant: row.plant,
    submitterName: row.submitter_name,
    submitterEmail: row.submitter_email,
    designation: row.designation,
    useCases: [row.use_case_1, row.use_case_2, row.use_case_3, row.use_case_4],
    valueStreams: selectedValueStreams(row),
    expectedBenefits: row.expected_benefits,
    status: row.status,
    isVisible: row.is_visible,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
  };
}

function toRow(submission: StoredSubmission): SupabaseSubmissionRow {
  const selected = new Set(submission.valueStreams);
  return {
    id: submission.id,
    plant: submission.plant,
    submitter_name: submission.submitterName,
    submitter_email: submission.submitterEmail,
    designation: submission.designation,
    use_case_1: submission.useCases[0],
    use_case_2: submission.useCases[1],
    use_case_3: submission.useCases[2],
    use_case_4: submission.useCases[3],
    value_stream_1_selected: selected.has("1"),
    value_stream_2_selected: selected.has("2"),
    value_stream_3_selected: selected.has("3"),
    value_stream_4_selected: selected.has("4"),
    expected_benefits: submission.expectedBenefits,
    status: submission.status,
    is_visible: submission.isVisible,
    created_at: submission.createdAt,
    updated_at: submission.updatedAt,
    submitted_at: submission.submittedAt,
    reviewed_at: submission.reviewedAt,
  };
}

function errorDetails(body: string): { message: string; code: string | null } {
  try {
    const parsed = JSON.parse(body) as {
      message?: unknown;
      details?: unknown;
      code?: unknown;
    };
    const message = [parsed.message, parsed.details]
      .filter((part): part is string => typeof part === "string" && Boolean(part))
      .join(": ");
    return {
      message: message || "Supabase rejected the storage request",
      code: typeof parsed.code === "string" ? parsed.code : null,
    };
  } catch {
    return {
      message: body.slice(0, 500) || "Supabase rejected the storage request",
      code: null,
    };
  }
}

export function createSupabaseSubmissionStore(
  config: SupabaseSubmissionConfig,
  options: SupabaseSubmissionStoreOptions = {},
): SubmissionStore {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const baseUrl = `${config.url.replace(/\/$/, "")}/rest/v1/${TABLE}`;

  const request = async <T>(
    url: URL,
    init: RequestInit = {},
  ): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("apikey", config.secretKey);
    if (/^eyJ[A-Za-z0-9_-]+\./.test(config.secretKey)) {
      headers.set("Authorization", `Bearer ${config.secretKey}`);
    }
    if (init.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new SupabaseSubmissionStoreError(
        error instanceof Error
          ? `Unable to reach Supabase: ${error.message}`
          : "Unable to reach Supabase",
        null,
      );
    }

    const body = await response.text();
    if (!response.ok) {
      const details = errorDetails(body);
      throw new SupabaseSubmissionStoreError(
        details.message,
        response.status,
        details.code,
      );
    }

    return (body ? JSON.parse(body) : null) as T;
  };

  const collectionUrl = (): URL => {
    const url = new URL(baseUrl);
    url.searchParams.set("select", SELECT_COLUMNS);
    return url;
  };

  return {
    async create(submission) {
      const url = collectionUrl();
      const rows = await request<SupabaseSubmissionRow[]>(url, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(toRow(submission)),
      });
      if (rows.length !== 1) {
        throw new SupabaseSubmissionStoreError(
          "Supabase saved the response but did not return it",
          null,
        );
      }
      return fromRow(rows[0]);
    },

    async get(id) {
      const url = collectionUrl();
      url.searchParams.append("id", `eq.${id}`);
      url.searchParams.set("limit", "1");
      const rows = await request<SupabaseSubmissionRow[]>(url);
      return rows[0] ? fromRow(rows[0]) : null;
    },

    async list(filters: SubmissionStoreFilters) {
      const url = collectionUrl();
      if (filters.presentation) {
        url.searchParams.append("status", "eq.approved");
        url.searchParams.append("is_visible", "eq.true");
      }
      if (filters.plant) {
        url.searchParams.append("plant", `eq.${filters.plant}`);
      }
      if (filters.status) {
        url.searchParams.append("status", `eq.${filters.status}`);
      }
      if (filters.isVisible !== undefined) {
        url.searchParams.append(
          "is_visible",
          `eq.${filters.isVisible ? "true" : "false"}`,
        );
      }
      url.searchParams.set("order", "created_at.desc,id.desc");
      url.searchParams.set("limit", "1000");
      const rows = await request<SupabaseSubmissionRow[]>(url);
      return rows.map(fromRow);
    },

    async update(submission, expectedUpdatedAt) {
      const url = collectionUrl();
      url.searchParams.append("id", `eq.${submission.id}`);
      url.searchParams.append("updated_at", `eq.${expectedUpdatedAt}`);
      const rows = await request<SupabaseSubmissionRow[]>(url, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(toRow(submission)),
      });
      return rows[0] ? fromRow(rows[0]) : null;
    },
  };
}
