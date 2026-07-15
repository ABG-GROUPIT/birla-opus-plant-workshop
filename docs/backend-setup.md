# Submission backend setup

The Next.js server API stores every draft, submission, edit, approval, and
visibility change in Supabase/Postgres. There is no local or ephemeral
production fallback: missing Supabase configuration causes the API to fail
instead of silently losing data.

The browser-facing contract stays unchanged. Leaders submit through the custom
form, admins edit and approve the same records, and presentation queries always
apply both `status = approved` and `is_visible = true`.

## 1. Create the database

1. Create or select the Supabase project that will own workshop data.
2. Run
   [`supabase/migrations/202607160001_workshop_submissions.sql`](../supabase/migrations/202607160001_workshop_submissions.sql)
   in the Supabase SQL editor or migration workflow.
3. Confirm that `workshop_submissions` and `workshop_submission_audit` exist.

The migration:

- restricts plants and workflow statuses to the supported fixed values;
- permits incomplete drafts but validates submitted and approved responses;
- prevents non-approved records from becoming presentation-visible;
- enables row-level security and removes direct `anon` and `authenticated`
  access;
- grants the server-side `service_role` access; and
- records changed field names and workflow transitions without duplicating
  leader wording in the audit table.

## 2. Configure server variables

For local development, copy `.env.example` to `.env.local`. In Vercel, add the
same values to Production, Preview, and Development as appropriate:

```dotenv
SUBMISSIONS_STORAGE=supabase
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_YOUR_SERVER_SECRET
```

Use the project URL and a current `sb_secret_...` server key from Supabase. The
adapter also accepts the legacy JWT service-role key through
`SUPABASE_SERVICE_ROLE_KEY`, but new deployments should prefer
`SUPABASE_SECRET_KEY`.

These values must remain server-only. Do not prefix them with `NEXT_PUBLIC_`,
commit them, or paste them into browser code.

## 3. Deploy on Vercel

1. Import `ABG-GROUPIT/birla-opus-plant-workshop` into Vercel.
2. Select the **Next.js** framework preset and root directory `./`.
3. Keep the default build command (`next build`) and output (`.next`).
4. Add the required environment variables before deploying.
5. Keep deployment protection disabled if the workshop URLs must be public.
6. Deploy the production branch.

After deployment, verify this workflow against the production URL:

1. `GET /api/submissions` returns a JSON collection.
2. Save a draft through `/submit`, then refresh `/admin` and confirm it remains.
3. Submit a complete response, edit it in `/admin`, and approve it.
4. Confirm it appears in `GET /api/submissions?presentation=true` and on `/`.
5. Redeploy and confirm the same response still exists.

## Optional Google Sheet mirror

Supabase is authoritative. A Google Apps Script webhook can receive a
best-effort event copy after each successful create or update. Configure both
variables or neither:

```dotenv
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT/exec
GOOGLE_SHEETS_WEBHOOK_SECRET=YOUR_LONG_RANDOM_SHARED_SECRET
```

Next.js schedules the mirror after the API response so a slow or unavailable
Sheet cannot roll back the Supabase write.

## Access warning

The current workshop requirement leaves submission creation and admin APIs
unauthenticated. A public deployment therefore lets anyone who discovers the
admin URL read, edit, approve, reject, or hide responses. The Supabase secret
still remains server-side, but URL secrecy is not an authorization control.
