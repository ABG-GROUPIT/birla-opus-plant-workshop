# Submission backend setup

GitHub Pages serves a static Next.js export. Supabase/Postgres owns every final
submission, admin edit, approval, rejection, and audit entry. There is no
ephemeral production fallback and there are no browser-facing Next.js API
routes.

Uploaded reference files are private Supabase Storage objects. The
`workshop-reference-access` Supabase Edge Function revalidates presentation
visibility or the existing admin capability on every read, then streams the
object with `Cache-Control: private, no-store`. Its Supabase-managed
administrative client stays inside the function and never enters the static
bundle.

## Architecture and trust boundary

The static browser bundle uses the Supabase project URL and publishable key to
call only these PostgREST RPC functions:

| RPC | Browser use | Database guarantee |
| --- | --- | --- |
| `workshop_public_list()` | Load the presentation | Returns only approved and visible rows, excluding email and designation |
| `workshop_media_session_create()` | Prepare optional file uploads | Returns a random one-hour capability while storing only its SHA-256 digest |
| `workshop_submit_single_use_case_with_references(...)` | Submit one use case and its references | Validates the title, theme, one value stream, benefits, links, actual Storage objects, count and byte limits in one transaction |
| `workshop_submit_with_references(...)` / `workshop_submit(...)` | Compatibility submission paths | Keep already-open older form tabs working during the contract transition |
| `workshop_admin_list(p_capability)` | Load the review queue | Validates the admin capability before returning full review data |
| `workshop_admin_single_use_case_update(...)` | Edit, approve, or reject | Validates the capability and uses `updated_at` for optimistic concurrency |
| `workshop_admin_reference_update(...)` | Review one reference | Lets an administrator correct its title/link or exclude it from the presentation |

`public.workshop_reference_access(...)` is intentionally executable only by
the service role used inside the Edge Function. It is not a browser RPC.

The tables do not grant direct access to `anon` or `authenticated`. The RPCs are
`SECURITY DEFINER` functions with a restricted search path and narrowly scoped
execute grants. This lets a static site perform the required operations without
exposing a database-wide credential.

The publishable key is designed to appear in browser code; it identifies the
Supabase project but does not bypass row-level security. In contrast, a Supabase
secret or service-role key bypasses database protections and must never appear
in:

- a `NEXT_PUBLIC_` variable;
- the generated `out/` directory;
- GitHub Actions variables or repository files; or
- browser request headers.

## 1. Apply the database migrations

Run these files in filename order in the Supabase SQL editor or migration
workflow:

1. [`202607160001_workshop_submissions.sql`](../supabase/migrations/202607160001_workshop_submissions.sql)
2. [`202607160002_static_browser_rpc.sql`](../supabase/migrations/202607160002_static_browser_rpc.sql)
3. [`202607160003_reference_media.sql`](../supabase/migrations/202607160003_reference_media.sql)
4. [`202607160004_single_use_case_head_office.sql`](../supabase/migrations/202607160004_single_use_case_head_office.sql)
5. [`202607160005_excel_batch_import.sql`](../supabase/migrations/202607160005_excel_batch_import.sql)
6. [`202608150006_idempotent_form_submission.sql`](../supabase/migrations/202608150006_idempotent_form_submission.sql)
7. [`202608150007_private_reference_delivery.sql`](../supabase/migrations/202608150007_private_reference_delivery.sql)

The first migration creates the submission and audit tables, validation
constraints, indexes, audit trigger, row-level security, and direct-access
revocations. The second migration creates the private capability store and the
original public RPC entry points, grants only the required RPC execution, and
keeps the underlying tables closed to browser roles. The third migration adds
the `workshop-references` Storage bucket, short-lived upload sessions, reference
metadata, restricted anonymous uploads, admin reference controls, and reference
fields in the public/admin response envelopes. The fourth migration adds the
Head Office (Mumbai) entity, one freehand use-case title and theme, single-use-
case browser/admin RPCs, legacy synchronization, and plant/use-case ordering for
the presentation. The fifth migration establishes the eight named value
streams, aligns long-text limits at 12,000 characters, adds Excel source
lineage, checksum/idempotency controls, atomic batch receipts, and the
capability-protected Excel import RPC.
The sixth migration adds an unguessable client retry key, a server-computed
payload digest, and a transaction-serialized submit RPC. Replaying the same key
with the same content returns the original response; reusing it for different
content fails closed.

The seventh migration makes the reference bucket private and adds the
service-role-only authorization RPC used by revocable reference delivery.

After migration 007, deploy the Edge Function from the repository root:

```text
supabase functions deploy workshop-reference-access --project-ref YOUR_PROJECT_REF
```

The checked-in `supabase/config.toml` also records `verify_jwt = false` because
public presentation links have no user JWT. This does not make files public:
the function invokes the database authorization RPC before every Storage read.

For a live cutover, deploy the Edge Function first, deploy the matching GitHub
Pages bundle second, and apply migration 007 immediately after the Pages health
check. Do not flip the bucket first: the previously deployed browser still uses
the old public-object URL. If the Pages deployment fails, leave migration 007
unapplied and fix or roll back the browser bundle. Once migration 007 is live,
roll forward by repairing/redeploying the function or browser; do not make the
bucket public again as a routine rollback because that reopens known-URL access.

The admin capability is a random bearer value. Only its SHA-256 hash belongs in
the database migration; the raw value is supplied separately. Never add the raw
capability to SQL, Git, GitHub variables, logs, screenshots, or this guide.

After applying all seven migrations and deploying the Edge Function, confirm that:

- `public.workshop_submissions` and `public.workshop_submission_audit` exist;
- the intended `public.workshop_*` RPC functions exist;
- `anon` cannot select, insert, or update either table directly; and
- `anon` can execute only the intended RPC functions;
- `storage.buckets` contains private bucket `workshop-references` with a 10 MiB per-file cap;
- anonymous uploads fail unless the object path contains an active media-session
  ID and its matching raw capability; and
- the upload session becomes unusable after submission or one hour.
- `workshop_private.excel_import_batches` exists and
  `workshop_admin_excel_batch_import(...)` is executable only through the
  capability-gated wrapper intended by migration 005.
- `workshop_submit_single_use_case_idempotent(...)` is executable by `anon`,
  while the retry-key columns remain inaccessible through direct table access.

### Reference-media limits

- Four reference items per response.
- Three uploaded files and two HTTPS links within that four-item total.
- 10 MiB per file and 25 MiB total uploaded bytes per response.
- PDF, PPTX, DOCX, XLSX, JPEG, PNG, and WebP only.
- Legacy or macro-enabled Office files, archives, HTML/SVG, audio/video, and
  executables are rejected.

The browser sends each selected file through Supabase's standard object endpoint
on the same project host used by the form. This avoids corporate-network blocks
on the optional dedicated Storage hostname. Links consume no Storage quota.
Supabase Free currently provides 1 GB file storage and allows up to 50 MB per
individual file; this application intentionally stays at 10 MiB per file and
25 MiB per response.

## 2. Configure the browser-safe Supabase values

Find the project URL and publishable key under Supabase project settings. For
local development, copy `.env.example` to `.env.local` and set:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_BASE_PATH=
```

PostgREST RPC calls send the publishable key in the `apikey` header. Standard
file uploads send that same browser-safe key as both `apikey` and Bearer
authorization to `https://<PROJECT_REF>.supabase.co/storage/v1/object/...`.
They do not send a secret key, service-role key, or database password.
Reference reads use
`https://<PROJECT_REF>.supabase.co/functions/v1/workshop-reference-access`;
public reads carry only a reference ID, while admin reads send the raw admin
capability in a POST body. Neither path exposes a privileged Supabase key.

## 3. Use the complete admin capability link

The deployed GitHub Pages links are:

```text
Presentation: https://abg-groupit.github.io/birla-opus-plant-workshop/
Leader form:  https://abg-groupit.github.io/birla-opus-plant-workshop/submit/
Admin shell:  https://abg-groupit.github.io/birla-opus-plant-workshop/admin/
Admin access: https://abg-groupit.github.io/birla-opus-plant-workshop/admin/#<RAW_ADMIN_CAPABILITY>
```

The capability comes after `#`, so GitHub Pages does not receive it in the page
request. The app moves it into session storage, removes it from the visible
address bar, and sends it only in HTTPS POST bodies to the admin RPCs. Opening
the admin shell without the fragment does not grant access.

This is intentionally link-based access rather than user authentication. Anyone
with the complete link has administrator authority, so distribute it only to
workshop administrators. To rotate access, create a new random capability,
store only its hash in the private capability table, revoke the old record, and
distribute the new complete link outside Git.

## 4. Configure GitHub Actions and Pages

In the public GitHub repository, open **Settings > Secrets and variables >
Actions > Variables** and add:

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

The Pages workflow already defaults to:

```text
NEXT_PUBLIC_BASE_PATH=/birla-opus-plant-workshop
NEXT_PUBLIC_SITE_URL=https://abg-groupit.github.io/birla-opus-plant-workshop/
```

Add those optional variables only if the repository path or canonical URL
changes. Do not add the raw admin capability or a Supabase secret/service-role
key.

Under **Settings > Pages**, use **GitHub Actions** as the build source. A push to
`main` runs `.github/workflows/pages.yml`, checks lint and types, builds the
static export, uploads `out/`, and deploys it to GitHub Pages.

## 5. Verify the production workflow

Use an identifiable test response, then remove or reject it after testing:

1. Open the leader form, enter partial wording, save a local draft, refresh, and
   confirm that the draft remains on that device.
2. Add an HTTPS link and a small PDF/PPTX, then complete and submit the form.
   Confirm upload progress, a response reference, and submission time appear.
3. Open the complete admin capability link. Confirm the new response appears in
   the submitted queue and both references can be opened.
4. Edit the wording, hide/show one reference, save it, and approve the response.
5. Open the presentation and confirm that the approved response appears under
   the correct plant or Head Office and **Open references** exposes only included items.
6. Reject the response and confirm that it no longer appears in the
   presentation.
7. Redeploy the static site and confirm that the Supabase response still exists.

### Live Storage smoke test

For one small PNG, PDF, or PPTX, use the browser developer tools **Network**
panel to verify the complete upload chain:

1. `POST /rest/v1/rpc/workshop_media_session_create` returns `sessionId`,
   `uploadToken`, and `expiresAt`.
2. The object upload request goes to
   `https://<PROJECT_REF>.supabase.co/storage/v1/object/workshop-references/...` with
   `apikey: sb_publishable_...` and
   `Authorization: Bearer sb_publishable_...`. It must not contain a secret or
   service-role key.
3. The upload returns `200` or another `2xx` status, and no request returns
   `401` or `403`.
4. `POST /rest/v1/rpc/workshop_submit_single_use_case_idempotent` succeeds,
   and the new response and file appear in the admin review queue.
5. Approve the response and confirm the presentation opens the included file
   through `/functions/v1/workshop-reference-access`, not a
   `/storage/v1/object/public/` URL.
6. Hide the file or reject the response, then retry the same function URL and
   confirm it returns `404`; the admin POST path should still open the file with
   the valid capability.

Only the migration's capability-checked `INSERT` policy should exist for these
anonymous Storage uploads; a browser `SELECT` policy is neither created nor
required. The private Edge Function reads with its server-side service role only
after the access RPC authorizes the current reference state.
The one-hour capability/RLS design intentionally does not use signed-upload
tokens or an `x-signature` header.

After testing, reject the identifiable response so it leaves the presentation.
If the test object must also be removed, delete it through the Supabase Storage
dashboard/API; do not delete rows directly from `storage.objects` with SQL.

The presentation read is enforced inside `workshop_public_list`, not by a query
parameter chosen by the browser. A row cannot reach the public presentation
until the database reports it as both approved and visible.

## Google Sheet mirror status

Supabase is the authoritative store. The previous server-side webhook mirror is
not part of the static RPC request path. If a Sheet mirror is required later,
implement it from Supabase with a database webhook or an Edge Function so Sheet
latency cannot delay or roll back the leader's submission.

## Excel operator boundary

The local Excel operator flow is documented separately in
[Excel workbook import](excel-import.md). Its admin capability belongs only in
a private operator environment and must never be placed in `.env.local`, a
`NEXT_PUBLIC_` variable, GitHub Actions, the repository, or a shared report.
