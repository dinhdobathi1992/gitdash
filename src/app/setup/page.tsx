"use client";

/** Standalone sign-in with a personal access token — `Login` artboard layout. */

import { ExternalLink } from "lucide-react";
import { PatForm } from "@/components/PatForm";
import { AuthLayout } from "@/components/auth/AuthLayout";

const SCOPES: [string, string][] = [
  ["repo", "Read repositories and workflow runs"],
  ["workflow", "Read workflow definitions"],
  ["read:org", "Read org membership and repositories"],
  ["read:user, user:email", "Read your identity"],
];

export default function SetupPage() {
  return (
    <AuthLayout>
      <p className="text-[13px] font-semibold text-link">Standalone mode</p>
      <h2 className="mt-2 text-[28px] leading-[34px] font-semibold tracking-[-0.02em] text-fg">Connect GitHub</h2>
      <p className="mt-3 mb-6 text-sm leading-[22px] text-muted">
        Paste a personal access token. It is kept in an encrypted session cookie and never sent to a third party.
      </p>

      <PatForm primary>
        <ul className="flex flex-col gap-1.5 text-xs text-muted">
          {SCOPES.map(([scope, desc]) => (
            <li key={scope} className="flex gap-2">
              <code className="font-mono text-fg shrink-0">{scope}</code>
              <span>{desc}</span>
            </li>
          ))}
        </ul>
      </PatForm>

      <div className="mt-6 pt-5 border-t border-line flex flex-col gap-3 text-xs leading-[18px] text-muted">
        <p>
          Cost needs a separate <span className="text-fg">fine-grained</span> token with the <code className="font-mono text-fg">Administration</code> organization
          permission (read). Classic tokens don&apos;t work with the Enhanced Billing API.
        </p>
        <p>Every GitHub call is made on the server with your token; the raw value never reaches the browser, a log or the disk.</p>
        <div className="flex flex-wrap gap-4 text-[13px] font-medium">
          <a
            href="https://github.com/settings/tokens/new?scopes=repo,workflow,read:org,read:user,user:email"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-link hover:text-violet-200"
          >
            Create a token <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
          <a
            href="https://github.com/dinhdobathi1992/gitdash?tab=readme-ov-file#-your-pat-is-yours--we-protect-it-like-its-gold"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted hover:text-fg"
          >
            Token security policy <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </AuthLayout>
  );
}
