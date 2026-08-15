# Excel workbook import

The Excel fallback is a local, one-shot Node.js operator command. It is not a
browser upload, Supabase Storage workflow, or folder watcher. It parses and
hashes the same `.xlsx` file, validates it locally, and—only when explicitly
asked—calls the capability-protected Supabase batch-import RPC.

## Prerequisites

- Node.js 22.13 or later and dependencies installed from `package-lock.json`.
- All six checked-in Supabase migrations applied in filename order.
- A current `.xlsx` workbook using all seven required visible sheets and the
  supported A–F header contract.
- For commit mode only: the public Supabase URL/publishable key and the private
  raw admin capability supplied through the operator process environment.
- A private report directory outside Git, shared ZIPs, and synchronized team
  folders whenever a real workbook is involved.

Never pass a workbook containing production answers to an AI chat. Never place
the admin capability, a secret/service-role key, or a database password in a
command line, repository file, browser variable, report, or screenshot.

## 1. Install and verify

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

Expected result: every command exits successfully. Stop if the install, build,
type check, lint, or tests fail.

## 2. Run a dry run

```bash
npm run workbook:import -- --source "C:\private\incoming\workbook.xlsx" --report "C:\private\reports\workbook-preflight.json"
```

For a populated Panipat sheet, make the layout decision explicit:

```bash
# Current documented A–F template
npm run workbook:import -- --source "C:\private\incoming\workbook.xlsx" --report "C:\private\reports\workbook-preflight.json" --panipat-layout standard

# Known legacy rows whose Name column actually contains the use-case title
npm run workbook:import -- --source "C:\private\incoming\legacy-workbook.xlsx" --report "C:\private\reports\legacy-preflight.json" --panipat-layout shifted
```

The command never overwrites an existing report and rejects a report path that
resolves to the source workbook. Use a new private evidence filename for every
run.

Dry run is the default. It performs no network write. The JSON report records
the workbook SHA-256, aggregate counts, schema/safety errors, warnings,
plant-level counts, inferred-stream count, and incomplete-row identifiers. It
does not copy the workbook or print response wording in the incomplete-row
summary.

The command rejects or reports:

- any extension other than macro-free `.xlsx`;
- files larger than 20 MiB;
- ZIP packages with excessive entry counts, expanded size, per-entry size,
  compression ratio, encryption, or unsafe paths;
- more than 500 response entries, 501 used rows per sheet, or 32 used columns;
- a missing, duplicate, hidden, reordered, renamed, or structurally changed
  required sheet/header;
- populated header columns after F, populated response cells after F, or
  populated hidden rows/columns;
- formulas in response columns A–F below the header;
- VBA/macros, external-link package parts, embedded/ActiveX parts, or merged
  cells;
- missing stable serials or required canonical fields; and
- blank/invalid value streams that require deterministic inference.

Cell comments are ignored and produce warnings. Unrecognized extra sheets are
ignored and produce warnings. Any error prevents commit.

## 3. Review the report

Confirm all of the following before commit:

- `schemaErrorCount` and `safetyErrorCount` are zero;
- `rowsFound` matches the operator's expected populated-row count;
- `rowsIncomplete` is understood;
- every plant-level count is plausible;
- every inferred value stream has been reviewed; and
- the stored report hash matches the workbook the operator intends to import.

Correct the workbook and repeat the dry run if any count or classification is
unexpected. Do not edit the JSON report to make a workbook pass.

## 4. Commit into normal review

Set the following only in the private operator process environment:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
BIRLA_OPUS_ADMIN_CAPABILITY=YOUR_PRIVATE_RAW_ADMIN_CAPABILITY
```

Then run:

```bash
npm run workbook:import -- --source "C:\private\incoming\workbook.xlsx" --report "C:\private\reports\workbook-commit-preflight.json" --commit
```

Use the same `--panipat-layout` value that produced the reviewed dry run.

Expected result: complete new rows enter `submitted` and remain hidden until an
administrator approves them. Incomplete, unchanged, moved-duplicate, and
conflicting rows appear in the database batch receipt. The command prints the
preflight and server result, so redirect output only into a private evidence
location when a real workbook is used.

The database serializes batch imports and binds the receipt to both workbook
bytes and normalized payload. Repeating an identical command replays the saved
receipt instead of inserting duplicates. The same workbook bytes with a
different normalized payload are rejected. A changed row with an existing
source key becomes a conflict and is not overwritten.

## 5. Direct publication exception

Normal workshop governance requires admin review. A direct publication bypass
is available only for an explicitly authorized emergency:

```bash
npm run workbook:import -- --source "C:\private\incoming\workbook.xlsx" --commit --publish --ack-governance-bypass
```

If any stream was inferred, direct publication remains blocked. After manual
review, an authorized operator may additionally use
`--allow-inferred-publish`. These flags do not replace the required production
authorization or acceptance checks.

## Failure, retry, and rollback

- A local schema/safety failure performs no network write. Correct the workbook
  and rerun dry mode.
- An HTTP/database failure returns a non-zero exit. Preserve the private report
  and rerun the identical command; database receipts and source-key/fingerprint
  checks provide import idempotency.
- Commit accepts only an HTTPS `<project>.supabase.co` origin, rejects redirects,
  and aborts transport after 30 seconds. Loopback HTTP is available only through
  the explicit `--allow-local-supabase` test-stack flag.
- A conflict is never overwritten automatically. Resolve it in the admin portal
  or create an approved source-data correction procedure.
- Commit does not move or delete the source workbook. Operators own any
  `incoming`, `processed`, and `rejected` filesystem procedure outside this
  repository.
- Rollback is a governed admin/database operation. Do not delete or modify live
  rows, batch receipts, or Storage objects without explicit authorization and a
  cleanup ledger.

## Known limitations

- There is no browser workbook-upload page or automatic drop-folder watcher.
- Excel cannot attach reference media.
- The current workbook contract does not collect email or designation.
- Value-stream inference is heuristic; zero-signal wording falls back to
  Process Optimization and therefore requires review.
- Form submissions have a separate web route and currently lack an equivalent
  client idempotency key.
- SQL idempotency and RLS behavior must be verified against the authenticated
  live Supabase project; checked-in migrations alone are not live evidence.
