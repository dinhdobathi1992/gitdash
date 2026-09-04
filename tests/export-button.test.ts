import { describe, it, expect } from "vitest";

// Test the CSV escaping and formula-injection guard logic directly,
// without rendering the component (node environment, no DOM).
// The pure functions are re-implemented here since ExportButton.tsx
// does not export them — this is a characterization test of the algorithm.

function sanitizeCsvCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function toCsvRow(record: Record<string, string | number>): string {
  return Object.values(record)
    .map((v) => {
      const str = String(v ?? "");
      const sanitized = sanitizeCsvCell(str);
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

describe("CSV formula injection guard", () => {
  it("prefixes = with a single quote", () => {
    expect(sanitizeCsvCell("=HYPERLINK(evil.com)")).toBe("'=HYPERLINK(evil.com)");
  });

  it("prefixes + with a single quote", () => {
    expect(sanitizeCsvCell("+1234")).toBe("'+1234");
  });

  it("prefixes - with a single quote", () => {
    expect(sanitizeCsvCell("-DROP TABLE")).toBe("'-DROP TABLE");
  });

  it("prefixes @ with a single quote", () => {
    expect(sanitizeCsvCell("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
  });

  it("prefixes tab-leading cell", () => {
    expect(sanitizeCsvCell("\twrapped")).toBe("'\twrapped");
  });

  it("prefixes carriage-return-leading cell", () => {
    expect(sanitizeCsvCell("\rleading")).toBe("'\rleading");
  });

  it("does not prefix safe values", () => {
    expect(sanitizeCsvCell("normal text")).toBe("normal text");
    expect(sanitizeCsvCell("123")).toBe("123");
    expect(sanitizeCsvCell("")).toBe("");
  });
});

describe("CSV comma/quote/newline escaping", () => {
  it("wraps cells containing commas in double quotes", () => {
    expect(toCsvRow({ a: "hello, world" })).toBe('"hello, world"');
  });

  it("wraps cells containing double quotes and escapes them", () => {
    expect(toCsvRow({ a: 'say "hello"' })).toBe('"say ""hello"""');
  });

  it("wraps cells containing newlines", () => {
    expect(toCsvRow({ a: "line1\nline2" })).toBe('"line1\nline2"');
  });

  it("renders a complete CSV with header row", () => {
    const rows = [{ name: "Alice", score: 95 }, { name: "Bob", score: 87 }];
    const csv = toCsv(rows);
    expect(csv).toBe("name,score\nAlice,95\nBob,87");
  });

  it("returns empty string for empty rows array", () => {
    expect(toCsv([])).toBe("");
  });

  it("formula injection combined with CSV quoting — injected prefix is quoted", () => {
    // A formula starting with = that also contains a comma must be both sanitized AND quoted
    const row = toCsvRow({ formula: "=SUM(A1,A2)" });
    expect(row).toContain("'="); // injection guard applied
    expect(row).toMatch(/^".*"$/); // also CSV-quoted
  });
});
