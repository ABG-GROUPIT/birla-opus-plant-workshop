import { env, waitUntil } from "cloudflare:workers";
import { createGoogleSheetsSubmissionMirror } from "./google-sheets-submission-mirror";
import {
  parseSubmissionBackendConfig,
  type SubmissionBackendConfig,
} from "./submission-backend-config";
import type {
  StoredSubmission,
  SubmissionStore,
} from "./submission-store-contract";
import { createSupabaseSubmissionStore } from "./supabase-submission-store";

let cachedConfig: SubmissionBackendConfig | undefined;
let cachedSupabaseStore: SubmissionStore | null | undefined;

export function getConfiguredSubmissionBackend(): SubmissionBackendConfig {
  cachedConfig ??= parseSubmissionBackendConfig(
    env as unknown as Readonly<Record<string, unknown>>,
  );
  return cachedConfig;
}

/** Returns null when the app should keep using its D1 demo/local store. */
export function getConfiguredSupabaseSubmissionStore(): SubmissionStore | null {
  if (cachedSupabaseStore !== undefined) return cachedSupabaseStore;
  const config = getConfiguredSubmissionBackend();
  cachedSupabaseStore = config.supabase
    ? createSupabaseSubmissionStore(config.supabase)
    : null;
  return cachedSupabaseStore;
}

/** Queue only after the authoritative D1 or Supabase mutation has succeeded. */
export function queueConfiguredSubmissionMirror(
  event: "submission.created" | "submission.updated",
  submission: StoredSubmission,
): void {
  const config = getConfiguredSubmissionBackend().googleSheetsMirror;
  if (!config) return;

  createGoogleSheetsSubmissionMirror(config, waitUntil).queue(event, submission);
}
