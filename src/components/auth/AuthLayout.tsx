"use client";

/**
 * Sign-in layout — `Login` artboard. Hero (logo + version, headline,
 * summary, feature chips, product preview) beside a sign-in card.
 * The preview is an illustration with example figures, labelled as such.
 */

import { BarChart3, Bell, ShieldCheck, CircleCheck } from "lucide-react";
import { LogoMark, APP_VERSION, shortVersion } from "@/components/shell/Logo";
import { Sparkline } from "@/components/ui/Sparkline";
import { DemoVideoDialog } from "@/components/auth/DemoVideoDialog";

const P95 = [8.2, 8.6, 8.1, 9.4, 9.1, 10.2, 9.8, 11.1, 10.6, 12.2, 11.4, 12.9, 12.3, 14.2, 13.8];
const P50 = [4.1, 4.3, 4.0, 4.6, 4.5, 4.9, 4.7, 5.2, 5.0, 5.5, 5.3, 5.6, 5.4, 5.9, 5.8];

function ProductPreview() {
  return (
    <figure aria-label="Example of the delivery performance view" className="relative mt-10 hidden md:block">
      <div className="absolute -top-6 -left-4 z-10 flex items-center gap-3 px-4 py-3 float-card w-[300px]">
        <span className="flex items-center justify-center w-8 h-8 rounded-control bg-status-pass-tint text-status-pass-text"><CircleCheck className="w-4 h-4" aria-hidden="true" /></span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-fg">deploy recovered</span>
          <span className="block font-mono text-xs text-muted">example-service · 2 min ago</span>
        </span>
      </div>
      <div className="ml-14 card !rounded-[16px] p-6 pt-8 w-[680px] max-w-full" aria-hidden="true">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-muted">Delivery performance</span>
          <span className="text-xs text-faint">Example · 30 days</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { l: "Deploy frequency", v: "4.2", u: "/day", r: "Elite", c: "text-status-pass-text" },
            { l: "Lead time", v: "19h", u: "", r: "High", c: "text-status-run-text" },
            { l: "Success rate", v: "93.4%", u: "", r: null, c: "" },
          ].map((k) => (
            <div key={k.l} className="rounded-card border border-line bg-panel px-4 py-3.5">
              <p className="text-xs text-muted">{k.l}</p>
              <p className="mt-1 font-mono text-[22px] font-semibold text-fg">{k.v}<span className="text-sm text-muted font-normal"> {k.u}</span></p>
              {k.r ? <p className={`mt-1 text-xs font-semibold ${k.c}`}>{k.r}</p> : (
                <p className="mt-2 flex gap-[3px]">{[1, 1, 1, 0, 1, 1, 1, 1, 1, 2].map((s, i) => <span key={i} className={`w-2 h-3.5 rounded-[2px] ${s === 1 ? "bg-status-pass" : s === 0 ? "bg-status-fail" : "bg-status-run"}`} />)}</p>
              )}
            </div>
          ))}
        </div>
        <div className="relative mt-5 h-[120px]">
          <Sparkline values={P95} width={632} height={120} color="var(--chart-1)" className="absolute inset-0 w-full h-full" />
          <Sparkline values={P50.map((v) => v + 4)} width={632} height={120} color="var(--chart-2)" fill={false} className="absolute inset-0 w-full h-full" />
        </div>
      </div>
    </figure>
  );
}

/** Sign-in atmosphere: two faint radial lights and a fading dot grid. Shared with /pending. */
export function AuthBackdrop() {
  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(900px 600px at 12% 0%, rgba(79,209,232,0.10), transparent 60%), radial-gradient(900px 700px at 85% 55%, rgba(124,92,255,0.16), transparent 60%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "24px 24px", maskImage: "linear-gradient(90deg, black, transparent 60%)" }}
      />
    </>
  );
}

export function AuthLayout({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ground overflow-hidden relative">
      <AuthBackdrop />
      <div className="relative mx-auto max-w-[1360px] px-5 sm:px-10 lg:px-[72px] py-10 lg:py-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_420px] items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <LogoMark size={36} />
            <span className="text-lg font-semibold text-fg">GitDash</span>
            <span className="h-6 inline-flex items-center px-2 rounded-full border border-control bg-surface font-mono text-xs text-muted">{shortVersion()}</span>
          </div>
          <h1 className="mt-14 lg:mt-24 text-[44px] sm:text-[56px] lg:text-[68px] leading-[1] font-semibold tracking-[-0.045em] text-fg">
            Everything metrics,<br />
            <span className="text-link">measured.</span>
          </h1>
          <p className="mt-7 max-w-[470px] text-lg leading-7 text-muted">
            DORA, reliability, cost and team health from your GitHub Actions runs and pull requests — on infrastructure you run yourself.
          </p>
          <ul className="mt-7 flex flex-wrap gap-3">
            {[
              { i: BarChart3, t: "DORA per repo and org", c: "text-accent" },
              { i: Bell, t: "Alerts that explain themselves", c: "text-status-warn-text" },
              { i: ShieldCheck, t: "Self-hosted", c: "text-status-pass-text" },
            ].map(({ i: Icon, t, c }) => (
              <li key={t} className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full border border-control bg-surface/80 text-[13px] text-fg">
                <Icon className={`w-4 h-4 ${c}`} aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
          <ProductPreview />
        </div>

        <div className="lg:mt-[120px]">
          <div className="card !rounded-panel p-8 sm:p-9 shadow-float">{children}</div>
          <div className="mt-6 flex items-center justify-between px-2 text-[13px]">
            {footer ?? (
              <DemoVideoDialog />
            )}
            <span className="text-muted">Self-hosted · v{APP_VERSION}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
