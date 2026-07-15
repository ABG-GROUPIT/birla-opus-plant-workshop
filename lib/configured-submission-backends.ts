import { after } from "next/server";
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
let cachedSupabaseStore: SubmissionStore | undefined;

export function getConfiguredSubmissionBackend(): SubmissionBackendConfig {
  cachedConfig ??= parseSubmissionBackendConfig(
    process.env as Readonly<Record<string, unknown>>,
  );
  return cachedConfig;
}

export function getConfiguredSupabaseSubmissionStore(): SubmissionStore {
  if (cachedSupabaseStore) return cachedSupabaseStore;
  const config = getConfiguredSubmissionBackend();
  cachedSupabaseStore = createSupabaseSubmissionStore(config.supabase);
  return cachedSupabaseStore;
}

/** Queue only after the authoritative Supabase mutation has succeeded. */
export function queueConfiguredSubmissionMirror(
  event: "submission.created" | "submission.updated",
  submission: StoredSubmission,
): void {
  const config = getConfiguredSubmissionBackend().googleSheetsMirror;
  if (!config) return;

  createGoogleSheetsSubmissionMirror(config, (task) => {
    after(() => task);
  }).queue(event, submission);
}
