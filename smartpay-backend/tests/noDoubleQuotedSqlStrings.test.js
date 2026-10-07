const fs = require('fs');
const path = require('path');

// Guards against the exact bug found live in production, 2026-10-07:
// `status = "active"` inside a single-quoted SQL string compiles and
// runs fine against this project's local MySQL (XAMPP, default SQL
// mode), but production's Aiven instance apparently has ANSI_QUOTES (or
// an SQL mode that includes it) enabled — there, a double-quoted
// literal is parsed as an *identifier*, not a string, so
// `status = "active"` becomes "compare the status column to a column
// named active" and throws ER_BAD_FIELD_ERROR ("Unknown column
// 'active'"). Local tests could never have caught this by actually
// running the query (local SQL mode doesn't reproduce it), so this is a
// static source check instead — every real SQL string in this codebase
// already uses single quotes for string literals, so this failure mode
// is purely accidental, never an intentional identifier-quote.
function allJsFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'tests') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files = files.concat(allJsFiles(full));
        else if (entry.name.endsWith('.js')) files.push(full);
    }
    return files;
}

describe('no double-quoted string literals inside SQL queries', () => {
    test('controllers/ and utils/ contain no `"word"` pattern inside a query string', () => {
        const root = path.join(__dirname, '..');
        const files = [...allJsFiles(path.join(root, 'controllers')), ...allJsFiles(path.join(root, 'utils'))];
        const offenders = [];

        // A double-quoted bareword (letters/underscores only) sitting
        // right after `= ` inside what's otherwise a single-quoted SQL
        // string — the exact shape of the real bug, not a blanket "no
        // double quotes anywhere" rule (which would also flag legitimate
        // JS string literals elsewhere in these files).
        const pattern = /=\s*"[a-zA-Z_]+"/;

        for (const file of files) {
            const lines = fs.readFileSync(file, 'utf8').split('\n');
            lines.forEach((line, i) => {
                if (pattern.test(line) && /pool\.query|connection\.query/.test(line)) {
                    offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
                }
            });
        }

        if (offenders.length > 0) {
            throw new Error(`Found double-quoted string literal(s) inside a SQL query — breaks under ANSI_QUOTES SQL mode (production), use single quotes instead:\n${offenders.join('\n')}`);
        }
    });
});
