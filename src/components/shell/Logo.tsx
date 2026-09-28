/** GitDash mark — four rising bars on a dark tile (design `Sidebar` artboard). */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      aria-hidden="true"
      className={className}
      style={{ filter: "drop-shadow(0 0 8px rgba(164,139,255,0.45))" }}
    >
      <rect x="0" y="0" width="28" height="28" rx="7" fill="#161B23" />
      <rect x="6" y="15" width="3" height="7" rx="1" fill="#4FD1E8" />
      <rect x="10.5" y="12" width="3" height="10" rx="1" fill="#74B6F4" />
      <rect x="15" y="9" width="3" height="13" rx="1" fill="#8E9BFA" />
      <rect x="19.5" y="6" width="3" height="16" rx="1" fill="#A48BFF" />
    </svg>
  );
}

/** Full app version, e.g. "4.5.1" — injected from package.json at build time (next.config.ts). */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "4.5.2";
