import { ImageResponse } from "next/og";

/** Social card size (Open Graph and X large image). */
export const OG_SIZE = { width: 1200, height: 630 };

/** Brand bars, as in the logo mark (components/shell/Logo.tsx). */
const BARS = [
  { h: 70, c: "#4FD1E8" },
  { h: 100, c: "#74B6F4" },
  { h: 130, c: "#8E9BFA" },
  { h: 160, c: "#A48BFF" },
];

/**
 * GitDash social card: graphite ground, the four-bar mark, a title and one
 * line of context. Used for the site-wide card and per docs page.
 */
export function ogCard({ eyebrow, title, accent, subtitle }: { eyebrow: string; title: string; accent?: string; subtitle: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "radial-gradient(circle at 85% 20%, rgba(124,92,255,0.28), transparent 55%), #0B0E13",
          color: "#EDEBE6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, width: 76, height: 76, padding: 14, borderRadius: 18, background: "#161B23" }}>
            {BARS.map((b) => (
              <div key={b.c} style={{ width: 9, height: (b.h / 160) * 46, borderRadius: 3, background: b.c }} />
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>GitDash</div>
          <div style={{ display: "flex", marginLeft: 12, fontSize: 26, color: "#A48BFF" }}>{eyebrow}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: title.length > 28 ? 72 : 92, fontWeight: 700, letterSpacing: -3, lineHeight: 1.02 }}>
            {title}
            {accent ? <span style={{ color: "#A48BFF", marginLeft: 22 }}>{accent}</span> : null}
          </div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 32, color: "#A3A9B4", maxWidth: 980 }}>{subtitle}</div>
        </div>

        <div style={{ display: "flex", fontSize: 24, color: "#6E7581" }}>Open source · MIT · Self-hosted</div>
      </div>
    ),
    OG_SIZE,
  );
}

/** Site-wide card: the landing page and anything without its own card. */
export const BRAND_CARD_ALT = "GitDash — Everything metrics, measured. DORA, reliability, cost and team health from GitHub Actions.";

export function brandCard() {
  return ogCard({
    eyebrow: "GitHub Actions analytics",
    title: "Everything metrics,",
    accent: "measured.",
    subtitle: "DORA, reliability, cost and team health from your GitHub Actions runs and pull requests.",
  });
}
