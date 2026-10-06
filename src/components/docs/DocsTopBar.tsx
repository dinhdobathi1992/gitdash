import Link from "next/link";
import { LogoMark } from "@/components/shell/Logo";

const REPO_URL = "https://github.com/dinhdobathi1992/gitdash";
const LINK = "hidden sm:inline-flex h-9 px-3 items-center whitespace-nowrap rounded-control text-[13px] text-muted hover:text-fg hover:bg-surface";

/**
 * Header for the public docs. Docs render outside the app shell, so a
 * signed-out reader sees only links that work for them. "Open GitDash" goes to
 * "/": the dashboard when signed in, the landing or sign-in page otherwise.
 */
export function DocsTopBar() {
  return (
    <header className="border-b border-line bg-ground">
      <div className="h-14 px-4 sm:px-6 flex items-center gap-2">
        <Link href="/" className="flex items-center gap-2.5 shrink-0 mr-3">
          <LogoMark size={26} />
          <span className="text-[15px] font-semibold text-fg">GitDash</span>
        </Link>
        <nav aria-label="Docs" className="flex items-center gap-1">
          <Link href="/docs" className={LINK}>Docs</Link>
          <Link href="/docs/playground" className={LINK}>API playground</Link>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={LINK}>GitHub</a>
        </nav>
        <Link
          href="/"
          className="ml-auto h-9 px-3.5 inline-flex items-center whitespace-nowrap rounded-control bg-primary text-white text-[13px] font-semibold hover:brightness-110"
        >
          Open GitDash
        </Link>
      </div>
    </header>
  );
}
