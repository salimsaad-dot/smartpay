// Minimal, dependency-free CSV serialization — the report exports don't
// need anything more sophisticated than RFC 4180 quoting (wrap in quotes
// if the value contains a comma, quote, or newline; double any embedded
// quotes).
function csvEscape(value) {
    const str = value === null || value === undefined ? '' : String(value);
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
