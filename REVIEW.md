# REVIEW.md — UX and AX checklist

Use this for any change that touches a public page (`/welcome`, `/docs/**`, `/login`, `/setup`), the
proxy's public paths, or page metadata. Attach screenshots to UI pull requests.

## People (UX)

- [ ] Screenshots at **1440×900, 768×1024 and 375×812** show no overflow, clipped text, overlaps or
      broken images. Also check 320 px for horizontal scroll.
- [ ] Within five seconds, the first screen says what it is, for whom, and the outcome.
- [ ] Each view has one primary action, and each destination has one label.
- [ ] Every interactive element can be reached by Tab, shows a visible focus ring, and has an
      accessible name (icon-only buttons need `aria-label`).
- [ ] Targets are at least 24 px, except links inside a sentence.
- [ ] With `prefers-reduced-motion: reduce`, nothing animates.
- [ ] A signed-out visitor to a public page stays on it: no redirect, and no `/api/*` 401s in the
      network panel.

## Agents and search (AX)

- [ ] `curl` (no JavaScript) of each changed page shows its H1 and main text.
- [ ] One H1 per page, a unique `<title>` and description, and an absolute canonical.
- [ ] `og:image`, `og:title`, `og:description` and `twitter:card=summary_large_image` are present.
      Check the card image at `/opengraph-image` (or the page's own).
- [ ] New public pages are listed in `src/app/sitemap.ts` (docs pages come from
      `src/app/docs/_parts/nav.ts`) and reachable without sign-in in `src/proxy.ts`.
- [ ] `/<page>.md` returns readable markdown (`text/markdown`, `X-Robots-Tag: noindex`), and
      `/llms.txt` links it.
- [ ] Discovery scan exits 0. Run it against a production build behind `X-Forwarded-Proto: https`, or
      against the deployed site:
      `node ~/.claude/skills/ak-enhance-ux-ax/scripts/check-discovery-surfaces.mjs https://www.gitdash.info --sample 10`
- [ ] No FAQPage or HowTo markup; those rich results are retired.
