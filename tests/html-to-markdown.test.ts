import { describe, it, expect } from "vitest";
import { findNode, nodeToMarkdown, parseHtml } from "@/lib/html-to-markdown";

const md = (html: string) => nodeToMarkdown(parseHtml(html), "https://example.com/docs/x");

describe("html-to-markdown", () => {
  it("converts headings, paragraphs, emphasis and inline code", () => {
    expect(md("<h1>Title</h1><p>Use <strong>this</strong> and <code>MODE</code>, <em>not</em> that.</p>"))
      .toBe("# Title\n\nUse **this** and `MODE`, *not* that.");
  });

  it("keeps code blocks verbatim with their language", () => {
    expect(md('<pre data-language="bash">pnpm install\n  pnpm dev</pre>')).toBe("```bash\npnpm install\n  pnpm dev\n```");
  });

  it("makes links absolute and keeps plain text for in-page anchors", () => {
    expect(md('<p><a href="/docs/caching">Caching</a> and <a href="#top">top</a></p>'))
      .toBe("[Caching](https://example.com/docs/caching) and top");
  });

  it("renders tables as GFM and escapes pipes", () => {
    expect(md("<table><thead><tr><th>Name</th><th>Use</th></tr></thead><tbody><tr><td>a|b</td><td><code>x</code></td></tr></tbody></table>"))
      .toBe("| Name | Use |\n| --- | --- |\n| a\\|b | `x` |");
  });

  it("renders nested lists", () => {
    expect(md("<ul><li>One<ul><li>Inner</li></ul></li><li>Two</li></ul>")).toBe("- One\n  - Inner\n- Two");
  });

  it("drops buttons, svg, aria-hidden and data-md-skip content", () => {
    expect(md('<div><button>Copy</button><svg><path/></svg><span aria-hidden="true">x</span><div data-md-skip>bar</div><p>Kept</p></div>'))
      .toBe("Kept");
  });

  it("decodes entities", () => {
    expect(md("<p>Don&#x27;t &amp; won&apos;t &mdash; ok</p>")).toBe("Don't & won't — ok");
  });

  it("finds the marked content root", () => {
    const tree = parseHtml('<body><nav>menu</nav><article data-doc-content><h1>Doc</h1></article></body>');
    const root = findNode(tree, (n) => "data-doc-content" in n.attrs);
    expect(root && nodeToMarkdown(root, "https://example.com/")).toBe("# Doc");
  });
});

describe("html-to-markdown — layout markup", () => {
  it("separates side-by-side elements and flattens line breaks in headings", () => {
    expect(md('<h1>Everything metrics,<br/><span>measured.</span></h1><div><a href="/a">One</a><a href="/b">Two</a></div>'))
      .toBe("# Everything metrics, measured.\n\n[One](https://example.com/a) [Two](https://example.com/b)");
  });

  it("drops list items that only held interactive chrome", () => {
    expect(md("<ol><li><button>Play</button></li><li>Real</li></ol>")).toBe("1. Real");
  });
});

describe("html-to-markdown — robustness", () => {
  it("leaves out-of-range numeric entities as written", () => {
    expect(md("<p>&#99999999; ok</p>")).toBe("&#99999999; ok");
  });

  it("keeps blank lines inside code blocks", () => {
    expect(md("<pre>a\n\n\n\nb</pre>")).toBe("```\na\n\n\n\nb\n```");
  });

  it("indents a code block inside a list item without breaking it", () => {
    expect(md('<ul><li>Run<pre data-language="bash">pnpm i\n\n  - not an item</pre></li><li>Next</li></ul>'))
      .toBe("- Run\n  ```bash\n  pnpm i\n\n    - not an item\n  ```\n- Next");
  });

  it("treats script bodies as raw text", () => {
    const tree = parseHtml("<main><script>var s='</main>'</script><p>After</p></main>");
    expect(nodeToMarkdown(tree, "https://example.com/")).toBe("After");
  });

  it("drops non-web link schemes and escapes brackets in link text", () => {
    expect(md('<p><a href="JavaScript:alert(1)">x</a> <a href="data:text/html,hi">y</a> <a href="/a">[b]</a></p>'))
      .toBe("x y [\\[b\\]](https://example.com/a)");
  });

  it("survives unclosed tags", () => {
    expect(md("<p>One<p>Two")).toBe("One\n\nTwo");
  });
});

describe("html-to-markdown — escaping", () => {
  it("escapes backslashes before pipes in table cells", () => {
    expect(md("<table><tr><th>A</th></tr><tr><td>x\\|y</td></tr></table>")).toBe("| A |\n| --- |\n| x\\\\\\|y |");
  });

  it("escapes backslashes before brackets in link text", () => {
    expect(md('<a href="/a">a\\]b</a>')).toBe("[a\\\\\\]b](https://example.com/a)");
  });
});
