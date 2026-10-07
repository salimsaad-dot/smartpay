import * as XLSX from "xlsx";

// Quote-aware CSV parsing — bulk import rows include free-text names/
// addresses that can legitimately contain a comma, so a naive line/comma
// split could otherwise silently split a real record into the wrong
// columns.
function parseLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

// Returns { headers, rows } where each row is a plain object keyed by the
// raw CSV header text — callers map those to their own field names.
export function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = parseLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { headers, rows };
}

function formatISODate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Reads the first sheet of an .xlsx/.xls workbook into the same
// { headers, rows } shape parseCSV returns, so BulkImportPanel can treat
// both formats identically after this point.
//
// Two passes over the same sheet, merged cell-by-cell: `cellDates: true`
// at read time turns a genuine Excel date cell into a real JS Date object
// (instead of a number + format code), which the raw:true pass surfaces
// directly — used only to reformat those specific cells as an unambiguous
// ISO YYYY-MM-DD. Every other cell still uses raw:false (the *displayed*
// text), unchanged, since that's the only way to keep a column the admin
// explicitly formatted as Text (e.g. a phone number starting with 0) —
// raw:false can't recover a leading zero Excel already stripped from a
// cell left as General/Number. Without this split, a real date cell
// would get rendered via raw:false as SheetJS's default short-date text
// (e.g. "1/17/13"), silently losing the century and using an ambiguous
// day/month order — not something anyone typed, this parser's own lossy
// rendering of a value Excel had completely correct.
export function parseExcel(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawMatrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  const textMatrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const nonEmpty = textMatrix
    .map((row, i) => ({ row, rawRow: rawMatrix[i] }))
    .filter(({ row }) => row.some((cell) => String(cell).trim().length > 0));
  if (nonEmpty.length < 2) return { headers: [], rows: [] };
  const headers = nonEmpty[0].row.map((h) => String(h).trim());
  const rows = nonEmpty.slice(1).map(({ row, rawRow }) =>
    Object.fromEntries(
      headers.map((h, i) => {
        const rawCell = rawRow?.[i];
        const value = rawCell instanceof Date ? formatISODate(rawCell) : String(row[i] ?? "").trim();
        return [h, value];
      })
    )
  );
  return { headers, rows };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// A blank starter file with the exact headers a bulk-import form expects,
// plus one filled-in example row so the format is obvious without
// cross-referencing separate instructions. A genuine .xlsx, not a plain
// CSV, so the example row's cells keep their actual JS string type and
// are guaranteed to open as plain text, never reinterpreted by Excel's
// own auto-detect on open.
export function downloadXlsxTemplate(filename, columns, exampleRow) {
  const headers = columns.map((c) => c.header);
  const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  ws["!cols"] = headers.map(() => ({ wch: 22 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, ws, "Sheet1");
  const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  triggerDownload(new Blob([out], { type: "application/octet-stream" }), filename);
}
