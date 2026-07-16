# Submission backend setup

GitHub Pages serves a static Next.js export. Supabase/Postgres owns every final
submission, admin edit, approval, rejection, and audit entry. There is no
ephemeral production fallback and there are no browser-facing Next.js API
routes.

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
the presentation.

The admin capability is a random bearer value. Only its SHA-256 hash belongs in
the database migration; the raw value is supplied separately. Never add the raw
capability to SQL, Git, GitHub variables, logs, screenshots, or this guide.

After applying all four migrations, confirm that:

- `public.workshop_submissions` and `public.workshop_submission_audit` exist;
- the intended `public.workshop_*` RPC functions exist;
- `anon` cannot select, insert, or update either table directly; and
- `anon` can execute only the intended RPC functions;
- `storage.buckets` contains `workshop-references` with a 10 MiB per-file cap;
- anonymous uploads fail unless the object path contains an active media-session
  ID and its matching raw capability; and
- the upload session becomes unusable after submission or one hour.

### Reference-media limits

- Four reference items per response.
- Three uploaded files and two HTTPS links within that four-item total.
- 10 MiB per file and 25 MiB total uploaded bytes per response.
- PDF, PPTX, DOCX, XLSX, JPEG, PNG, and WebP only.
- Legacy or macro-enabled Office files, archives, HTML/SVG, audio/video, and
  executables are rejected.

The browser uses resumable uploads, so the textual response remains lightweight
and larger workshop documents can retry interrupted chunks. Links consume no
Storage quota. Supabase Free currently provides 1 GB file storage and allows up
to 50 MB per individual file; this application intentionally stays below those
platform limits.

## 2. Configure the browser-safe Supabase values

Find the project URL and publishable key under Supabase project settings. For
local development, copy `.env.example` to `.env.local` and set:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_BASE_PATH=
```

PostgREST RPC calls send the publishable key in the `apikey` header. Resumable
file uploads send that same browser-safe key as both `apikey` and Bearer
authorization to the direct `https://<PROJECT_REF>.storage.supabase.co` host.
They do not send a secret key, service-role key, or database password.

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
2. The TUS create request goes to
   `https://<PROJECT_REF>.storage.supabase.co/storage/v1/upload/resumable` with
   `apikey: sb_publishable_...` and
   `Authorization: Bearer sb_publishable_...`. It must not contain a secret or
   service-role key.
3. The create request returns `201`, subsequent TUS `PATCH` requests return
   `204`, and no request returns `401` or `403`.
4. `POST /rest/v1/rpc/workshop_submit_single_use_case_with_references` succeeds,
   and the new response and file appear in the admin review queue.
5. Approve the response and confirm the presentation opens the included file.

Only the migration's capability-checked `INSERT` policy should exist for these
anonymous Storage uploads; a `SELECT` policy is neither created nor required by
this TUS flow. A successful live upload with the publishable key while no
Storage `SELECT` policy exists is the final production check of that assumption.
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
