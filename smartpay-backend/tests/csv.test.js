const { toCsv } = require('../utils/csv');

// Regression test for a real gap a council-pressure-tested security audit
// found (2026-10-07): report exports (student/parent names, among others)
// had RFC 4180 quoting but no defense against CSV/formula injection — a
// cell starting with =, +, -, or @ is interpreted as a formula by
// Excel/Sheets when the export is opened, not shown as plain text.
describe('toCsv — formula-injection guard', () => {
    const columns = [{ key: 'name', label: 'Name' }, { key: 'note', label: 'Note' }];

    test.each([
        ['=cmd|\'/c calc\'!A0', "'=cmd|'/c calc'!A0"],
        ['+1+1', "'+1+1"],
        ['-1+1', "'-1+1"],
        ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ])('a value starting with a formula trigger (%s) is prefixed with a leading apostrophe', (input, expectedPrefixed) => {
        const csv = toCsv([{ name: input, note: 'x' }], columns);
        const dataLine = csv.split('\r\n')[1];
        // The prefixed value itself may still need RFC 4180 quoting (it
        // contains a comma/quote) — check the de-quoted cell content, not
        // the raw line, so this test isn't coupled to quoting mechanics.
        const firstCell = dataLine.startsWith('"')
            ? dataLine.slice(1, dataLine.indexOf('",'))
            : dataLine.split(',')[0];
        expect(firstCell.replace(/""/g, '"')).toBe(expectedPrefixed);
    });

    test('an ordinary name is left completely untouched', () => {
        const csv = toCsv([{ name: 'Kofi Mensah', note: 'Regular payer' }], columns);
        expect(csv).toBe('Name,Note\r\nKofi Mensah,Regular payer');
    });

    test('a value needing both the formula-guard prefix and RFC 4180 quoting is handled correctly', () => {
        const csv = toCsv([{ name: '=A1,B1', note: 'x' }], columns);
        const dataLine = csv.split('\r\n')[1];
        expect(dataLine).toBe('"\'=A1,B1",x');
    });

    test('null/undefined values still render as empty strings, not "null"/"undefined"', () => {
        const csv = toCsv([{ name: null, note: undefined }], columns);
        expect(csv.split('\r\n')[1]).toBe(',');
    });
});
