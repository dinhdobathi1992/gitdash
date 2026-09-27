# GitDash design contract — "Graphite console"

| | |
|---|---|
| **Version** | 1.0 · 2026-09-27 |
| **Status** | Proposed — needs sign-off before implementation starts |
| **Canvas** | https://claude.ai/artifact/W92ksxwbS3iy3PYd92mKmo (private; share from its Share menu) |
| **Applies to** | Every screen in `src/app/**` and every component in `src/components/**` |

This file is the agreement between design and implementation. If the mockups, the tokens and this text
disagree, **this text wins**, then `tokens/tokens.css`, then the screenshots. The mockups use sample data;
only layout, hierarchy, styling and behaviour are binding, never the numbers.

---

## 1. What's in `design/`

| Path | What it is | Binding? |
|---|---|---|
| `DESIGN-CONTRACT.md` | This contract | **Yes** |
| `tokens/tokens.css` | Drop-in token block + Tailwind v4 `@theme` mapping | **Yes** |
| `tokens/tokens.json` | Same tokens, machine-readable (generated from the CSS) | Yes |
| `screenshots/*.png` | Each screen at its design size (phones and sidebar at 2x) | Visual reference |
| `html/*.html` | Each screen as a static page; open in a browser to inspect exact CSS | Visual reference |
| `index.html` | Gallery of every screen | — |
| `artifact/` | Canvas source: `canvas.json` + one `.dc.html` per artboard | Source of the above |
| `scripts/export-design.mjs` | Rebuilds `html/`, `screenshots/` and `index.html` from `artifact/` | — |

---

## 2. Principles

1. **Signal over decoration.** Brand violet and cyan mark state, selection and data. They are never
   background paint. If everything glows, nothing does.
2. **Numbers are the product.** Every figure uses the mono face, so digits line up in columns, and every
   change carries a direction, a colour **and** a word ("↑ 48s slower", never just a red number).
3. **Attention first.** Each monitoring screen answers "what is wrong right now?" before "here is
   everything". Failing items sort to the top by default.
4. **One place per job.** A repository's sub-pages are tabs, not a row of equal buttons. A metric is shown
   once, in one format.
5. **Readable at a glance, accessible by default.** Nothing below 12 px (the one exception is in §6.2), all text ≥ 4.5:1, status never
   carried by colour alone.

---

## 3. Tokens

All values live in `tokens/tokens.css`. Use the Tailwind utilities it defines (`bg-surface`, `text-muted`,
`border-line`, `rounded-card`, `shadow-card`, `text-status-fail-text`, …). **No raw hex values and no
`slate-*` / `violet-*` classes in new or touched code.**

### 3.1 Colour

| Role | Token | Utility | Value | Contrast |
|---|---|---|---|---|
| Page | `--background` | `bg-ground` | `#0B0D11` | — |
| Sidebar, inputs, table header | `--surface-1` | `bg-panel` | `#0F1217` | — |
| Cards, tables | `--surface-2` | `bg-surface` | `#13171D` | — |
| Selected / raised | `--surface-3` | `bg-raised` | `#1C2230` | — |
| Card border, row divider | `--border-subtle` | `border-line` | `#1E242D` | — |
| Control border | `--border` | `border-control` | `#232A34` | — |
| Primary text | `--foreground` | `text-fg` | `#EDEAE3` | 15.0:1 on surface |
| Secondary text | `--text-muted` | `text-muted` | `#A3A9B4` | 7.6:1 |
| Captions, axes | `--text-faint` | `text-faint` | `#7A818D` | 4.6:1 — **the floor**; never darker for text |
| Disabled only | `--text-disabled` | `text-disabled` | `#4B525E` | 2.3:1 — only for disabled controls |
| Primary button | `--brand` | `bg-brand` | `#6D4AFF` | white text 5.2:1 |
| Active marks, focus | `--brand-fg` | `text-brand-fg` | `#A48BFF` | 6.6:1 |
| Links | `--brand-link` | `text-link` | `#B9A6FF` | 8.5:1 |
| Data, running | `--accent` | `text-accent` | `#4FD1E8` | 9.9:1 |

**Status** has three layers. Use the right one:

| State | Graphic (dot, bar, square, line) | Text on tint | Tint (pill, icon box) |
|---|---|---|---|
| Success / faster / Elite | `#3DD68C` | `#5BE0A0` | `rgba(61,214,140,.12)` |
| Failure / regression / Low | `#FF6B6B` | `#FF8A8A` | `rgba(255,107,107,.12)` |
| Warning / slower / Medium | `#F5B544` | `#F5B544` | `rgba(245,181,68,.14)` |
| Running / info / High | `#4FD1E8` | `#6FDBEE` | `rgba(79,209,232,.12)` |
| Cancelled / skipped | `#626A77` | `#A3A9B4` | `rgba(163,169,180,.10)` |

> **Deliberate correction:** the mockups draw cancelled runs in `#4B525E`, which is 2.3:1 against a card
> and fails the 3:1 rule for meaningful graphics. Implement `#626A77` (3.3:1).

**Chart series**, in order: violet `#A48BFF`, cyan `#4FD1E8`, amber `#F5B544`, green `#3DD68C`,
coral `#FF6B6B`, blue `#74B6F4`, periwinkle `#8E9BFA`, grey `#A3A9B4` ("other"). Heatmaps use the violet
ramp `--heat-0…4`.

### 3.2 Type

Geist and Geist Mono. Both are already loaded in `src/app/layout.tsx` through `next/font`; point
`--font-sans` / `--font-mono` at those variables when wiring the tokens in.

| Style | Size / line | Weight | Face | Use |
|---|---|---|---|---|
| Hero | 68 / 68, −0.045em | 600 | Sans | Sign-in only |
| Page title | 28 / 34, −0.02em | 600 | Sans | One `h1` per page |
| Repo / workflow title | 26 / 32, −0.01em | 600 | **Mono** | Identifiers as titles |
| Section | 18 / 24 | 600 | Sans | Settings sections |
| Card title | 15 / 20 | 600 | Sans | `h2` in cards |
| Body | 14 / 21 | 400–500 | Sans | Rows, paragraphs |
| Meta | 13 / 18 | 400 | Sans | Descriptions, labels |
| Caption | 12 / 16 | 400–500 | Sans | **Minimum UI size** |
| KPI figure | 26 / 32 (24 in 6-up strips) | 600 | **Mono** | Headline numbers |
| Data | 13 | 400–500 | **Mono** | Durations, counts, SHAs, repo and job names |

Rule: **anything a machine produced — names, numbers, SHAs, branches, durations — is mono.** Prose is sans.

### 3.3 Space, radius, elevation

- **Spacing** on a 4 px base: 4, 8, 12, 16, 20, 24, 28, 32, 40. Page padding 32 top / 40 sides;
  28 between sections; 16 between cards; cards pad 18–22.
- **Radius**: chip 6 · control 8 · card 12 · panel 20 (sign-in card, dialogs). Pills and avatars are round.
- **Card**: `border-line` + gradient `#161B23 → #12161C` + `shadow-card` (a 4% top highlight and a soft
  drop). Flat `bg-surface` is fine for rows inside a card.
- **Primary button**: gradient `#8163FF → #6440F5` + `shadow-primary`. The label sits on the midpoint
  (`#7251FA`, 4.9:1 with white). Solid `--brand` is the fallback.
- **Page atmosphere**: `--page-glow` on the main column only — two faint radial lights at the top. Never
  behind tables or text blocks at full strength.

---

## 4. Layout and navigation

### 4.1 Shell (desktop ≥ 1024 px)

```
┌ Sidebar 232 ─┬ Top bar 56: breadcrumb · ⌘K search · "Synced n min ago" · refresh · alerts ┐
│ Logo + ver.  ├──────────────────────────────────────────────────────────────────────────┤
│ Org switcher │ Page header: h1 + one-line meta ········· page actions (right)          │
│ Monitor      │ KPI strip (optional)                                                     │
│  Repositories│ Sections, 28 apart                                                       │
│  Alerts  (n) │                                                                          │
│ Analyze      │                                                                          │
│  Team · Cost │                                                                          │
│  Reports     │                                                                          │
│ Pinned repos │                                                                          │
│ ⋮            │                                                                          │
│ Docs·Settings│                                                                          │
│ API budget   │                                                                          │
│ User         │                                                                          │
└──────────────┴──────────────────────────────────────────────────────────────────────────┘
```

- Keep the existing centred `max-w-[1600px]` content container from `AppShell.tsx`.
- **Remove the app footer** from the shell. The version moves to the sidebar; repo links move to Docs.
- The **top bar** is new on desktop. It replaces the per-page Refresh buttons and the home page's
  "quick action" icon buttons.
- The **sidebar** keeps a single source of nav items (`components/shell/nav-config.ts`), grouped as
  drawn: Monitor (Repositories, Alerts), Analyze (Team insights, Cost, Reports), bottom (Docs, Settings).
  Pinned repos come from the existing watchlist (`gitdash:watchlist`). The API budget reads the rate-limit
  data the sidebar already fetches.
- Active nav item: `aria-current="page"`, violet gradient fill, violet icon.

### 4.2 Breakpoints

| Width | Behaviour |
|---|---|
| ≥ 1024 | Full shell as above |
| 640–1023 | Sidebar becomes the existing slide-over drawer; top bar keeps search + alerts. *Not drawn — follow the desktop components.* |
| < 640 | Phone layout (artboards `Mobile`, `MobileRepo`): compact header, bottom tab bar (Repos · Alerts · Team · More), cards instead of tables, horizontally scrolling tab chips. Leave room for the system status bar; never draw one. |

### 4.3 Repository sub-navigation

Repository pages use **underline tabs** under the repo header, replacing the six equal header buttons.

| Tab | Route | Status |
|---|---|---|
| Overview | `/repos/[owner]/[repo]` | Exists |
| Workflows *n* | workflow table on Overview today | Needs a decision, see §10 |
| Pull requests *n* | — | **New.** Takes the PR lifecycle section out of Overview |
| Team | `/repos/[owner]/[repo]/team` | Exists |
| Issues *n* | `/repos/[owner]/[repo]/issues` | Exists |
| Security *n* | `/repos/[owner]/[repo]/security` | Exists; count badge uses warning tint |
| Audit trail | `/repos/[owner]/[repo]/audit` | Exists |

Workflow pages use the same pattern: Overview · Runs · Performance · Reliability (the existing tabs).

---

## 5. Components

Each row states what must be true. "Maps to" is the file to change first.

| Component | Contract | Maps to |
|---|---|---|
| **Button** | 36–38 px tall, radius 8, 13 px / 500–600. Variants: *primary* (gradient, one per view), *secondary* (`bg-surface border-control`), *ghost* (link colour, no border). Icon-only buttons are 36×36 and **must** have `aria-label`. | new `components/ui/Button.tsx` |
| **Status pill** | 24 px, round, tint background + text colour + 6 px dot of the same colour + word. Words: Passing, Failing, Running, Queued, No recent runs (repos); Success, Failure, Cancelled (runs). | `Badge.tsx` |
| **Rating chip** | 22 px, radius 6, 12 px / 600. Elite = success, High = info, Medium = warning, Low = failure. | `DoraKpiCards.tsx` |
| **KPI strip** | One card, *n* equal cells split by 1 px `border-line` rules. Cell: label (13 muted) → figure (mono 26) → delta line (12, coloured, arrow + words). Optional 96×36 sparkline, bottom-right. Captions must fit on one line at 1440. | `StatCard.tsx` |
| **KPI card** (DORA) | Label + rating chip → figure → full-width sparkline → delta. A regressing metric gets a warm border (`#3A2A2E`) and background (`#161419`). | `DoraKpiCards.tsx` |
| **Attention list** | Replaces the coloured card grid in `MissionControl`. One card, rows 64 px: 32 px tinted icon box · title (14/500) + reason (13 muted) · repo (mono) · relative time · chevron. The whole row is one link. Max 6 rows, then "View all alerts →". Empty state: one line, success tint, "Nothing needs attention." | `MissionControl.tsx` |
| **Data table** | Header 38–40 px on `bg-panel`, 12 px / 500 faint labels, sentence case (**no uppercase tracking**). Rows 56–58 px (44 compact), 1 px dividers. Keyboard-selected row gets `bg-raised`-ish `#161B23`. Mono for data columns. Row links go on the name cell; row actions (pin) sit outside the link. | `app/page.tsx`, `WorkflowMetrics.tsx` |
| **Run strip** | Last 10 runs, oldest → newest, 8×18 squares, gap 3, radius 2. Needs a text alternative, e.g. `aria-label="Last 10 runs: 7 passed, 3 failed"`. | `app/page.tsx` (RepoRow) |
| **Tabs** | 40 px, 14 / 500, active = `text-fg` + 2 px `brand-fg` underline + `aria-current="page"`. Counts in 12 px faint. | new `components/ui/Tabs.tsx` |
| **Segmented control** | 3 px inset track (`bg-surface`, `border-line`, radius 9), 30 px buttons with `aria-pressed`. For time ranges (24h · 7d · 30d · 90d) and channel choice. | new |
| **Filter chip** | 30 px round, `aria-pressed`; selected = `bg-brand-soft`, violet border, `#D3C7FF` text. Label includes a count ("Failing 2"). | `app/page.tsx` |
| **Input / select** | 34–38 px (46 on sign-in), radius 8 (12 on sign-in), `bg-panel`, `border-control-strong`. Always paired with a `<label>` (visually hidden is fine next to a search icon). | forms everywhere |
| **Switch** | 36×20 `button role="switch" aria-checked`, on = brand, off = `#2A313C`. Label via `aria-label` that says the action. | `app/alerts/page.tsx` |
| **Access matrix** | Native checkboxes (`accent-color: #7C5CFF`, 18 px) in 44 px cells, labelled "{Group}: {Feature}". Admin column checked and disabled. Grouped rows with 32 px section bands. | new Settings section |
| **AI summary** | Card with a 32 px violet icon box, 14/22 text (max ~820 px wide), a provenance line (12 faint: source + age), and one evidence link. Renders nothing without a provider key (as today). | `AiInsightsCard.tsx` |
| **Charts** | See §6. | `components/charts/index.tsx` |
| **Toast / float card** | `shadow-float`, radius 14, gradient `#1B212B → #151A22`. | new |

States every interactive component must have: default, hover (lighten the surface one step or raise
text `muted → fg`), focus-visible (2 px `brand-fg` ring, 2 px offset — global rule in tokens), active,
disabled (`text-disabled`, no hover), and loading where it fetches.

---

## 6. Data visualisation

1. **Colour means state or series, never decoration.** Outcomes use the status graphic colours; series
   use the chart order in §3.1.
2. **Never colour alone.** Pair it with a legend, a dot + word, or a direct label. Green/red pairs also
   differ in lightness (`#3DD68C` vs `#FF6B6B`).
3. **Lines**: 1.5 px (sparklines) or 2 px (charts), round joins, and an area fill in the line colour at
   **12% opacity**. Highlight one notable point (a 4 px dot with a surface-coloured ring, plus a 24 px
   label chip).
4. **Bars**: 3 px top radius, 4–6 px gaps; projections and future values at 35% opacity. Reference lines
   are dashed (`#4B3B99`) and labelled in mono 11 px violet.
5. **Axes**: mono **11 px** `text-faint`, gridlines `--chart-grid`, no axis lines. 11 px is the single
   exception to the 12 px floor, and only inside charts.
6. **Every chart** has `role="img"` and an `aria-label` that states the takeaway ("p95 rose to 18m 20s on
   Sep 24"), not the chart type.
7. Recharts stays. Set its colours, fonts and grid from the tokens in `components/charts/index.tsx`, not
   per chart.

---

## 7. Content rules

- Sentence case everywhere: titles, buttons, table headers. No ALL CAPS labels.
- Relative times under 7 days ("18 min ago", "2 h ago", "1 d ago"), dates after that ("Sep 24").
- Deltas: arrow + value + meaning in words, coloured by good/bad, **not** by up/down ("↓ 12s faster" is green).
- Comparisons say what they compare to, briefly: "vs prior 30d".
- Say what's wrong, in plain words, in the title: "deploy-prod is failing on main", not "Failure detected".
- Estimated numbers say so beside the number (see the DORA note on Repository overview).
- Empty states are one sentence and one action. No illustrations.

---

## 8. Accessibility (acceptance gate)

- Text contrast ≥ 4.5:1 (≥ 3:1 from 24 px). The ratios in §3.1 are measured; don't add a text colour
  darker than `#7A818D` on these surfaces.
- Meaningful graphics (run squares, status dots, chart lines) ≥ 3:1 against their background.
- Real elements only: `<button>`, `<a href>`, `<input>` + `<label>`. No `onClick` on a `div` or `span`.
- `aria-current="page"` on the active nav item, tab and breadcrumb leaf; `aria-pressed` on toggles and
  chips; `role="switch"` + `aria-checked` on switches.
- Hit targets: ≥ 32 px desktop (icon buttons 36), ≥ 44 px on phones.
- Keyboard: global `⌘K`; on the repository list `/` filter, `↑ ↓` move, `↵` open, `p` pin. Show the hints
  in the table footer as drawn. Focus is always visible.
- Respect `prefers-reduced-motion`: turn off the skeleton shimmer and any transitions over 120 ms.

---

## 9. Screen inventory

| Screen | Route | Artboard | Key requirements |
|---|---|---|---|
| Repositories (home) | `/` (`?org=`) | `Main` | Header with 24h/7d/30d/90d range and Health scorecard link; 4-cell fleet KPI strip; attention list; repository table with pin, status, 30-day success bar, run strip, p95, last run + branch; filter chips with counts; default sort "Needs attention first"; `density` comfortable/compact. |
| Repository overview | `/repos/[owner]/[repo]` | `Repo` | Mono title with muted owner, meta row, Pin + Open in GitHub; tabs (§4.3); AI summary; 4 DORA cards + estimation note; run duration chart (p50/p95) + outcomes breakdown + jobs that fail most; workflows table. |
| Workflow detail | `/repos/[owner]/[repo]/workflows/[id]` | `Workflow` | Status pill with streak, file path, trigger; Export CSV; 6-cell KPI strip; last-40-runs bar chart with p95 line; AI failure hypotheses with Likely/Possible/Unlikely; job time breakdown (p50 bar + p95 tick); recent runs table. |
| Team insights | `/team` | `Team` | 5-cell KPI strip incl. review bus factor; who-reviews-whom heatmap; workload-to-watch list; contributors table. |
| Cost | `/cost-analytics` | `Cost` | Month stepper, Download CSV; 4-cell KPI strip with projection vs last month; daily stacked spend by runner OS with faded projection; top repositories by spend; savings suggestions with estimated amounts. |
| Alerts | `/alerts` | `Alerts` | "Firing now" rows with Mute 1h + Investigate; rules list with switches; new-rule form in a side panel with a plain-language preview sentence and "Send a test". |
| Settings · access | `/settings` (new section) | `Settings` | Settings sub-nav; group × feature matrix (the RBAC plan); waiting-for-access queue with group select, Decline/Approve; link to audit log. |
| Sign in | `/login` | `Login` | Hero with product preview; "Continue with GitHub" primary; PAT field with scope list and storage note; demo link; version. |
| Phone · repositories | `/` < 640 px | `Mobile` | Header, attention card (2 rows), segmented filter, repo cards, bottom tab bar. |
| Phone · repository | `/repos/...` < 640 px | `MobileRepo` | Back, pin, status meta, tab chips, summary, 2×2 DORA grid, workflows list. |
| Sidebar | shell | `Sidebar` | As §4.1; `active` prop drives the current item. |
| Design system | — | `System` | Reference sheet for tokens and components. |

Screens not drawn — Reports, Docs, Setup, Demo, Org health, Contributor, Issues, Security, Audit — follow
the shell, page anatomy and components above with no new patterns.

---

## 10. Implementation order and acceptance

**Today's baseline (measured 2026-09-27):** the CSS variables in `src/app/globals.css` have **0**
references. The UI uses about **2,136** raw `slate-*`/`violet-*` Tailwind classes and **216** hex literals.
`components/shell/PrimaryRail.tsx`, `WorkspacePanel.tsx` and `MobileNavDrawer.tsx` are not rendered
anywhere.

| Step | Change | Done when |
|---|---|---|
| 1 | Replace the token block in `globals.css` with `design/tokens/tokens.css`; map fonts to the `next/font` variables | `pnpm build` passes; `bg-surface`, `text-muted`, `rounded-card` generate |
| 2 | *Optional bridge:* remap Tailwind's `--color-slate-*` / `--color-violet-*` in `@theme` to the graphite palette so the ~2,136 existing classes re-skin at once. Trade-off: fast, but slate steps are used inconsistently today, so some contrast will be off until step 5. | Every page renders in the new palette |
| 3 | Shell: new sidebar grouping, top bar, remove footer; delete or wire the unused shell components | Matches `Sidebar` + top bar in every desktop screenshot |
| 4 | Shared components (§5) in `components/ui/` | Each used by at least one page |
| 5 | Pages in inventory order (§9), replacing raw colour classes with token utilities as each is touched | Side-by-side match with its screenshot at 1440 px; no `slate-`/`violet-`/hex left in the file |
| 6 | Phone layout | Matches `Mobile` / `MobileRepo` at 390 px |

**Definition of done for any screen:** matches its screenshot in layout, hierarchy, type and colour at
1440 px (data may differ); passes §8; `pnpm lint` and `pnpm test` clean; loading, empty and error states
implemented (skeleton = `bg-surface` shimmer; error = failure-tint banner with a retry action).

---

## 11. Open decisions

1. **Workflows tab:** keep the workflow table on Overview (as drawn) *and* give it a tab, or move it to
   the tab only? Recommendation: keep a 6-row preview on Overview, full list in the tab.
2. **Pull requests tab** needs a new route. Recommendation: `/repos/[owner]/[repo]/pulls`, hosting the
   existing PR lifecycle section.
3. **Light theme:** out of scope for v1. The tokens are named by role, so a light set can be added later
   without touching components.
4. **"My features"** (a user hiding granted features) is in the Settings sub-nav but not drawn; it reuses
   the matrix row pattern with one switch column.
5. Step 2's bridge (re-skinning via the slate scale): take it for speed, or skip it and migrate page by page?
