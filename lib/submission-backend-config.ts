export type SubmissionStorageMode = "supabase";

export interface SupabaseSubmissionConfig {
  url: string;
  secretKey: string;
}

export interface GoogleSheetsMirrorConfig {
  webhookUrl: string;
  webhookSecret: string;
}

export interface SubmissionBackendConfig {
  requestedStorage: SubmissionStorageMode;
  selectedStorage: "supabase";
  supabase: SupabaseSubmissionConfig;
  googleSheetsMirror: GoogleSheetsMirrorConfig | null;
}

export class SubmissionBackendConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionBackendConfigurationError";
  }
}

function optionalString(
  values: Readonly<Record<string, unknown>>,
  name: string,
): string | null {
  const value = values[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validatedUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SubmissionBackendConfigurationError(
      `${field} must be an absolute HTTP(S) URL`,
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SubmissionBackendConfigurationError(
      `${field} must be an absolute HTTP(S) URL`,
    );
  }
  if (url.username || url.password) {
    throw new SubmissionBackendConfigurationError(
      `${field} must not contain credentials`,
    );
  }

  return url.toString().replace(/\/$/, "");
}

/** Pure parser so configuration behavior can be tested without a runtime. */
export function parseSubmissionBackendConfig(
  values: Readonly<Record<string, unknown>>,
): SubmissionBackendConfig {
  const requestedStorage = (
    optionalString(values, "SUBMISSIONS_STORAGE") ?? "supabase"
  ).toLowerCase();
  if (requestedStorage !== "supabase") {
    throw new SubmissionBackendConfigurationError(
      "SUBMISSIONS_STORAGE must be supabase",
    );
  }

  const supabaseUrl = optionalString(values, "SUPABASE_URL");
  const currentSecret = optionalString(values, "SUPABASE_SECRET_KEY");
  const legacySecret = optionalString(values, "SUPABASE_SERVICE_ROLE_KEY");
  if (currentSecret && legacySecret && currentSecret !== legacySecret) {
    throw new SubmissionBackendConfigurationError(
      "Set only one Supabase server key, or make both key variables identical",
    );
  }
  const supabaseSecret = currentSecret ?? legacySecret;

  if (!supabaseUrl || !supabaseSecret) {
    throw new SubmissionBackendConfigurationError(
      "Supabase storage requires both SUPABASE_URL and SUPABASE_SECRET_KEY",
    );
  }
  const supabase: SupabaseSubmissionConfig = {
    url: validatedUrl(supabaseUrl, "SUPABASE_URL"),
    secretKey: supabaseSecret,
  };

  const webhookUrl = optionalString(values, "GOOGLE_SHEETS_WEBHOOK_URL");
  const webhookSecret = optionalString(values, "GOOGLE_SHEETS_WEBHOOK_SECRET");
  if (Boolean(webhookUrl) !== Boolean(webhookSecret)) {
    throw new SubmissionBackendConfigurationError(
      "Google Sheets mirroring requires both GOOGLE_SHEETS_WEBHOOK_URL and GOOGLE_SHEETS_WEBHOOK_SECRET",
    );
  }

  return {
    requestedStorage: "supabase",
    selectedStorage: "supabase",
    supabase,
    googleSheetsMirror:
      webhookUrl && webhookSecret
        ? {
            webhookUrl: validatedUrl(
              webhookUrl,
              "GOOGLE_SHEETS_WEBHOOK_URL",
            ),
            webhookSecret,
          }
        : null,
  };
}
