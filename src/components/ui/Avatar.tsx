/** Round avatar: the GitHub image when known, else initials on the raised surface. */

export function initials(name: string): string {
  const parts = name.replace(/\[bot\]$/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

export function Avatar({ login, src, size = 32, dim }: { login: string; src?: string; size?: number; dim?: boolean }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className={`rounded-full shrink-0 bg-raised${dim ? " opacity-60" : ""}`} style={{ width: size, height: size }} />;
  }
  return (
    <span
      className={`flex items-center justify-center rounded-full bg-raised font-semibold shrink-0 ${dim ? "text-faint" : "text-fg"}`}
      style={{ width: size, height: size, fontSize: size <= 24 ? 10 : 12 }}
      aria-hidden="true"
    >
      {initials(login)}
    </span>
  );
}
