export interface SubmissionCompletionInput {
  submitterName: string;
  submitterEmail: string;
  designation: string;
  useCaseTitle: string;
  useCaseTheme: string;
  valueStreams: readonly string[];
  expectedBenefits: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requiresCompleteResponse(status: string): boolean {
  return status === "submitted" || status === "approved";
}

/**
 * Returns the user-facing reasons a response cannot enter the review flow.
 * Drafts deliberately skip this check so partially completed work can be saved.
 */
export function getSubmissionCompletionErrors(
  submission: SubmissionCompletionInput,
): string[] {
  const details: string[] = [];

  if (!submission.submitterName) {
    details.push("submitterName is required");
  }
  if (!submission.submitterEmail) {
    details.push("submitterEmail is required");
  } else if (!EMAIL_PATTERN.test(submission.submitterEmail)) {
    details.push("submitterEmail must be a valid email address");
  }
  if (!submission.designation) {
    details.push("designation is required");
  }

  if (!submission.useCaseTitle.trim()) {
    details.push("useCaseTitle is required");
  }
  if (!submission.useCaseTheme.trim()) {
    details.push("useCaseTheme is required");
  }

  if (submission.valueStreams.length === 0) {
    details.push("Select one value stream");
  } else if (submission.valueStreams.length > 1) {
    details.push("Only one value stream may be selected");
  }
  if (!submission.expectedBenefits) {
    details.push("expectedBenefits is required");
  }

  return details;
}
