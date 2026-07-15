# Birla Opus Plant Workshop Canvas

A six-plant workshop website for collecting leader responses, reviewing them,
and presenting only approved ideas. It runs on
[vinext](https://github.com/cloudflare/vinext), with a zero-config D1 preview
and a production Supabase/Postgres option.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

## Application routes

- `/` — presentation-only workshop surface
- `/submit` — public leader response form with a device-local draft
- `/admin` — review, direct editing, approval, and rejection
- `/credits` — regional photo attribution

## Workshop Submission Contract

- `useCases` is always a four-string tuple. Its positions represent Use Case
  1, 2, 3, and 4 respectively.
- A submitted or approved response must contain a description in exactly one
  use-case position. The non-empty position is the selected fixed use case.
- Drafts may be saved before that selection and description are complete.
- `valueStreams` contains exactly one fixed value (`"1"` through `"4"`) once a
  response is submitted or approved.
- The four use-case columns encode the selected slot directly; the production
  Supabase schema keeps the same representation.

## Production persistence

Local/demo runs continue to use the configured D1 database with no additional
credentials. Production can switch the same submission API to private
Supabase/Postgres storage and optionally mirror successful writes to Google
Sheets. See [Submission backend setup](docs/backend-setup.md) for the migration,
runtime values, security boundary, and deployment checklist.

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
