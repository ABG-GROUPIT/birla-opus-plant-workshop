# Birla Opus Plant Workshop Canvas

A six-plant workshop website for collecting leader responses, reviewing them,
and presenting only approved ideas. The application is a standard Next.js App
Router project designed for Vercel, with Supabase/Postgres as its persistent
submission store.

## Prerequisites

- Node.js `>=22.13.0`
- A Supabase project with the included migration applied

## Local setup

```bash
npm install
copy .env.example .env.local
npm run dev
```

Populate `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.local` before using
the form or admin APIs. Never commit that file or prefix the secret with
`NEXT_PUBLIC_`.

## Application routes

- `/` — presentation-only workshop surface
- `/submit` — public leader response form with a device-local draft
- `/admin` — review, direct editing, approval, and rejection
- `/credits` — regional photo attribution

## Submission contract

- `useCases` is always a four-string tuple representing Use Cases 1–4.
- A submitted or approved response contains a description in exactly one slot.
- Drafts may be saved before the response is complete.
- `valueStreams` contains exactly one fixed value (`"1"` through `"4"`) for
  submitted and approved responses.
- Only approved, visible responses appear on the presentation route.

## Production persistence

Apply
[`supabase/migrations/202607160001_workshop_submissions.sql`](supabase/migrations/202607160001_workshop_submissions.sql)
to the production Supabase project, then configure these server-only Vercel
environment variables:

```dotenv
SUBMISSIONS_STORAGE=supabase
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_YOUR_SERVER_SECRET
```

See [Submission backend setup](docs/backend-setup.md) for the complete database
and deployment checklist.

## Verification

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` runs a production Next.js build before the automated tests.

## Deployment

Import the GitHub repository into Vercel with the **Next.js** framework preset,
root directory `./`, and the default `.next` output. Add the required server
environment variables before the first production deployment.

The current workshop decision intentionally leaves the form and admin routes
unauthenticated. Consequently, anyone who can reach `/admin` can read and
modify leader responses.
