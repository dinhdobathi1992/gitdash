# DESIGN.md — GitDash

**Brand line:** *Everything metrics, measured.* GitDash is a self-hosted GitHub Actions and pull-request
dashboard. It should read as a precise instrument: calm graphite, one violet signal and numbers set in mono.

## Where the rules live

| Surface | Authority |
|---|---|
| The app (every page in `src/app/**` except below) | [`design/DESIGN-CONTRACT.md`](design/DESIGN-CONTRACT.md), "Graphite console". Tokens in `design/tokens/`. That contract wins on any conflict |
| Public pages: `/welcome`, `/docs/**`, `/login`, `/setup` | This file, layered on the contract's tokens |

## Public pages: art direction

- **Graphite ground, one accent.** Violet (`text-link`, `bg-primary`) marks the single primary action and
  the accent word of a headline. Cyan → violet appears only as the four-bar logo mark.
- **Type.** Geist for UI and headlines. Hero headlines are tight (`tracking-[-0.05em]`, line height
  ~1.0). Geist Mono for every number, version and code token.
- **One motif.** The four rising bars (`LogoMark`) appear on the favicon, the header, every social card
  (`src/lib/og-card.tsx`) and the footer. Product visuals are illustrations labelled "Example".
- **Voice.** Plain, specific and knowledgeable. Lead with the outcome for the reader, then the mechanism.
  Headlines are at most ten words, CTAs are a verb plus an object, and no filler adjectives.
- **One label per destination.** `#deploy` is always "Deploy it free" and `#tour` is always "Watch the
  90-second tour".

## Motion

Transitions are 100–120 ms on colour, opacity and transform only. Nothing moves on its own, and
`prefers-reduced-motion` turns transitions off (`globals.css`). Content is never hidden at `opacity: 0`
waiting for a script.

## Layout and breakpoints

- Mobile-first. Check 320, 375, 768, 1024 and 1440 px. There is no horizontal scroll at any width.
- The landing header shows section links from `lg` (1024 px) up. Below that it keeps the logo plus
  GitHub, Sign in and the primary CTA.
- Docs: `DocsTopBar` (product links) above `DocsFrame` (sidebar on `lg+`, a drawer below). Docs never
  render inside the app shell.
- Touch targets are at least 24 px, and primary controls are 36–48 px.

## Do / don't

| Do | Don't |
|---|---|
| Server-render headings and copy; make every docs page its own URL | Switch content in client state with no URL |
| Show real product UI or labelled examples | Use stock imagery or unlabelled fake numbers |
| Put one filled primary button per view | Put two filled buttons side by side |
| Use `aria-hidden` on decorative mocks and `data-md-skip` on chrome that should not reach the markdown twin | Hide meaningful text from the markdown twin |
