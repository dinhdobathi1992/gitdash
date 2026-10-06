/**
 * A small HTML → Markdown converter for GitDash's own server-rendered pages
 * (docs and the landing page). It understands the markup those pages use —
 * headings, paragraphs, lists, tables, code, links, emphasis — and drops
 * interactive chrome: <button>, <svg>, <script>, aria-hidden subtrees and
 * anything marked data-md-skip. It is not a general-purpose HTML parser.
 */

type Node = { tag: string; attrs: Record<string, string>; children: (Node | string)[] };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SKIP = new Set(["script", "style", "svg", "button", "noscript", "template", "head", "title", "select", "textarea", "video", "iframe"]);
const RAW_TEXT = new Set(["script", "style"]);
const BLOCK = new Set(["p", "div", "section", "article", "main", "header", "footer", "figure", "figcaption", "aside", "nav", "dl", "dt", "dd", "details", "summary", "blockquote", "form", "fieldset", "body", "html"]);

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  mdash: "—", ndash: "–", hellip: "…", middot: "·", rarr: "→", larr: "←", times: "×", copy: "©",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export function parseHtml(html: string): Node {
  const root: Node = { tag: "#root", attrs: {}, children: [] };
  const stack: Node[] = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+|</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [whole, close, open, rawAttrs] = m;
    const top = stack[stack.length - 1];
    if (close) {
      const tag = close.toLowerCase();
      const i = stack.map((n) => n.tag).lastIndexOf(tag);
      if (i > 0) stack.length = i;
    } else if (open) {
      const tag = open.toLowerCase();
      const node: Node = { tag, attrs: parseAttrs(rawAttrs ?? ""), children: [] };
      top.children.push(node);
      if (RAW_TEXT.has(tag)) {
        // Script and style bodies are raw text: a "</main>" inside one must not close anything.
        const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
        re.lastIndex = end === -1 ? html.length : end;
        const close = html.indexOf(">", re.lastIndex);
        re.lastIndex = close === -1 ? html.length : close + 1;
      } else if (!VOID.has(tag) && !rawAttrs?.trimEnd().endsWith("/")) stack.push(node);
    } else if (!whole.startsWith("<!")) {
      top.children.push(whole);
    }
  }
  return root;
}

/** First node (depth-first) that matches. */
export function findNode(node: Node, match: (n: Node) => boolean): Node | null {
  if (match(node)) return node;
  for (const c of node.children) {
    if (typeof c !== "string") {
      const hit = findNode(c, match);
      if (hit) return hit;
    }
  }
  return null;
}

function textOf(node: Node | string): string {
  if (typeof node === "string") return decodeEntities(node);
  if (SKIP.has(node.tag) || skipped(node)) return "";
  return node.children.map(textOf).join("");
}

function skipped(n: Node): boolean {
  return n.attrs["aria-hidden"] === "true" || "data-md-skip" in n.attrs || "hidden" in n.attrs;
}

type Ctx = { base: string; listDepth: number };

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function inline(nodes: (Node | string)[], ctx: Ctx): string {
  let out = "";
  let prevElement = false;
  for (const n of nodes) {
    const part = render(n, ctx);
    if (!part) continue;
    // Sibling elements laid out side by side (flex rows of links, badges,
    // label + value) carry no whitespace between them in the HTML.
    const isElement = typeof n !== "string";
    if (isElement && prevElement && !/\s$/.test(out) && !/^\s/.test(part)) out += " ";
    out += part;
    prevElement = isElement;
  }
  return out;
}

function block(s: string): string {
  const t = s.trim();
  return t ? `\n\n${t}\n\n` : "";
}

function cell(n: Node, ctx: Ctx): string {
  return render(n, ctx).replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim();
}

function table(n: Node, ctx: Ctx): string {
  const rows: Node[] = [];
  const collect = (x: Node) => x.children.forEach((c) => {
    if (typeof c === "string") return;
    if (c.tag === "tr") rows.push(c);
    else if (["thead", "tbody", "tfoot"].includes(c.tag)) collect(c);
  });
  collect(n);
  const grid = rows.map((r) => r.children.filter((c): c is Node => typeof c !== "string" && (c.tag === "th" || c.tag === "td")).map((c) => cell(c, ctx)));
  if (!grid.length) return "";
  const width = Math.max(...grid.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  return block([line(grid[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...grid.slice(1).map(line)].join("\n"));
}

/**
 * Continuation lines of a list item: blank lines dropped and text indented
 * under the marker, except nested list lines (already indented) and the
 * inside of code fences, which keep every line, blank or not.
 */
function indentItem(body: string, pad: string): string {
  let fence: string | null = null;
  const out: string[] = [];
  body.split("\n").forEach((line, i) => {
    const marker = line.trimStart().match(/^(`{3,})/)?.[1];
    const inFence = fence !== null;
    if (marker && (!fence || marker === fence)) fence = fence ? null : marker;
    if (i === 0) return out.push(line);
    if (inFence) return out.push(line ? pad + line : line);
    if (!line.trim()) return;
    out.push(/^\s*(?:[-*]|\d+\.) /.test(line) ? line : pad + line.trimStart());
  });
  return out.join("\n");
}

function list(n: Node, ctx: Ctx): string {
  const ordered = n.tag === "ol";
  const indent = "  ".repeat(ctx.listDepth);
  let i = 0;
  const items = n.children
    .filter((c): c is Node => typeof c !== "string" && c.tag === "li" && !skipped(c))
    .map((li) => indentItem(render({ ...li, tag: "#li" }, { ...ctx, listDepth: ctx.listDepth + 1 }).trim(), `${indent}  `))
    // Items whose only content was interactive chrome (e.g. a button) carry nothing.
    .filter(Boolean)
    .map((body) => {
      i += 1;
      return `${indent}${ordered ? `${i}.` : "-"} ${body}`;
    });
  return ctx.listDepth ? `\n${items.join("\n")}\n` : block(items.join("\n"));
}

function render(n: Node | string, ctx: Ctx): string {
  if (typeof n === "string") return decodeEntities(n).replace(/\s+/g, " ");
  if (SKIP.has(n.tag) || skipped(n)) return "";
  const kids = () => inline(n.children, ctx);
  switch (n.tag) {
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
      return block(`${"#".repeat(Number(n.tag[1]))} ${kids().replace(/\s+/g, " ").trim()}`);
    case "pre": {
      const code = findNode(n, (x) => x.tag === "code");
      const lang = n.attrs["data-language"] || code?.attrs.class?.match(/language-(\S+)/)?.[1] || "";
      const body = textOf(n).replace(/\n+$/, "");
      const fence = body.includes("```") ? "````" : "```";
      return block(`${fence}${lang}\n${body}\n${fence}`);
    }
    case "code": {
      const t = textOf(n);
      return t.includes("`") ? `\`\` ${t} \`\`` : `\`${t}\``;
    }
    case "a": {
      const text = kids().trim();
      const href = n.attrs.href;
      if (!text) return "";
      if (!href || href.startsWith("#")) return text;
      const url = absolute(href.trim(), ctx.base);
      // Only web and mail links survive; javascript:, data: and the like become plain text.
      if (!/^(https?:|mailto:)/i.test(url)) return text;
      return `[${text.replace(/([[\]])/g, "\\$1")}](${url.replace(/\)/g, "%29")})`;
    }
    case "strong": case "b": {
      const t = kids().trim();
      return t ? `**${t}**` : "";
    }
    case "em": case "i": {
      const t = kids().trim();
      return t ? `*${t}*` : "";
    }
    case "br": return "\n";
    case "hr": return block("---");
    case "img": {
      const alt = n.attrs.alt ?? "";
      return n.attrs.src ? `![${alt}](${absolute(n.attrs.src, ctx.base)})` : "";
    }
    case "ul": case "ol": return list(n, ctx);
    case "table": return table(n, ctx);
    case "li": case "#li": return kids();
    case "blockquote": return block(kids().trim().split("\n").map((l) => `> ${l}`).join("\n"));
    default:
      return BLOCK.has(n.tag) ? block(kids()) : kids();
  }
}

/** Markdown for a node (normally a page's main content), with links made absolute against `base`. */
export function nodeToMarkdown(node: Node, base: string): string {
  let fence: string | null = null;
  const out: string[] = [];
  for (const raw of render(node, { base, listDepth: 0 }).split("\n")) {
    const marker = raw.trimStart().match(/^(`{3,})/)?.[1];
    if (fence) {
      // Inside code every line, blank or not, is kept as written.
      if (marker === fence.trim()) fence = null;
      out.push(fence ? raw : raw.trimEnd());
      continue;
    }
    if (marker) fence = marker;
    // Outside code: keep list indentation, drop stray spaces left by inline
    // markup, and never leave more than one blank line in a row.
    const line = /^\s*(?:[-*]|\d+\.|`{3,}) /.test(raw) || /^\s+`{3,}/.test(raw) ? raw.trimEnd() : raw.trim();
    if (!line && !out[out.length - 1]) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}
