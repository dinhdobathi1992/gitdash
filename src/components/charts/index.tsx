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
  ResponsiveContainer,
} from "recharts";
