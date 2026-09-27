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
  /** Button text; defaults to "Export". */
  label?: string;
  /** Skip the JSON/CSV menu and download CSV directly. */
  csvOnly?: boolean;
}

export function ExportButton({ data, filenameBase, csvRows, className, label = "Export", csvOnly }: ExportButtonProps) {
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

  const trigger = "inline-flex items-center gap-2 h-9 px-3.5 rounded-control bg-surface border border-control text-[13px] font-semibold text-fg hover:bg-raised transition-colors duration-100";

  if (csvOnly && csvRows) {
    return (
      <button type="button" onClick={exportCsv} className={`${trigger} ${className ?? ""}`}>
        <Download className="w-4 h-4 text-muted" aria-hidden="true" />
        {label}
      </button>
    );
  }

  return (
    <div className={`relative inline-block ${className ?? ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={trigger}>
        <Download className="w-4 h-4 text-muted" aria-hidden="true" />
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[128px] float-card py-1 overflow-hidden">
          <button type="button" onClick={exportJson} className="w-full text-left px-3 h-9 text-[13px] text-muted hover:bg-raised hover:text-fg">
            JSON
          </button>
          {csvRows && (
            <button type="button" onClick={exportCsv} className="w-full text-left px-3 h-9 text-[13px] text-muted hover:bg-raised hover:text-fg">
              CSV
            </button>
          )}
        </div>
      )}
    </div>
  );
}
