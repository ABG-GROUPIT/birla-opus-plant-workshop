# Dependency change provenance

The local recovery branch changes two dependency areas and is intentionally not
deployed without review.

## Next.js security update

`next` and `eslint-config-next` move from 16.2.6 to the exact 16.3.1 release.
This removes the dependency findings reported against the previous lockfile.
The production static build, type check, lint, and full test suite pass after the
update.

## Workbook reader

`@e965/xlsx` is pinned exactly at 0.20.3. It is an unofficial automated npm
republisher of the SheetJS Community Edition code, not an official SheetJS npm
release. It is used only by the local Node workbook reader and tests; it is not
imported by a browser route and does not belong in the GitHub Pages JavaScript
bundle.

The reader adds pre-expansion ZIP limits, strict `.xlsx` extension handling,
macro/external-link/embedded-part detection, formula/merge/hidden-data checks,
sheet/header validation, and source-byte SHA-256 binding. Current `npm audit`
reports zero known vulnerabilities, but that result is not a complete supplier
or malicious-package review.

Before pushing or deploying, review the package provenance and lockfile diff,
confirm the generated static bundle excludes the workbook package, retain an
SBOM, and rerun clean-install/build/test/audit. Replacing the reader library or
framework version later is a separately reviewed change; do not edit the
lockfile manually.
