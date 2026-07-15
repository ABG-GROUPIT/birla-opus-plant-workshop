export interface SubmissionCompletionInput {
  submitterName: string;
  submitterEmail: string;
  useCases: readonly string[];
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

  const describedUseCaseCount = submission.useCases.filter(
    (description) => description.trim().length > 0,
  ).length;
  if (describedUseCaseCount === 0) {
    details.push("Choose one use case and provide its description");
  } else if (describedUseCaseCount > 1) {
    details.push("Only one use case may have a description");
  }

  if (submission.valueStreams.length === 0) {
    details.push("Select at least one value stream");
  }
  if (!submission.expectedBenefits) {
    details.push("expectedBenefits is required");
  }

  return details;
}
