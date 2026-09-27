import { cn } from "@/lib/utils";

export function DocCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6 space-y-4", className)}>
      {children}
    </div>
  );
}

export function FeatureGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {children}
    </div>
  );
}

export function FeatureCard({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-800/30 border border-slate-700/40 rounded-xl p-5 space-y-2 hover:border-violet-500/30 hover:bg-slate-800/50 transition-colors">
      <div className="text-2xl">{icon}</div>
      <h3 className="font-semibold text-white text-sm">{title}</h3>
      <p className="text-sm text-slate-400 leading-relaxed">{children}</p>
    </div>
  );
}

export function DocTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (React.ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700/50 bg-slate-800/60">
            {headers.map((h) => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/20 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-slate-300 align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
