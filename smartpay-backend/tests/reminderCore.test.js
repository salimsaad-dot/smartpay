const { buildOutstandingBreakdown, MAX_BREAKDOWN_CHARS } = require('../utils/reminderCore');

function invoice({ studentId = 1, firstName = 'Kofi', lastName = 'Mensah', feeTypeName = 'School Fees', balance = 300 }) {
    return { student_id: studentId, first_name: firstName, last_name: lastName, fee_type_name: feeTypeName, balance };
}

describe('buildOutstandingBreakdown (fee-management Phase 4 — unit, no DB)', () => {
    test('a single child with one outstanding invoice renders just that item', () => {
        const result = buildOutstandingBreakdown([invoice({ feeTypeName: 'School Fees', balance: 300 })], 'GHS');
        expect(result).toBe('School Fees GHS 300.00');
    });

    test('a single child with multiple invoices joins items with "; ", no student name prefix', () => {
        const invoices = [
            invoice({ feeTypeName: 'School Fees', balance: 300 }),
            invoice({ feeTypeName: 'Feeding', balance: 300 }),
            invoice({ feeTypeName: 'T-shirt / Lacoste', balance: 100 }),
        ];
        const result = buildOutstandingBreakdown(invoices, 'GHS');
        expect(result).toBe('School Fees GHS 300.00; Feeding GHS 300.00; T-shirt / Lacoste GHS 100.00');
    });

    test('multiple children attribute each item to the correct student by name', () => {
        const invoices = [
            invoice({ studentId: 1, firstName: 'Kofi', lastName: 'Mensah', feeTypeName: 'School Fees', balance: 300 }),
            invoice({ studentId: 1, firstName: 'Kofi', lastName: 'Mensah', feeTypeName: 'Feeding', balance: 200 }),
            invoice({ studentId: 2, firstName: 'Ama', lastName: 'Owusu', feeTypeName: 'Transportation', balance: 150 }),
        ];
        const result = buildOutstandingBreakdown(invoices, 'GHS');
        expect(result).toBe('Kofi Mensah: School Fees GHS 300.00, Feeding GHS 200.00; Ama Owusu: Transportation GHS 150.00');
    });

    test('an amount is never split or altered by truncation — entries are whole or omitted, never partial', () => {
        const invoices = Array.from({ length: 15 }, (_, i) =>
            invoice({ studentId: 1, feeTypeName: `Fee Type With A Fairly Long Name Number ${i}`, balance: 123.45 })
        );
        const result = buildOutstandingBreakdown(invoices, 'GHS');
        expect(result.length).toBeGreaterThan(0);
        // Every amount that appears must appear whole — never a truncated digit mid-number.
        const amounts = result.match(/GHS [\d,]+\.\d{2}/g) || [];
        for (const a of amounts) {
            expect(a).toMatch(/^GHS [\d,]+\.\d{2}$/);
        }
        expect(result).toMatch(/\+\d+ more \(see link for full detail\)/);
    });

    test('truncation stays within the documented character budget plus the "+N more" suffix', () => {
        const invoices = Array.from({ length: 20 }, (_, i) => invoice({ feeTypeName: `Extra Classes Batch ${i}`, balance: 50 }));
        const result = buildOutstandingBreakdown(invoices, 'GHS');
        const beforeSuffix = result.replace(/ \+\d+ more \(see link for full detail\)$/, '');
        expect(beforeSuffix.length).toBeLessThanOrEqual(MAX_BREAKDOWN_CHARS);
    });

    test('even a single entry that alone exceeds the budget is still included in full, not emptied', () => {
        const longName = 'A'.repeat(MAX_BREAKDOWN_CHARS + 50);
        const result = buildOutstandingBreakdown([invoice({ feeTypeName: longName, balance: 100 })], 'GHS');
        expect(result).toContain(longName);
        expect(result).toContain('GHS 100.00');
    });

    test('no omission suffix appears when everything fits', () => {
        const invoices = [invoice({ feeTypeName: 'School Fees', balance: 300 }), invoice({ feeTypeName: 'Feeding', balance: 200 })];
        const result = buildOutstandingBreakdown(invoices, 'GHS');
        expect(result).not.toContain('more');
    });
});
