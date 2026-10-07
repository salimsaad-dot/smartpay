"use client";

import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { parseCSV, parseExcel, downloadXlsxTemplate } from "@/lib/csv";
import { inputClass } from "@/components/ui";
import { Badge2, Button2, Card2 } from "@/components/ui2";

// Generic "download template -> upload CSV/Excel -> preview -> import ->
// per-row results" flow. Only Students uses this today, but kept generic
// (column spec + endpoint passed in) the same way Academia Hub's own
// BulkImportPanel is shared across students and staff, in case a second
// bulk-import entity shows up later.
export default function BulkImportPanel({ columns, exampleRow, templateFilename, endpoint, entityLabel, onImported }) {
  const [rows, setRows] = useState(null);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);

  const requiredKeys = columns.filter((c) => c.required).map((c) => c.key);

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setResults(null);
    setParseError("");

    const isExcel = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const { headers, rows: rawRows } = isExcel ? parseExcel(reader.result) : parseCSV(String(reader.result));
      if (headers.length === 0) {
        setParseError(`Couldn't read any rows from this file — make sure it's a ${isExcel ? "spreadsheet" : "CSV"} with a header row.`);
        setRows(null);
        return;
      }
      const missingHeaders = columns.filter((c) => c.required && !headers.includes(c.header));
      if (missingHeaders.length > 0) {
        setParseError(`Missing required column${missingHeaders.length > 1 ? "s" : ""}: ${missingHeaders.map((c) => c.header).join(", ")}. Download the template to see the exact headers expected.`);
        setRows(null);
        return;
      }
      const mapped = rawRows.map((raw) => Object.fromEntries(columns.map((c) => [c.key, raw[c.header] || ""])));
      setRows(mapped);
    };
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }

  async function handleImport() {
    setImporting(true);
    setResults(null);
    try {
      const res = await apiRequest(endpoint, { method: "POST", body: { rows } });
      setResults(res.data);
      if (res.data.failCount === 0) {
        setRows(null);
        onImported?.();
      }
    } catch (err) {
      setParseError(err.message);
    } finally {
      setImporting(false);
    }
  }

  const rowsMissingRequired = rows ? rows.filter((r) => requiredKeys.some((k) => !r[k])).length : 0;

  return (
    <Card2 className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-[var(--ink)]">Bulk Import ({entityLabel}s)</h2>
          <p className="mt-1 text-sm text-[var(--slate-quiet)]">
            Upload a CSV or Excel file to add many {entityLabel}s at once. Each row is saved independently — one bad row won&apos;t block the rest.
          </p>
        </div>
        <Button2 variant="secondary" onClick={() => downloadXlsxTemplate(templateFilename, columns, exampleRow)}>
          <Download size={16} /> Download Template
        </Button2>
      </div>

      <label className="mt-4 inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3.5 text-sm font-semibold text-[var(--slate)] hover:bg-[var(--hover)] sm:min-h-0 sm:py-2">
        <Upload size={16} /> Choose CSV or Excel File
        <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} className="hidden" />
      </label>
      <p className="mt-1.5 text-xs text-[var(--slate-quiet)]">
        Using Excel? Format date and phone number columns as <span className="font-semibold">Text</span> before filling them in, or a leading zero (e.g. 0244...) may get dropped.
      </p>

      {parseError && <div className="mt-3 rounded-lg bg-[var(--danger-wash)] px-3 py-2 text-sm text-[var(--danger)]">{parseError}</div>}

      {rows && rows.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--ink)]">
              {rows.length} row{rows.length !== 1 ? "s" : ""} parsed
              {rowsMissingRequired > 0 && (
                <span className="ml-2 text-[var(--danger)]">
                  · {rowsMissingRequired} missing a required field ({requiredKeys.map((k) => columns.find((c) => c.key === k)?.header).join(", ")})
                </span>
              )}
            </p>
            <Button2 onClick={handleImport} disabled={importing || rowsMissingRequired > 0}>
              {importing ? "Importing..." : `Import ${rows.length} ${entityLabel}${rows.length !== 1 ? "s" : ""}`}
            </Button2>
          </div>

          <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-[var(--border)]">
            <table className="w-full min-w-[600px] text-left text-xs">
              <thead className="sticky top-0 bg-[var(--hover)]">
                <tr className="border-b border-[var(--border)] text-[11px] text-[var(--slate-quiet)]">
                  <th className="px-3 py-2 font-medium">#</th>
                  {columns.slice(0, 5).map((c) => <th key={c.key} className="px-3 py-2 font-medium">{c.header}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const missing = requiredKeys.some((k) => !r[k]);
                  return (
                    <tr key={i} className={`border-b border-[var(--border)] last:border-b-0 ${missing ? "bg-[var(--danger-wash)]" : ""}`}>
                      <td className="px-3 py-1.5 text-[var(--slate-quiet)]">{i + 1}</td>
                      {columns.slice(0, 5).map((c) => <td key={c.key} className="px-3 py-1.5 text-[var(--ink)]">{r[c.key] || "—"}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {results && (
        <div className="mt-4 rounded-lg border border-[var(--border)] p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
            <Badge2 tone="success">{results.successCount} imported</Badge2>
            {results.failCount > 0 && <Badge2 tone="danger">{results.failCount} failed</Badge2>}
          </p>
          {results.failCount > 0 && (
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-xs text-[var(--slate)]">
              {results.results.filter((r) => r.status === "error").map((r) => (
                <li key={r.row}>
                  Row {r.row} ({r.firstName} {r.lastName}): <span className="text-[var(--danger)]">{r.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card2>
  );
}
