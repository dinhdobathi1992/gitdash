"use client";

import { Download } from "lucide-react";
import { useState } from "react";

/**
 * Formula-injection guard per OWASP CSV Injection mitigation.
 * Cells starting with =, +, -, @, \t, or \r are prefixed with ' so
 * spreadsheet apps render them as literal text.
 */
function sanitizeCsvCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function toCsvRow(record: Record<string, string | number>): string {
  return Object.values(record)
    .map((v) => {
      const str = String(v ?? "");
      const sanitized = sanitizeCsvCell(str);
      // Standard CSV escaping: wrap in quotes if contains comma, double-quote, or newline
      if (/[,"\n\r]/.test(sanitized)) {
        return `"${sanitized.replace(/"/g, '""')}"`;
      }
      return sanitized;
    })
    .join(",");
}

function toCsv(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]).join(",");
  const body = rows.map(toCsvRow).join("\n");
  return `${headers}\n${body}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface ExportButtonProps {
  data: unknown;
  filenameBase: string;
  /** If provided, also offer CSV export. Each call should return the flattened rows. */
  csvRows?: () => Record<string, string | number>[];
  className?: string;
}

export function ExportButton({ data, filenameBase, csvRows, className }: ExportButtonProps) {
  const [open, setOpen] = useState(false);

  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${filenameBase}.json`);
    setOpen(false);
  }

  function exportCsv() {
    if (!csvRows) return;
    const rows = csvRows();
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `${filenameBase}.csv`);
    setOpen(false);
  }

  if (!data) return null;

  return (
    <div className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
          <button
            type="button"
            onClick={exportJson}
            className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            JSON
          </button>
          {csvRows && (
            <button
              type="button"
              onClick={exportCsv}
              className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors border-t border-slate-700"
            >
              CSV
            </button>
          )}
        </div>
      )}
    </div>
  );
}
