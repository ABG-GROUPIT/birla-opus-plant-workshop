# Submission backend setup

The website can run in two storage modes behind the same submission API:

- **D1 fallback:** used automatically when no Supabase credentials are present.
  This keeps local development and the current demo deployment working.
- **Supabase/Postgres:** recommended for the production workshop. The server
  talks to Supabase's Data REST API; the Supabase secret never enters browser
  code.

The browser-facing contract stays unchanged. Leaders submit through the custom
form, the admin page edits and approves the same records, and the presentation
query always adds `status = approved` and `is_visible = true` at the database
request boundary.

## 1. Create the production database

1. Create a Supabase project in the required organisation and region.
2. Run
   [`supabase/migrations/202607160001_workshop_submissions.sql`](../supabase/migrations/202607160001_workshop_submissions.sql)
   in the Supabase SQL editor or through the Supabase migration workflow.
3. Confirm that both `workshop_submissions` and
   `workshop_submission_audit` exist.

The migration:

- enforces the six plants and four workflow statuses;
- allows incomplete drafts but requires exactly one described use case and one
  value stream for submitted/approved responses;
- prevents any non-approved response from becoming presentation-visible;
- enables row-level security and removes direct `anon`/`authenticated` table
  access;
- grants server-side access to `service_role`; and
- records lightweight audit metadata (changed field names and status/visibility
  transitions) without copying leaders' freehand text into the audit table.

Supabase recommends enabling RLS on exposed tables and keeping secret/service
keys server-side. See the official [Data REST API](https://supabase.com/docs/guides/api),
[API key](https://supabase.com/docs/guides/getting-started/api-keys), and
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
documentation.

## 2. Configure runtime values

Copy `.env.example` to `.env` for local testing, or add the same values as
encrypted runtime secrets in the hosting control plane:

```dotenv
SUBMISSIONS_STORAGE=supabase
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_YOUR_SERVER_SECRET
```

Use a current Supabase `sb_secret_...` key. The adapter also accepts the legacy
JWT `service_role` key through `SUPABASE_SERVICE_ROLE_KEY`, but the current
server secret is preferred. Never prefix either variable with `NEXT_PUBLIC_`
and never commit the populated `.env` file.

Recommended production setting is `SUBMISSIONS_STORAGE=supabase`. It fails fast
if either credential is missing. The default `auto` mode selects Supabase only
when both values exist and otherwise uses D1. `SUBMISSIONS_STORAGE=d1` forces
the fallback explicitly.

Existing D1 rows are not copied automatically. Export/import them before the
workshop if existing demo responses must be retained.

## 3. Optional Google Sheet mirror

The Sheet is a best-effort derivative event log, never the source of truth.
Submission and admin update responses return as soon as Supabase/D1 succeeds;
Cloudflare `waitUntil` delivers the mirror in the background. A slow or broken
Sheet endpoint is logged but cannot roll back the database write.

Create a Google Apps Script bound to the target spreadsheet (or replace
`SPREADSHEET_ID` below), add a Script Property named `WEBHOOK_SECRET`, and use:

```javascript
const SPREADSHEET_ID = "PASTE_SPREADSHEET_ID";
const SHEET_NAME = "Workshop Mirror";

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const expected = PropertiesService.getScriptProperties()
      .getProperty("WEBHOOK_SECRET");
    if (!expected || payload.secret !== expected) {
      return json({ ok: false, error: "unauthorised" });
    }

    const submission = payload.submission;
    const selectedUseCase = submission.useCases.findIndex(Boolean);
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID)
      .getSheetByName(SHEET_NAME)
      || SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet(SHEET_NAME);

    sheet.appendRow([
      payload.event,
      payload.occurredAt,
      submission.id,
      submission.plant,
      submission.submitterName,
      submission.submitterEmail,
      submission.designation,
      selectedUseCase >= 0 ? selectedUseCase + 1 : "",
      selectedUseCase >= 0 ? submission.useCases[selectedUseCase] : "",
      submission.valueStreams[0] || "",
      submission.expectedBenefits,
      submission.status,
      submission.isVisible,
      submission.updatedAt,
    ]);

    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: String(error) });
  }
}
```

Deploy it as a web app using the production `/exec` URL, then set both:

```dotenv
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT/exec
GOOGLE_SHEETS_WEBHOOK_SECRET=YOUR_LONG_RANDOM_SHARED_SECRET
```

Apps Script web apps receive JSON POST data through `doPost(e)`. See Google's
official [web-app guide](https://developers.google.com/apps-script/guides/web).

## Access decision and operational warning

Per the current workshop decision, submission creation and the admin APIs are
unauthenticated. Anyone who can reach the admin URL can read, edit, approve, or
hide responses. Before exposing this deployment to the public internet, protect
the whole admin route/API at the hosting layer (for example, a restricted access
policy) or add application authentication. The database itself remains private;
the Supabase server secret is used only inside the Worker.

## Adapter integration

The provider-neutral contract is in `lib/submission-store-contract.ts`.
`getConfiguredSupabaseSubmissionStore()` returns a Supabase store when selected
and `null` when the existing D1 path should run. After either store successfully
creates or updates a record, call `queueConfiguredSubmissionMirror()`:

```ts
const externalStore = getConfiguredSupabaseSubmissionStore();

// Use externalStore.create/get/list/update when non-null; otherwise use D1.
// Only after the authoritative write succeeds:
queueConfiguredSubmissionMirror("submission.created", savedSubmission);
```

`update()` accepts the previous `updatedAt` value and returns `null` when no row
matched, preserving the existing optimistic-concurrency conflict behavior.

