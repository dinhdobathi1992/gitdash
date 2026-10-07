"use client";

import { Plug } from "lucide-react";
import { Callout } from "@/components/docs/Callout";
import { CodeBlock, Code } from "@/components/docs/CodeBlock";
import { DocCard, DocTable } from "@/components/docs/DocCard";
import { SectionHeading, SubHeading, ProseP, ScreenshotSlot } from "./primitives";

export function McpServer() {
  return (
    <section id="mcp" className="scroll-mt-20 space-y-6">
      <SectionHeading id="mcp" icon={Plug}>MCP server</SectionHeading>

      <ProseP>
        GitDash speaks the Model Context Protocol, so an AI assistant can use it while it helps you. There are two
        endpoints on every GitDash host, and both are read-only:
      </ProseP>

      <DocCard>
        <DocTable
          headers={["Endpoint", "Sign-in", "What it gives the assistant"]}
          rows={[
            [<Code key="1">/mcp</Code>, "None", "The public documentation: setup, configuration, access control and what every metric means."],
            [<Code key="2">/mcp/me</Code>, "GitHub, through GitDash, or a personal MCP key", "The same documentation tools, plus seven data tools that read your repositories, pull requests and costs as you. Only on instances that turn it on (see below)."],
          ]}
        />
      </DocCard>

      <DocCard>
        <SubHeading>Connect to the docs (/mcp)</SubHeading>
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
        <SubHeading>Docs tools</SubHeading>
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
        <SubHeading>Connect with your data (/mcp/me)</SubHeading>
        <ProseP>
          Use <Code>https://&lt;your GitDash host&gt;/mcp/me</Code>, for example in Claude: Settings → Connectors → Add
          custom connector. The client discovers the sign-in on its own. In Claude Code:
        </ProseP>
        <CodeBlock language="bash">
          {`claude mcp add --transport http gitdash https://<your GitDash host>/mcp/me`}
        </CodeBlock>
        <ProseP>The first time the assistant uses it, this happens:</ProseP>
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-slate-300">
          <li>
            The assistant opens GitDash in your browser. If you are not signed in, GitHub asks you to sign in. This
            sign-in asks GitHub only for <Code>repo</Code>, <Code>read:org</Code> and <Code>read:user</Code>, fewer
            scopes than the web sign-in. If you are already signed in to GitDash with GitHub, the app gets your existing
            web sign-in, with its scopes.
          </li>
          <li>GitDash shows which app is asking, and where it will send you back. Check the host, then choose Allow.</li>
          <li>The app receives an encrypted token and calls the tools. You never paste a token.</li>
        </ol>
        <Callout type="warning">
          The token holds your GitHub token, sealed so that the app cannot read it; only GitDash can open it. The app
          can do what the tools below do, as you: it sees what you see, never more. GitDash lasts the token for up to 30
          days and drops it after 14 days without use.
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>Connect with a personal key</SubHeading>
        <ProseP>
          Signed in to GitDash with a personal access token, running GitDash in standalone mode, or using a client
          without the sign-in flow? Create a personal MCP key and send it as a header instead. Claude Code, Cursor and
          Claude Desktop&apos;s config file accept it; the claude.ai connector screen supports only the sign-in above.
        </ProseP>
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-slate-300">
          <li>Open Settings → Connected apps and choose Create MCP key.</li>
          <li>Give it a label, such as &ldquo;Claude Code on my laptop&rdquo;, and choose Create key.</li>
          <li>Copy the key, or one of the ready-made snippets, straight away. GitDash shows it only once.</li>
        </ol>
        <CodeBlock language="bash">
          {`claude mcp add --transport http gitdash https://<your GitDash host>/mcp/me --header "Authorization: Bearer <key>"`}
        </CodeBlock>
        <CodeBlock language="json" filename=".cursor/mcp.json">
          {`{
  "mcpServers": {
    "gitdash": {
      "url": "https://<your GitDash host>/mcp/me",
      "headers": { "Authorization": "Bearer <key>" }
    }
  }
}`}
        </CodeBlock>
        <ProseP>
          Once connected, ask in plain words. Below, Cursor&apos;s agent lists the GitDash tools, checks open pull-request
          health and reads a repository&apos;s DORA keys:
        </ProseP>
        <ScreenshotSlot
          file="mcp-cursor-agent.png"
          alt="Cursor agent using the gitdash MCP server: it lists the 11 tools, checks open pull-request health, and shows the DORA four keys for dinhdobathi1992/gitdash with an overall rating of medium"
        />
        <Callout type="warning">
          Treat a key like a password: it contains your GitHub access. It holds an encrypted copy of the token you
          signed in to GitDash with (your personal access token or your GitHub sign-in), so it can read what that token
          can, through the same read-only tools and the same group checks. A key expires after 30 days; you can create
          up to 5 an hour and hold up to 10 at once. For keys, sign in with a fine-grained, read-only personal access token limited to the
          repositories you need.
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>Data tools</SubHeading>
        <ProseP>
          Every tool is read-only and runs with your own GitHub access. Each one is checked against the same groups and
          feature grants as the matching screen, so a tool your group does not have answers with an error.
        </ProseP>
        <DocTable
          headers={["Tool", "What it returns"]}
          rows={[
            [<Code key="1">list_repos(owner?)</Code>, "Repositories you can see: name, language, visibility, and for the most recently updated ones the last run and the success rate of the last 10."],
            [<Code key="2">repo_overview(owner, repo)</Code>, "Workflow runs, success rate, p95 duration and the most-failing workflows of one repository."],
            [<Code key="3">repo_dora(owner, repo)</Code>, "The four DORA keys with their ratings and how each is measured."],
            [<Code key="4">failing_workflows(owner?)</Code>, "Repositories whose newest decisive run failed, worst success rate first."],
            [<Code key="5">open_pr_health(owner, repo)</Code>, "Open pull requests: age buckets, stale and unreviewed counts, review speed, the oldest PRs."],
            [<Code key="6">org_health(org)</Code>, "Ranked health scorecard for up to 10 repositories of an organization."],
            [<Code key="7">actions_cost(org, year?, month?)</Code>, "GitHub Actions minutes and USD by runner and repository for a month, with the month-end projection."],
          ]}
        />
        <Callout type="info">
          Try asking: &ldquo;Which of our workflows are failing right now?&rdquo; or &ldquo;Which pull requests in acme/web
          have waited longest for a review?&rdquo;
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>Revoke an app or a key</SubHeading>
        <ProseP>
          Open Settings → Connected apps. Each app row shows the host the app returns to, the name it
          gives itself, when it connected and when it was last used; each key row shows &ldquo;Personal key&rdquo;, its
          label, when it was created, last used and when it expires. Choose Revoke and confirm. GitDash stops accepting
          that app&apos;s token or that key within a minute. Admins see every user&apos;s apps under Admin → Connected apps and can revoke
          any of them. Apps can also revoke their own token, and anyone holding a personal key can revoke it, at{" "}
          <Code>/oauth/revoke</Code> (RFC 7009, organization mode).
        </ProseP>
        <ProseP>
          Revoking in GitDash does not touch GitHub. To cut GitHub access as well, revoke GitDash in{" "}
          <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer" className="text-link hover:text-violet-200">
            GitHub → Settings → Applications
          </a>
          ; GitDash then drops the grant the next time the app calls it. If a key leaks and you created it while signed
          in with a personal access token, revoke the key and also rotate that token on GitHub.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Turn it on (operators)</SubHeading>
        <ProseP>
          <Code>/mcp/me</Code>, the sign-in endpoints and the Connected apps screens are off by default and answer 404.
          Set <Code>GITDASH_MCP=true</Code> (Helm: <Code>config.mcp: true</Code>) with <Code>MODE=organization</Code>, a
          database and <Code>NEXT_PUBLIC_APP_URL</Code>, and add the second GitHub callback URL{" "}
          <Code>&lt;origin&gt;/api/auth/callback/mcp</Code> to your OAuth App. The Configuration page lists every
          variable. The public <Code>/mcp</Code> endpoint needs none of this.
        </ProseP>
        <ProseP>
          Standalone mode has no GitHub OAuth App, so it has no sign-in flow: with <Code>GITDASH_MCP=true</Code>,{" "}
          <Code>DATABASE_URL</Code> and <Code>NEXT_PUBLIC_APP_URL</Code> set, <Code>/mcp/me</Code> accepts personal keys
          only and the <Code>/oauth</Code> endpoints stay off. Without a database, creating a key answers 409: a key is
          only issued when it can be revoked.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Limits</SubHeading>
        <ProseP>
          <Code>/mcp</Code> allows 300 requests a minute per IP address on each server instance. <Code>/mcp/me</Code>{" "}
          allows 60 a minute per connected app or key. The docs tools only read public documentation; your dashboards and
          GitHub data are reachable only through <Code>/mcp/me</Code>, after you sign in.
        </ProseP>
      </DocCard>
    </section>
  );
}
