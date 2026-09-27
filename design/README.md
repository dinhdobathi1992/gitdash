# GitDash redesign — "Graphite console"

The redesign of every GitDash screen, exported from the design canvas.

- **Start here:** [DESIGN-CONTRACT.md](DESIGN-CONTRACT.md). It says what implementation must do.
- **See the screens:** open [index.html](index.html) in a browser, or browse [screenshots/](screenshots/).
- **Live canvas:** https://claude.ai/artifact/W92ksxwbS3iy3PYd92mKmo (private; the owner shares it from its Share menu).

| Folder | Contents |
|---|---|
| `tokens/` | `tokens.css`: drop-in for `src/app/globals.css`, verified against Tailwind v4 · `tokens.json`: generated from it |
| `screenshots/` | One PNG per screen at its design size (phones and sidebar at 2x) |
| `html/` | One static HTML page per screen; no runtime, open directly |
| `artifact/` | Canvas source as published: `canvas.json` + `*.dc.html` artboards |
| `scripts/` | `export-design.mjs`: rebuilds `html/`, `screenshots/` and `index.html` |

## Regenerate after the canvas changes

1. Download the canvas's `project/` files into `design/artifact/`, replacing what's there.
2. Run:

```bash
node design/scripts/export-design.mjs
```

It needs a headless Chromium and network access, because fonts load from Google Fonts. It looks for
`$CHROME_BIN` first, then Playwright's `chrome-headless-shell`, then Google Chrome. Install the shell with
`pnpm dlx playwright install chromium-headless-shell` if you have neither. Desktop Chrome's `--headless` can
hang on macOS; that is why the shell is preferred.

Mockup numbers, names and people are sample data. Only layout, styling and behaviour are binding.
