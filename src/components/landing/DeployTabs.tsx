"use client";

/** Landing-page install snippets — one tab per supported deployment target. */

import { useState } from "react";
import { Check, Copy } from "lucide-react";

const TARGETS = [
  {
    id: "docker",
    label: "Docker",
    note: "Multi-arch image (amd64, arm64) on Docker Hub.",
    code: "docker run -d -p 3000:3000 \\\n  -e MODE=standalone \\\n  -e SESSION_SECRET=$(openssl rand -hex 32) \\\n  dinhdobathi/gitdash:latest",
  },
  {
    id: "helm",
    label: "Kubernetes",
    note: "Helm chart in the repository, ready for organization mode.",
    code: "helm upgrade --install gitdash ./helm/gitdash \\\n  -n gitdash --create-namespace \\\n  -f my-values.yaml",
  },
  {
    id: "source",
    label: "From source",
    note: "Node.js 20+ and pnpm. Opens /setup to paste a token.",
    code: "git clone https://github.com/dinhdobathi1992/gitdash.git\ncd gitdash && pnpm install --frozen-lockfile\ncp .env.local.example .env.local\npnpm run dev",
  },
  {
    id: "vercel",
    label: "Vercel",
    note: "Import the repository in Vercel and set these variables; vercel.json schedules the nightly sync.",
    code: "MODE=standalone            # or organization\nSESSION_SECRET=<32+ random characters>\n# organization mode also needs:\nDATABASE_URL=postgres://...\nGITDASH_ADMIN_GITHUB_IDS=12345678\nGITHUB_CLIENT_ID=...  GITHUB_CLIENT_SECRET=...",
  },
] as const;

export function DeployTabs() {
  const [active, setActive] = useState<(typeof TARGETS)[number]["id"]>("docker");
  const [copied, setCopied] = useState(false);
  const target = TARGETS.find((t) => t.id === active) ?? TARGETS[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(target.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the text stays selectable.
    }
  };

  return (
    <div className="float-card overflow-hidden">
      <div role="tablist" aria-label="Deployment target" className="flex gap-1 px-2 pt-2 border-b border-line overflow-x-auto">
        {TARGETS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            onClick={() => { setActive(t.id); setCopied(false); }}
            className={`relative h-10 px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-100 ${
              t.id === active ? "text-fg" : "text-muted hover:text-fg"
            }`}
          >
            {t.label}
            {t.id === active && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand-fg" />}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="p-5">
        <div className="flex items-start justify-between gap-4">
          <p className="text-[13px] text-muted">{target.note}</p>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-control border border-control bg-surface text-xs font-medium text-muted hover:text-fg shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-status-pass-text" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="mt-4 p-4 rounded-card bg-ground border border-line overflow-x-auto font-mono text-[13px] leading-6 text-fg">
          <code>{target.code}</code>
        </pre>
      </div>
    </div>
  );
}
