#!/usr/bin/env node
/**
 * Export the GitDash design canvas to plain HTML pages and PNG screenshots.
 *
 * Input:  design/artifact/  — canvas.json + one *.dc.html per artboard, exactly
 *         as published on the Design artifact.
 * Output: design/html/<Board>.html         static page, no runtime, opens in any browser
 *         design/screenshots/<Board>.png   capture at the artboard's own size
 *         design/index.html                gallery of every screen
 *
 * The .dc.html files are Design Component templates ({{holes}}, <sc-for>,
 * <sc-if>, <dc-import>) that normally need the canvas runtime. This script
 * ships a tiny stand-in runtime into a staging page, lets headless Chrome
 * expand it once, and keeps the resulting DOM. Handlers are dropped: the
 * exports are pictures of the design, not a working prototype.
 *
 * Usage: node design/scripts/export-design.mjs
 * Needs a headless Chromium and network access (fonts load from Google Fonts).
 * Browser lookup: $CHROME_BIN, then Playwright's chrome-headless-shell cache,
 * then Google Chrome. Desktop Chrome's --headless can hang on macOS without
 * exiting, which is why the headless shell is preferred.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(DESIGN_DIR, "artifact");
const HTML_OUT = path.join(DESIGN_DIR, "html");
const PNG_OUT = path.join(DESIGN_DIR, "screenshots");
const CHROME = process.env.CHROME_BIN ?? findHeadlessShell() ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function findHeadlessShell() {
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  if (!fs.existsSync(cache)) return null;
  const dirs = fs.readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const d of dirs) {
    for (const sub of fs.readdirSync(path.join(cache, d))) {
      const bin = path.join(cache, d, sub, "chrome-headless-shell");
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}

// ── Parse the artboard sources ───────────────────────────────────────────────

const decodeAttr = (s) =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function parseBoard(file) {
  const src = fs.readFileSync(path.join(SRC, file), "utf8");
  const xdc = src.slice(src.indexOf("<x-dc>") + 6, src.indexOf("</x-dc>"));
  const helmet = (xdc.match(/<helmet>([\s\S]*?)<\/helmet>/) ?? [, ""])[1];
  const script = src.match(/<script type="text\/x-dc" data-dc-script data-props='([^']*)'>([\s\S]*?)<\/script>/);
  if (!script) throw new Error(`${file}: no data-dc-script block`);
  return {
    name: file.replace(/\.dc\.html$/, ""),
    title: (src.match(/<title>([\s\S]*?)<\/title>/) ?? [, file])[1],
    helmet,
    markup: xdc.replace(/<helmet>[\s\S]*?<\/helmet>/, ""),
    props: JSON.parse(decodeAttr(script[1])),
    code: script[2],
  };
}

// ── Stand-in runtime, runs inside the staging page ───────────────────────────

const RUNTIME = String.raw`
(function () {
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState() {}
    forceUpdate() {}
  }
  const DEFS = window.__DC_DEFS__;
  const WHOLE = /^\s*\{\{([^}]+)\}\}\s*$/;
  const strip = (s) => s.replace(/^\s*\{\{|\}\}\s*$/g, "");

  function lookup(p, scope) {
    p = p.trim();
    if (p === "true") return true;
    if (p === "false") return false;
    if (p === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(p)) return Number(p);
    if (/^'.*'$|^".*"$/.test(p)) return p.slice(1, -1);
    return p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), scope);
  }
  const interp = (s, scope) =>
    s.replace(/\{\{([^}]+)\}\}/g, (_, p) => { const v = lookup(p, scope); return v == null ? "" : String(v); });

  function vals(name, props) {
    const Comp = new Function("DCLogic", DEFS[name].code + "\n;return Component;")(DCLogic);
    return new Comp(props).renderVals() || {};
  }

  function expandChildren(src, dst, scope) {
    for (const ch of Array.from(src.childNodes)) expandNode(ch, dst, scope);
  }

  function expandNode(node, dst, scope) {
    if (node.nodeType === 3) { dst.appendChild(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === "sc-for") {
      const list = lookup(strip(node.getAttribute("list")), scope) || [];
      const as = node.getAttribute("as") || "item";
      list.forEach((item, i) => expandChildren(node, dst, Object.assign({}, scope, { [as]: item, $index: i })));
      return;
    }
    if (tag === "sc-if") {
      if (lookup(strip(node.getAttribute("value")), scope)) expandChildren(node, dst, scope);
      return;
    }
    if (tag === "dc-import") {
      const props = {};
      for (const a of Array.from(node.attributes)) {
        if (a.name === "name" || a.name.startsWith("hint-")) continue;
        const key = a.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const m = a.value.match(WHOLE);
        props[key] = m ? lookup(m[1], scope) : interp(a.value, scope);
      }
      render(node.getAttribute("name"), props, dst);
      return;
    }
    const el = node.cloneNode(false);
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name)) { el.removeAttribute(a.name); continue; }
      if (!a.value.includes("{{")) continue;
      const m = a.value.match(WHOLE);
      if (!m) { el.setAttribute(a.name, interp(a.value, scope)); continue; }
      const v = lookup(m[1], scope);
      if (typeof v === "function") el.removeAttribute(a.name);
      else if (typeof v === "boolean" && !a.name.startsWith("aria-")) v ? el.setAttribute(a.name, "") : el.removeAttribute(a.name);
      else el.setAttribute(a.name, v == null ? "" : String(v));
    }
    expandChildren(node, el, scope);
    dst.appendChild(el);
  }

  function render(name, props, dst) {
    expandChildren(document.getElementById("dc-" + name).content, dst, vals(name, props));
  }

  const root = document.getElementById("dc-root");
  render(window.__DC_MAIN__, {}, root);
  root.replaceWith(...Array.from(root.childNodes));
  document.querySelectorAll("template[id^='dc-'], script[data-dc-runtime]").forEach((n) => n.remove());
})();
`;

function stagingPage(main, boards) {
  const defs = Object.fromEntries(boards.map((b) => [b.name, { code: b.code }]));
  const json = JSON.stringify(defs).replace(/<\//g, "<\\/");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${main.title} · GitDash design</title>
${main.helmet.trim()}
</head>
<body>
<div id="dc-root"></div>
${boards.map((b) => `<template id="dc-${b.name}">${b.markup}</template>`).join("\n")}
<script data-dc-runtime>window.__DC_DEFS__ = ${json}; window.__DC_MAIN__ = ${JSON.stringify(main.name)};</script>
<script data-dc-runtime>${RUNTIME}</script>
</body>
</html>
`;
}

// ── Chrome ───────────────────────────────────────────────────────────────────

function chrome(args, profile) {
  return execFileSync(
    CHROME,
    [...(CHROME.includes("headless-shell") ? [] : ["--headless=new"]), "--disable-gpu", "--no-first-run",
      "--hide-scrollbars", `--user-data-dir=${profile}`, "--virtual-time-budget=6000", ...args],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], timeout: 120_000 },
  );
}

// ── Gallery ──────────────────────────────────────────────────────────────────

function gallery(canvas) {
  const cards = canvas.order
    .map((file) => {
      const name = file.replace(/\.dc\.html$/, "");
      const b = canvas.boards[file];
      return `<a class="card" href="html/${name}.html">
  <span class="shot"><img src="screenshots/${name}.png" alt="${b.title ?? name} screen" loading="lazy" width="${b.w}" height="${b.h}"></span>
  <span class="meta"><span class="t">${b.title ?? name}</span><span class="s">${b.w} × ${b.h}</span></span>
</a>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GitDash redesign · screens</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
:root{--ground:#0B0D11;--line:#1F2530;--text:#EDEAE3;--muted:#A3A9B4;--faint:#7A818D;--violet:#B9A6FF}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(900px 480px at 78% -8%,rgba(124,92,255,.13),transparent 70%),var(--ground);color:var(--text);font-family:Geist,system-ui,sans-serif}
main{max-width:1320px;margin:0 auto;padding:56px 24px 80px}
h1{margin:0 0 8px;font-size:40px;letter-spacing:-.03em;font-weight:600}
p{margin:0 0 40px;color:var(--muted);font-size:15px;line-height:1.6;max-width:720px}
p a{color:var(--violet)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px}
.card{display:flex;flex-direction:column;gap:12px;text-decoration:none;color:inherit}
.shot{display:block;aspect-ratio:4/3;overflow:hidden;border-radius:12px;border:1px solid var(--line);background:#12161C}
.shot img{width:100%;height:auto;display:block}
.card:hover .shot{border-color:#4B3B99}
.meta{display:flex;justify-content:space-between;gap:12px;font-size:14px}
.t{font-weight:500}.s{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;color:var(--faint)}
</style>
</head>
<body>
<main>
<h1>GitDash redesign</h1>
<p>Every screen from the design canvas. Click a screen for its full-size HTML page. Source, contract and tokens are in this folder — start with <a href="DESIGN-CONTRACT.md">DESIGN-CONTRACT.md</a>.</p>
<div class="grid">
${cards}
</div>
</main>
</body>
</html>
`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const canvas = JSON.parse(fs.readFileSync(path.join(SRC, "canvas.json"), "utf8"));
const boards = canvas.order.map(parseBoard);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "gitdash-design-"));
const profile = path.join(stage, "chrome-profile");
fs.mkdirSync(HTML_OUT, { recursive: true });
fs.mkdirSync(PNG_OUT, { recursive: true });

try {
  for (const board of boards) {
    const { w, h } = canvas.boards[`${board.name}.dc.html`];
    const staged = path.join(stage, `${board.name}.html`);
    fs.writeFileSync(staged, stagingPage(board, boards));
    const url = `file://${staged}`;

    let dom = chrome(["--dump-dom", url], profile).trim();
    if (!/^<!doctype/i.test(dom)) dom = `<!doctype html>\n${dom}`;
    fs.writeFileSync(path.join(HTML_OUT, `${board.name}.html`), dom + "\n");

    const scale = w < 600 ? 2 : 1; // phones at 2x so text stays crisp
    chrome([`--screenshot=${path.join(PNG_OUT, `${board.name}.png`)}`, `--window-size=${w},${h}`,
      `--force-device-scale-factor=${scale}`, url], profile);
    console.log(`✓ ${board.name}  ${w}×${h}${scale > 1 ? " @2x" : ""}`);
  }
  fs.writeFileSync(path.join(DESIGN_DIR, "index.html"), gallery(canvas));
  console.log("✓ index.html");
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
