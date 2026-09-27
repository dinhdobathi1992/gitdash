/**
 * Single re-export point for every Recharts primitive used across the app.
 *
 * Before this file, 7 modules imported directly from "recharts", and
 * Turbopack emitted two separate ~388 KB chunks containing near-identical
 * Recharts code (measured: home → repo → workflow-detail downloaded
 * Recharts twice, ~224 KB gzip wasted). Routing every import through this
 * one module lets the bundler share a single chunk across all chart
 * consumers instead of duplicating it per route group.
 *
 * Import from here, not "recharts", in any new chart code.
 */
export {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";

// ── Chart theme (design contract §6) ──────────────────────────────────────────
// Set colours, fonts and grid here, not per chart. Spread these into the
// matching Recharts element: <XAxis {...AXIS_PROPS} />, <CartesianGrid {...GRID_PROPS} />.

/** Categorical series, in order. Index 7 is "other". */
export const SERIES_COLORS = [
  "#A48BFF", "#4FD1E8", "#F5B544", "#3DD68C", "#FF6B6B", "#74B6F4", "#8E9BFA", "#A3A9B4",
] as const;

/** Outcome colours for graphics (dots, bars, lines). */
export const OUTCOME_COLORS = {
  success: "#3DD68C",
  failure: "#FF6B6B",
  warning: "#F5B544",
  running: "#4FD1E8",
  cancelled: "#626A77",
} as const;

export const HEAT_RAMP = ["#1A1F27", "#2E2660", "#4B3B99", "#7C5CFF", "#B9A6FF"] as const;

/** Area fill opacity under lines. */
export const AREA_OPACITY = 0.12;

/** Axes: mono 11 px faint, no axis or tick lines. */
export const AXIS_PROPS = {
  tick: { fill: "#7A818D", fontSize: 11, fontFamily: "var(--font-mono)" },
  axisLine: false,
  tickLine: false,
} as const;

export const GRID_PROPS = {
  stroke: "#1E242D",
  strokeDasharray: "0",
  vertical: false,
} as const;

/** Tooltip: float-card look. */
export const TOOLTIP_PROPS = {
  contentStyle: {
    background: "#1B212B",
    border: "1px solid #232A34",
    borderRadius: 10,
    boxShadow: "0 24px 48px -16px rgba(0,0,0,0.85)",
    color: "#EDEAE3",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
  },
  labelStyle: { color: "#A3A9B4", marginBottom: 4 },
  itemStyle: { color: "#EDEAE3" },
  cursor: { fill: "rgba(164,139,255,0.06)", stroke: "#2A313C" },
} as const;

/** Dashed reference line, labelled in mono 11 px violet. */
export const REFERENCE_PROPS = {
  stroke: "#4B3B99",
  strokeDasharray: "4 4",
} as const;

export const REFERENCE_LABEL_STYLE = {
  fill: "#A48BFF",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
} as const;
