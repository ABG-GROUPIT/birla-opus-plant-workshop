import {
  VALUE_STREAM_NAMES,
  type PlantName,
  type SubmissionStatus,
  type ValueStreamName,
} from "./submission-domain.ts";

export const STORED_VALUE_STREAMS = VALUE_STREAM_NAMES;

export type StoredValueStream = ValueStreamName;

/** Provider-neutral record used by the server-side Supabase adapter. */
export interface StoredSubmission {
  id: string;
  plant: PlantName;
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCaseTitle: string;
  useCaseTheme: string;
  /** Legacy storage projection retained for older server adapters. */
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
