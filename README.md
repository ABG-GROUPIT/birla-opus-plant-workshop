# Birla Opus Plant Workshop Canvas

A six-plant workshop website for collecting leader responses, reviewing them,
and presenting only approved ideas. It is exported as a static Next.js site for
GitHub Pages, while Supabase/Postgres remains the authoritative data store.

## Live routes

The GitHub Pages deployment uses this repository base path:

- Presentation: `https://abg-groupit.github.io/birla-opus-plant-workshop/`
- Leader form: `https://abg-groupit.github.io/birla-opus-plant-workshop/submit/`
- Admin page: `https://abg-groupit.github.io/birla-opus-plant-workshop/admin/`
- Complete admin link: `https://abg-groupit.github.io/birla-opus-plant-workshop/admin/#<RAW_ADMIN_CAPABILITY>`
- Photo credits: `https://abg-groupit.github.io/birla-opus-plant-workshop/credits/`

The admin page without its fragment is intentionally incomplete. The raw
capability is supplied separately and must never be committed to this repository
or copied into documentation. Anyone who has the complete link can review, edit,
approve, and reject responses.

## How data moves

The browser calls narrowly scoped Supabase RPC functions through the public
PostgREST endpoint:

- `workshop_public_list` returns only approved, visible presentation fields.
- `workshop_media_session_create` creates a one-hour, single-use upload session.
- `workshop_submit_with_references` atomically creates a hidden response and
  attaches its validated links/files. The original `workshop_submit` remains for
  compatibility with older open form tabs.
- `workshop_admin_list` returns review data after validating the admin capability.
- `workshop_admin_update` applies edits and status changes after validating the
  capability and the row's expected update timestamp.
- `workshop_admin_reference_update` lets an administrator rename, correct, or
  hide one supporting reference.

Direct browser access to the submission and audit tables remains revoked and
protected by row-level security. The static site contains only a Supabase
publishable key. A Supabase secret key or service-role key must never be placed
in browser code, a `NEXT_PUBLIC_` variable, or GitHub Actions configuration.

## Prerequisites

- Node.js `>=22.13.0`
- A Supabase project with all included migrations applied in filename order
- The separately supplied raw admin capability matching the stored hash

See [Submission backend setup](docs/backend-setup.md) for the database and
deployment checklist.

## Local setup

```bash
npm install
copy .env.example .env.local
npm run dev
```

Set these browser-safe values in `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_BASE_PATH=
```

Open the local admin with
`http://localhost:3000/admin/#<RAW_ADMIN_CAPABILITY>`. The form's **Save draft**
action uses local storage on that device; only a final submission is written to
Supabase. Draft text and reference links are restored, but selected local files
must be reattached after the tab is closed.

## Submission contract

- `useCases` is a four-string tuple representing Use Cases 1-4.
- A submitted or approved response has a description in exactly one slot.
- `valueStreams` contains exactly one fixed value (`"1"` through `"4"`).
- New form submissions enter review as `submitted` and are not visible.
- Only approved, visible responses appear in the presentation.
- Reference media is optional: at most four items, including at most three files
  and two HTTPS links.
- Allowed uploads are PDF, PPTX, DOCX, XLSX, JPEG, PNG, and WebP. Each file is
  limited to 10 MiB and uploaded files are limited to 25 MiB per response.
- Uploaded bytes live in the Supabase `workshop-references` Storage bucket, so
  they do not increase the GitHub repository or Pages deployment size.

## Verification

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` runs a production Next.js build before the automated tests.

## GitHub Pages deployment

The workflow in `.github/workflows/pages.yml` builds and deploys `out/` whenever
`main` is pushed. Configure these repository Actions variables before deploying:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

The workflow has defaults for the repository base path and canonical Pages URL.
They can be overridden with `NEXT_PUBLIC_BASE_PATH` and `NEXT_PUBLIC_SITE_URL`.
Do not add the raw admin capability or a Supabase secret/service-role key to the
workflow.

A Vercel or custom-domain build can use the same two browser-safe Supabase
variables. Leave `NEXT_PUBLIC_BASE_PATH` empty and set `NEXT_PUBLIC_SITE_URL` to
that deployment's public origin. No Next.js `/api/submissions` server routes are
required by this architecture.
