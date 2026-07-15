import type { GoogleSheetsMirrorConfig } from "./submission-backend-config.ts";
import type { StoredSubmission } from "./submission-store-contract.ts";

export type SubmissionMirrorEvent = "submission.created" | "submission.updated";
export type BackgroundScheduler = (task: Promise<unknown>) => void;

export interface GoogleSheetsSubmissionMirrorOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface GoogleSheetsSubmissionMirror {
  queue(event: SubmissionMirrorEvent, submission: StoredSubmission): void;
}

/**
 * Creates a best-effort derivative mirror. Delivery failures are logged and
 * deliberately never reject or roll back the authoritative database write.
 */
export function createGoogleSheetsSubmissionMirror(
  config: GoogleSheetsMirrorConfig,
  schedule: BackgroundScheduler,
  options: GoogleSheetsSubmissionMirrorOptions = {},
): GoogleSheetsSubmissionMirror {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return {
    queue(event, submission) {
      const delivery = fetchImpl(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          secret: config.webhookSecret,
          event,
          occurredAt: new Date().toISOString(),
          submission,
        }),
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      })
        .then(async (response) => {
          const body = await response.text();
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          if (body) {
            try {
              const payload = JSON.parse(body) as { ok?: unknown };
              if (payload.ok === false) {
                throw new Error("Webhook rejected the mirror event");
              }
            } catch (error) {
              if (
                error instanceof Error &&
                error.message === "Webhook rejected the mirror event"
              ) {
                throw error;
              }
              // Apps Script may return plain text; a successful HTTP status is
              // sufficient when the response is not JSON.
            }
          }
        })
        .catch((error: unknown) => {
          console.warn(
            "Google Sheets submission mirror delivery failed",
            error instanceof Error ? error.message : "Unknown error",
          );
        });

      schedule(delivery);
    },
  };
}
