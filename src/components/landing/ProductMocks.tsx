/**
 * Landing-page product illustrations — drawn with the app's own tokens so
 * they stay crisp at any size and match the product exactly. Every figure is
 * example data and each mock says so in its header.
 */

import { CircleCheck, Sparkles, TriangleAlert } from "lucide-react";
import { Sparkline } from "@/components/ui/Sparkline";

/** Window chrome shared by every mock: title, "Example" tag, content. */
function MockFrame({ title, meta, children, className = "" }: {
  title: string;
  meta?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card !rounded-[16px] overflow-hidden ${className}`} aria-hidden="true">
      <div className="flex items-center justify-between gap-3 px-5 h-11 border-b border-line bg-panel/60">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="w-2.5 h-2.5 rounded-full bg-control-strong" />
            <span className="w-2.5 h-2.5 rounded-full bg-control-strong" />
            <span className="w-2.5 h-2.5 rounded-full bg-control-strong" />
          </span>
          <span className="ml-2 text-[13px] font-semibold text-muted truncate">{title}</span>
        </div>
        <span className="text-xs text-faint shrink-0">{meta ?? "Example"}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Hero: repositories home ────────────────────────────────────────────────

const RUNS_OK = [1, 1, 1, 1, 0, 1, 1, 1, 1, 1];
const RUNS_BAD = [1, 1, 0, 1, 1, 0, 1, 0, 0, 0];
const RUNS_RUN = [1, 1, 1, 1, 1, 1, 1, 1, 1, 2];

function RunStrip({ runs }: { runs: number[] }) {
  return (
    <span className="flex gap-[3px]">
      {runs.map((s, i) => (
        <span key={i} className={`w-[7px] h-3.5 rounded-[2px] ${s === 1 ? "bg-status-pass" : s === 0 ? "bg-status-fail" : "bg-status-run"}`} />
      ))}
    </span>
  );
}

const PILL = {
  pass: "bg-status-pass-tint text-status-pass-text",
  fail: "bg-status-fail-tint text-status-fail-text",
  run: "bg-status-run-tint text-status-run-text",
} as const;

function Pill({ tone, children }: { tone: keyof typeof PILL; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-xs font-semibold ${PILL[tone]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function HeroConsole() {
  const kpis = [
    { l: "Workflow runs", v: "1,284", d: "↑ 12% more", c: "text-muted", s: [4, 5, 5, 6, 5, 7, 6, 8, 7, 9], col: "var(--chart-2)" },
    { l: "Success rate", v: "93.4%", d: "↑ 2.1 pts", c: "text-status-pass-text", s: [88, 90, 89, 91, 90, 92, 91, 93, 92, 93], col: "var(--chart-4)" },
    { l: "p95 duration", v: "8m 12s", d: "↓ 48s faster", c: "text-status-pass-text", s: [11, 10, 10, 9, 10, 9, 9, 8, 9, 8], col: "var(--chart-1)" },
    { l: "p95 queue wait", v: "21s", d: "↑ 6s slower", c: "text-status-warn-text", s: [12, 13, 12, 14, 15, 14, 17, 18, 19, 21], col: "var(--chart-3)" },
  ];
  const rows = [
    { n: "api-service", l: "TypeScript", st: "fail" as const, sl: "Failing", runs: RUNS_BAD, p: "9m 41s", w: 72 },
    { n: "web-app", l: "TypeScript", st: "run" as const, sl: "Running", runs: RUNS_RUN, p: "6m 03s", w: 96 },
    { n: "infra-terraform", l: "HCL", st: "pass" as const, sl: "Passing", runs: RUNS_OK, p: "3m 18s", w: 90 },
  ];
  return (
    <MockFrame title="Repositories · last 7 days">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.l} className="rounded-card border border-line bg-panel px-3.5 py-3">
            <p className="text-xs text-muted">{k.l}</p>
            <p className="mt-1 font-mono text-[20px] font-semibold text-fg">{k.v}</p>
            <div className="mt-1 flex items-end justify-between gap-2">
              <span className={`text-xs font-medium ${k.c}`}>{k.d}</span>
              <Sparkline values={k.s} width={56} height={20} color={k.col} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3 px-3.5 py-3 rounded-card border border-status-fail/25 bg-status-fail-tint">
        <TriangleAlert className="w-4 h-4 text-status-fail-text shrink-0" />
        <p className="text-[13px] text-fg min-w-0 truncate">
          <span className="font-mono font-semibold">api-service</span>
          <span className="text-muted"> · deploy is failing on main · 3 failures in a row</span>
        </p>
        <span className="ml-auto text-xs font-semibold text-link shrink-0">Investigate →</span>
      </div>

      <div className="mt-4 rounded-card border border-line overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1.6fr_1fr_1.2fr_0.8fr] gap-3 px-4 h-9 items-center bg-panel text-xs text-faint border-b border-line">
          <span>Repository</span><span>Status</span><span>Last 10 runs</span><span className="text-right">p95</span>
        </div>
        {rows.map((r) => (
          <div key={r.n} className="grid grid-cols-[1.6fr_1fr] sm:grid-cols-[1.6fr_1fr_1.2fr_0.8fr] gap-3 px-4 h-12 items-center border-b border-line last:border-0">
            <span className="min-w-0">
              <span className="block font-mono text-[13px] font-semibold text-fg truncate">{r.n}</span>
              <span className="block text-xs text-faint">{r.l}</span>
            </span>
            <span><Pill tone={r.st}>{r.sl}</Pill></span>
            <span className="hidden sm:block"><RunStrip runs={r.runs} /></span>
            <span className="hidden sm:block text-right font-mono text-[13px] text-muted">{r.p}</span>
          </div>
        ))}
      </div>
    </MockFrame>
  );
}

// ── DORA ───────────────────────────────────────────────────────────────────

export function DoraMock() {
  const cards = [
    { l: "Deploy frequency", v: "4.2", u: "/ day", r: "Elite", rc: PILL.pass, d: "↑ 0.6 a day", dc: "text-status-pass-text", s: [2, 3, 2.5, 3.4, 3.1, 3.8, 3.6, 4.2], col: "var(--chart-4)" },
    { l: "Lead time", v: "19h", u: "", r: "High", rc: PILL.run, d: "↓ 3h faster", dc: "text-status-pass-text", s: [30, 28, 27, 25, 24, 22, 21, 19], col: "var(--chart-2)" },
    { l: "Change failure", v: "18%", u: "", r: "Medium", rc: "bg-status-warn-tint text-status-warn-text", d: "↑ 7 pts", dc: "text-status-fail-text", s: [9, 10, 11, 12, 14, 13, 16, 18], col: "var(--chart-5)" },
    { l: "Time to restore", v: "2h 10m", u: "", r: "High", rc: PILL.run, d: "↑ 25m slower", dc: "text-status-warn-text", s: [80, 95, 90, 110, 100, 120, 125, 130], col: "var(--chart-3)" },
  ];
  return (
    <MockFrame title="api-service · Delivery performance">
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.l} className="rounded-card border border-line bg-panel p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted truncate">{c.l}</span>
              <span className={`px-1.5 h-5 inline-flex items-center rounded-chip text-[11px] font-semibold ${c.rc}`}>{c.r}</span>
            </div>
            <p className="mt-2 font-mono text-[22px] font-semibold text-fg">{c.v}<span className="text-sm font-normal text-muted"> {c.u}</span></p>
            <Sparkline values={c.s} width={220} height={28} color={c.col} className="mt-1 w-full" />
            <p className={`mt-1 text-xs font-medium ${c.dc}`}>{c.d}</p>
          </div>
        ))}
      </div>
    </MockFrame>
  );
}

// ── Workflow intelligence ─────────────────────────────────────────────────

const DURATIONS = [42, 48, 45, 51, 47, 88, 49, 46, 52, 50, 47, 95, 53, 49, 48, 55, 51, 49, 102, 54, 50, 52, 48, 57, 53, 51, 49, 56];
const FAILED = new Set([5, 11, 18]);

export function WorkflowMock() {
  const max = Math.max(...DURATIONS);
  return (
    <MockFrame title="deploy.yml · Last 28 runs">
      <div className="flex items-end gap-[3px] h-[96px]">
        {DURATIONS.map((d, i) => (
          <span
            key={i}
            className={`flex-1 rounded-t-[2px] ${FAILED.has(i) ? "bg-status-fail" : "bg-chart-1/70"}`}
            style={{ height: `${(d / max) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <div className="rounded-card border border-line bg-panel p-3.5">
          <p className="text-[13px] font-semibold text-fg">Why it&apos;s failing</p>
          <ul className="mt-2.5 space-y-2 text-xs">
            <li className="flex items-start gap-2">
              <span className="px-1.5 h-5 inline-flex items-center rounded-chip font-semibold bg-status-fail-tint text-status-fail-text shrink-0">Likely</span>
              <span className="text-muted leading-5"><span className="font-mono text-fg">migrate-db</span> times out after a schema change</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="px-1.5 h-5 inline-flex items-center rounded-chip font-semibold bg-status-warn-tint text-status-warn-text shrink-0">Possible</span>
              <span className="text-muted leading-5">flaky <span className="font-mono text-fg">e2e</span> on feature branches</span>
            </li>
          </ul>
        </div>
        <div className="rounded-card border border-line bg-panel p-3.5">
          <p className="text-[13px] font-semibold text-fg">Where the time goes</p>
          <ul className="mt-2.5 space-y-2">
            {[
              { j: "build › docker", p: 46, c: "bg-chart-1" },
              { j: "test › e2e", p: 31, c: "bg-chart-2" },
              { j: "deploy › helm", p: 14, c: "bg-chart-3" },
            ].map((j) => (
              <li key={j.j}>
                <div className="flex justify-between text-xs"><span className="font-mono text-muted">{j.j}</span><span className="font-mono text-fg">{j.p}%</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-raised"><div className={`h-full rounded-full ${j.c}`} style={{ width: `${j.p}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </MockFrame>
  );
}

// ── Team insights ─────────────────────────────────────────────────────────

const HEAT = [
  [0, 38, 21, 9, 2],
  [34, 0, 6, 3, 1],
  [12, 4, 0, 1, 0],
  [8, 2, 1, 0, 0],
  [3, 1, 0, 0, 0],
];
const PEOPLE = ["AL", "BK", "CM", "DN", "EO"];

function heat(v: number) {
  if (v === 0) return "bg-heat-0";
  if (v < 5) return "bg-heat-1";
  if (v < 15) return "bg-heat-2";
  if (v < 30) return "bg-heat-3";
  return "bg-heat-4 text-[#14102B]";
}

export function TeamMock() {
  return (
    <MockFrame title="Team insights · last 30 days">
      <div className="space-y-2">
        {[
          { t: "2 people do 72% of reviews", s: "Review bus factor is 2", tone: "text-status-warn-text bg-status-warn-tint" },
          { t: "14% of merges had no human review", s: "Only bots or self-approved", tone: "text-status-fail-text bg-status-fail-tint" },
        ].map((x) => (
          <div key={x.t} className="flex items-center gap-3 rounded-card border border-line bg-panel px-3.5 py-2.5">
            <span className={`w-7 h-7 rounded-control inline-flex items-center justify-center ${x.tone}`}><TriangleAlert className="w-3.5 h-3.5" /></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-fg">{x.t}</span>
              <span className="block text-xs text-faint">{x.s}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">Who reviews whom</p>
      <div className="mt-2 grid grid-cols-[24px_repeat(5,minmax(0,1fr))] gap-1 font-mono text-[11px]">
        <span />
        {PEOPLE.map((p) => <span key={p} className="text-center text-faint">{p}</span>)}
        {HEAT.map((row, r) => (
          <div key={r} className="contents">
            <span className="text-faint self-center">{PEOPLE[r]}</span>
            {row.map((v, c) => (
              <span key={c} className={`h-7 rounded-[4px] inline-flex items-center justify-center ${heat(v)} ${v > 0 && v < 30 ? "text-fg" : ""}`}>
                {v > 0 ? v : ""}
              </span>
            ))}
          </div>
        ))}
      </div>
    </MockFrame>
  );
}

// ── Cost ──────────────────────────────────────────────────────────────────

const SPEND = [
  [30, 8, 4], [34, 10, 3], [28, 6, 5], [40, 14, 4], [36, 12, 6], [12, 3, 1], [10, 2, 1],
  [38, 11, 5], [42, 15, 4], [39, 12, 6], [44, 16, 5], [41, 13, 4], [14, 4, 2], [11, 3, 1],
  [40, 12, 5], [45, 17, 6], [43, 14, 5], [38, 12, 4], [46, 18, 6], [15, 4, 1], [12, 3, 1],
];

export function CostMock() {
  const total = (d: number[]) => d[0] + d[1] + d[2];
  const max = Math.max(...SPEND.map(total));
  return (
    <MockFrame title="Cost · this month">
      <div className="grid grid-cols-3 gap-3">
        {[
          { l: "Billed so far", v: "$1,284", c: "text-fg" },
          { l: "Month-end", v: "$1,427", c: "text-status-warn-text" },
          { l: "Daily burn", v: "$47.58", c: "text-fg" },
        ].map((k) => (
          <div key={k.l} className="rounded-card border border-line bg-panel px-3 py-2.5">
            <p className="text-xs text-muted">{k.l}</p>
            <p className={`mt-1 font-mono text-[18px] font-semibold ${k.c}`}>{k.v}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-end gap-[3px] h-[88px]">
        {SPEND.map((d, i) => (
          <span key={i} className="flex-1 flex flex-col-reverse rounded-t-[2px] overflow-hidden" style={{ height: `${(total(d) / max) * 100}%` }}>
            <span className="bg-chart-2" style={{ flexGrow: d[0] }} />
            <span className="bg-chart-1" style={{ flexGrow: d[1] }} />
            <span className="bg-chart-3" style={{ flexGrow: d[2] }} />
          </span>
        ))}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <span key={`p${i}`} className="flex-1 rounded-t-[2px] bg-chart-2/15 border border-dashed border-chart-2/30" style={{ height: `${i % 7 > 4 ? 25 : 78}%` }} />
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] bg-chart-2" />Linux</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] bg-chart-1" />macOS</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] bg-chart-3" />Windows</span>
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-card border border-status-pass/25 bg-status-pass-tint px-3.5 py-2.5">
        <CircleCheck className="w-4 h-4 text-status-pass-text shrink-0" />
        <span className="text-[13px] text-fg">Move <span className="font-mono">ios-build</span> off macOS runners</span>
        <span className="ml-auto font-mono text-[13px] font-semibold text-status-pass-text shrink-0">−$180/mo</span>
      </div>
    </MockFrame>
  );
}

// ── Alerts ────────────────────────────────────────────────────────────────

export function AlertsMock() {
  return (
    <MockFrame title="Alerts · new rule">
      <div className="rounded-card border border-line bg-panel p-4">
        <p className="text-[13px] leading-6 text-fg">
          Alert me when the <span className="px-1.5 py-0.5 rounded-chip bg-brand-soft text-link font-medium">failure rate</span> on{" "}
          <span className="px-1.5 py-0.5 rounded-chip bg-brand-soft text-link font-mono">api-service</span> goes above{" "}
          <span className="px-1.5 py-0.5 rounded-chip bg-brand-soft text-link font-mono">20%</span> within{" "}
          <span className="px-1.5 py-0.5 rounded-chip bg-brand-soft text-link font-mono">24 hours</span>.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Slack", "Email", "Browser", "Daily digest"].map((c, i) => (
            <span key={c} className={`h-7 px-2.5 inline-flex items-center rounded-full border text-xs font-medium ${i < 2 ? "border-brand-fg/40 bg-brand-soft text-fg" : "border-control text-muted"}`}>{c}</span>
          ))}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">Firing now</p>
      <ul className="mt-2 space-y-2">
        {[
          { t: "Failure rate is 33% on api-service", s: "firing for 18 min", c: "bg-status-fail" },
          { t: "p95 duration is 14.2 min on web-app", s: "firing for 2 h", c: "bg-status-warn" },
        ].map((a) => (
          <li key={a.t} className="flex items-center gap-3 rounded-card border border-line bg-panel px-3.5 py-2.5">
            <span className={`w-2 h-2 rounded-full ${a.c} shrink-0`} />
            <span className="min-w-0">
              <span className="block text-[13px] text-fg truncate">{a.t}</span>
              <span className="block text-xs text-faint">{a.s}</span>
            </span>
            <span className="ml-auto h-7 px-2.5 inline-flex items-center rounded-control border border-control text-xs text-muted shrink-0">Mute 1h</span>
          </li>
        ))}
      </ul>
    </MockFrame>
  );
}

// ── AI summary chip (used in the hero) ──────────────────────────────────────

export function AiSummaryCard() {
  return (
    <div className="float-card px-4 py-3.5 w-[320px]" aria-hidden="true">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-control inline-flex items-center justify-center bg-brand-soft text-brand-fg"><Sparkles className="w-3.5 h-3.5" /></span>
        <span className="text-[13px] font-semibold text-fg">AI summary</span>
        <span className="ml-auto text-xs text-faint">Example</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">
        Failures cluster in <span className="font-mono text-fg">migrate-db</span> since Tuesday&apos;s schema change; the rest of the pipeline is 8% faster.
      </p>
    </div>
  );
}
