import type { RichText as Rich } from "@/lib/team-insights";

/** Engine copy with logins and refs in the mono face. */
export function RichText({ parts, monoClass = "font-mono text-fg" }: { parts: Rich; monoClass?: string }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <span key={i} className={monoClass}>{p.mono}</span>))}
    </>
  );
}
