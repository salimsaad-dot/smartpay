// Minimal, dependency-free CSV serialization. Beyond RFC 4180 quoting
// (wrap in quotes if the value contains a comma, quote, or newline;
// double any embedded quotes), also guards against CSV/formula injection
// (OWASP): a cell whose text starts with =, +, -, or @ is interpreted as
// a formula by Excel/Sheets when the file is opened, not shown as plain
// text. These reports include parent/student-entered names, so a
// malicious or just-unlucky value (e.g. a name starting with "-") could
// otherwise execute as a formula for whoever opens the export. Prefixing
// with a single quote is the standard mitigation — Excel/Sheets render it
// as a leading apostrophe marker, not literal text, and it forces the
// value through the normal quoting path below since it still needs
// escaping if it contains a comma/quote/newline.
function csvEscape(value) {
    let str = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@]/.test(str)) {
        str = `'${str}`;
    }
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// columns: [{ key, label }] — key supports dot-paths are NOT supported,
// rows must already be flat objects (each report builds its own flat
// row shape rather than exporting raw joined DB rows).
function toCsv(rows, columns) {
    const header = columns.map((c) => csvEscape(c.label)).join(',');
    const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(','));
    return [header, ...lines].join('\r\n');
}

module.exports = { toCsv };
