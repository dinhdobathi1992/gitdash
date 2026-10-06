"use client";

import { Plug } from "lucide-react";
import { Callout } from "@/components/docs/Callout";
import { CodeBlock, Code } from "@/components/docs/CodeBlock";
import { DocCard, DocTable } from "@/components/docs/DocCard";
import { SectionHeading, SubHeading, ProseP } from "./primitives";

export function McpServer() {
  return (
    <section id="mcp" className="scroll-mt-20 space-y-6">
      <SectionHeading id="mcp" icon={Plug}>MCP server</SectionHeading>

      <ProseP>
        GitDash speaks the Model Context Protocol, so an AI assistant can look things up in these docs while it helps
        you: setup, configuration, access control and what every metric means. Add <Code>/mcp</Code> on any GitDash
        host as a remote MCP server. It is read-only and needs no sign-in.
      </ProseP>

      <DocCard>
        <SubHeading>Connect</SubHeading>
        <DocTable
          headers={["Client", "How"]}
          rows={[
            ["Claude (claude.ai, Desktop)", <>Settings → Connectors → Add custom connector, URL <Code key="u">https://www.gitdash.info/mcp</Code></>],
            ["Claude Code", <Code key="c">claude mcp add --transport http gitdash https://www.gitdash.info/mcp</Code>],
            ["Cursor", <>Add the server to <Code key="f">.cursor/mcp.json</Code> (below)</>],
            ["MCP Inspector", <Code key="i">npx @modelcontextprotocol/inspector</Code>],
          ]}
        />
        <CodeBlock language="json" filename=".cursor/mcp.json">
          {`{
  "mcpServers": {
    "gitdash": { "url": "https://www.gitdash.info/mcp" }
  }
}`}
        </CodeBlock>
        <ProseP>A self-hosted GitDash serves the same endpoint on its own domain.</ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Tools</SubHeading>
        <DocTable
          headers={["Tool", "What it returns"]}
          rows={[
            [<Code key="1">list_docs</Code>, "Every docs page with its id, title, summary and URL."],
            [<Code key="2">search_docs(query)</Code>, "The five best-matching pages, each with an excerpt and URL."],
            [<Code key="3">get_doc(page)</Code>, "One whole page as Markdown, by id."],
            [<Code key="4">explain_metric(metric)</Code>, "What a metric measures, how it is calculated and what good looks like — e.g. lead time, change failure rate, MTTR, bus factor."],
          ]}
        />
        <Callout type="info">
          Try asking: &ldquo;Using GitDash, what does change failure rate measure?&rdquo; or &ldquo;How do I deploy GitDash with
          Helm?&rdquo;
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>Limits</SubHeading>
        <ProseP>
          The endpoint allows 300 requests a minute per IP address on each server instance. Tools only read public
          documentation; your dashboards and GitHub data are not reachable through it.
        </ProseP>
      </DocCard>
    </section>
  );
}
