<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Public pages, design and discovery

- Read `DESIGN.md` before any UI work. The app follows `design/DESIGN-CONTRACT.md`; public pages
  (`/welcome`, `/docs/**`, `/login`, `/setup`) add the rules in `DESIGN.md`.
- Docs pages are server-rendered routes: `src/app/docs/(sections)/[slug]`. To add one, add an entry to
  `src/app/docs/_parts/nav.ts`, a component to `_parts/registry.tsx` and a summary to
  `src/components/docs/search-index.ts`. The sitemap, `llms.txt`, `llms-full.txt`, the markdown twins
  and the social cards all follow from those three files.
- Keep discovery surfaces in sync when public routes change: `ALWAYS_PUBLIC` in `src/proxy.ts`,
  `src/app/sitemap.ts` and `src/app/robots.ts`. Robots and sitemap only open up when
  `GITDASH_LANDING_PAGE=true`; self-hosted instances answer `Disallow: /`.
- Markdown twins (`/<page>.md`) are converted from the page's own HTML by `src/lib/html-to-markdown.ts`.
  Mark chrome that should not reach them with `data-md-skip` or `aria-hidden="true"`.
- Verify UI changes at 1440, 768 and 375 px and run the checklist in `REVIEW.md`.
