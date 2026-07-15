import type { PlantName, SubmissionStatus } from "../db/schema.ts";

export const STORED_VALUE_STREAMS = ["1", "2", "3", "4"] as const;

export type StoredValueStream = (typeof STORED_VALUE_STREAMS)[number];

/** Provider-neutral record used by both the D1 fallback and Supabase. */
export interface StoredSubmission {
  id: string;
  plant: PlantName;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCases: [string, string, string, string];
  valueStreams: StoredValueStream[];
  expectedBenefits: string;
  status: SubmissionStatus;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
}

export interface SubmissionStoreFilters {
  presentation?: boolean;
  plant?: PlantName;
  status?: SubmissionStatus;
  isVisible?: boolean;
}

/**
 * A storage provider contains persistence only. Validation and workflow rules
 * remain in the submission service so every provider follows the same policy.
 */
export interface SubmissionStore {
  create(submission: StoredSubmission): Promise<StoredSubmission>;
  get(id: string): Promise<StoredSubmission | null>;
  list(filters: SubmissionStoreFilters): Promise<StoredSubmission[]>;
  update(
    submission: StoredSubmission,
    expectedUpdatedAt: string,
  ): Promise<StoredSubmission | null>;
}

