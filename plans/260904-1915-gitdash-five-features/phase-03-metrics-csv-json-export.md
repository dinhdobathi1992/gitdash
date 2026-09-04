---
phase: 3
title: "Metrics CSV/JSON Export"
status: pending
priority: P2
effort: "0.5d"
dependencies: []
---

<!-- Updated: Validation Session 1 - added CSV formula-injection guard, red-team Finding 15 -->

# Phase 3: Metrics CSV/JSON Export

## Overview

No route in `src/app/api/` (47 total) returns anything but chart-consumed
JSON, and no UI has an export affordance — `html2canvas` (existing dependency,
`package.json`) only screenshots. Managers who want a number for a slide deck
or another BI tool have no path out. This phase adds a client-side export
button — **zero backend changes** — reusing data the page has already
fetched via SWR, kept scoped to the three pages named in the brainstorm
(DORA, cost, org-health).

## Requirements

- Functional: DORA (`src/app/repos/[owner]/[repo]/...` DORA view), Cost
  Analytics (`src/app/cost-analytics`), and Org Health
  (`src/app/org/[orgName]` scorecard view) each get an "Export" control
  offering CSV and JSON.
- Non-functional: **no new API route, no change to any existing route's
  response shape.** Export serializes the SWR-cached data the page already
  holds client-side — this is the safest possible design given the
  non-breaking constraint (zero backend surface touched).
- Non-functional: CSV serialization handles nested/array fields sensibly
  (flatten one level, or one row per leaf metric — decide per page, document
  the choice inline).
- Security: **CSV formula-injection guard.** Exported rows contain
  GitHub-controlled strings (workflow names, repo names, contributor
  logins) that are arbitrary text from the repo's own YAML/profile data —
  not constrained by `validateRepo`/`validateOwner`, which guard API
  *inputs*, not export *output*. A cell whose value starts with `=`, `+`,
  `-`, `@`, tab, or carriage return must be prefixed with `'` before
  writing, so spreadsheet apps (Excel, Sheets) render it as literal text
  instead of evaluating it as a formula (prevents exfiltration/DDE-prompt
  vectors via e.g. a workflow named `=HYPERLINK(...)`). Comma/quote/newline
  escaping alone does not prevent this — Excel evaluates the unquoted cell
  content after CSV parsing.

## Architecture

New shared component `src/components/ExportButton.tsx`:
- Props: `data: unknown`, `filenameBase: string`, `csvRows?: () => Record<string, string | number>[]` (page supplies its own flattening logic since each dataset's shape differs).
- JSON export: `JSON.stringify(data, null, 2)` → `Blob` → `URL.createObjectURL` → synthetic `<a download>` click (standard browser download pattern, no server round-trip).
- CSV export: if `csvRows` provided, build a comma-escaped CSV string from
  the flattened rows; if not provided, JSON-only (avoids forcing every
  caller to write a flattener for genuinely nested data).

Each of the 3 target pages imports `ExportButton`, passes its existing SWR
`data`, and — for CSV — a small local function mapping its specific response
shape to flat rows (e.g., DORA: one row per week/period; cost: one row per
workflow; org-health: one row per repo).

## Related Code Files

- Create: `src/components/ExportButton.tsx`
- Modify: DORA page component (`src/app/repos/[owner]/[repo]/...` — locate
  exact file via `grep -rn "getRepoDoraSummary\|repo-dora" src/app`)
- Modify: `src/app/cost-analytics/page.tsx` (or its component tree)
- Modify: org-health scorecard view (`src/app/org/[orgName]/...` — locate via
  `grep -rn "computeScorecard\|org-health-scorecard" src/app`)
- Test: `tests/export-button.test.ts` or colocated — CSV escaping (commas,
  quotes, newlines in values), JSON round-trip shape

## Implementation Steps

1. Build `ExportButton.tsx` with JSON export working generically first
   (works for any page with zero per-page code).
2. Add CSV support with a documented `csvRows` callback contract.
3. Wire into DORA page with a `csvRows` flattener for its summary shape.
4. Wire into Cost Analytics page with its own flattener.
5. Wire into Org Health scorecard with its own flattener.
6. Write CSV-escaping unit tests (values containing `,`, `"`, `\n`, and
   formula-injection prefixes `=`, `+`, `-`, `@`, tab, carriage return).
7. Manual verification: click Export on each of the 3 pages, confirm
   downloaded file opens correctly in a spreadsheet app and a JSON viewer.
8. `pnpm run lint && pnpm exec tsc --noEmit && pnpm test`.

## Success Criteria

- [ ] Export button present and functional on DORA, Cost Analytics, and Org
      Health pages
- [ ] CSV correctly escapes commas/quotes/newlines in values (test-verified)
- [ ] CSV correctly neutralizes formula-injection prefixes (`=`, `+`, `-`,
      `@`, tab, CR) on any exported string field (test-verified)
- [ ] JSON export is a faithful `JSON.stringify` of the already-rendered data
      (no silent field drops)
- [ ] Zero changes to any existing API route file or response shape
- [ ] `pnpm run lint && pnpm exec tsc --noEmit && pnpm test` all green

## Risk Assessment

- **Risk:** client-side-only export means very large datasets (e.g. an org
  with hundreds of repos) could produce a slow `JSON.stringify`/Blob
  operation on the main thread.
  **Mitigation:** these pages already render the full dataset to charts
  client-side today, so the export data volume is bounded by what's already
  rendered — no new fetch, no new volume ceiling introduced.
  **Signal it broke:** user reports UI freeze on export click for a large
  org. **Response:** move serialization into a `requestIdleCallback` or a
  Web Worker if it becomes a real complaint; not needed at initial ship
  given the bounded-by-existing-render argument above.
- **Risk:** per-page CSV flatteners could silently diverge from what the
  chart actually shows if someone changes the SWR data shape later without
  updating the flattener.
  **Mitigation:** colocate each flattener next to its page component (not in
  a shared file) so a shape change and its flattener update land in the same
  diff naturally; add a type constraint tying `csvRows`'s input type to the
  page's actual SWR response type.
  **Signal it broke:** TypeScript error on the `csvRows` callback if the
  page's data type changes and the flattener isn't updated (compile-time
  catch, not runtime).
