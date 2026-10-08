const pool = require('../db');

// The deterministic "evidence" layer — every number Gemini is allowed to
// reference, computed by real SQL this app already trusts, never by the
// model itself. Mirrors Academia Hub's own financialCalculations.js
// shape (same field names where the concept matches), adapted to
// SmartPay's actual schema: no academic_year_id/term dimension here,
// since the existing collection-summary report is already whole-school,
// not term-scoped — this follows that same convention rather than
// inventing a narrower one.
async function getFinancialOverview(schoolId) {
    const [[stats]] = await pool.query(
        `SELECT
            COALESCE(SUM(total), 0) AS expected,
            COALESCE(SUM(paid_amount), 0) AS collected,
            COALESCE(SUM(balance), 0) AS outstanding,
            COUNT(*) AS invoiceCount,
            COUNT(CASE WHEN balance > 0 AND due_date < CURDATE() THEN 1 END) AS overdueCount,
            COALESCE(SUM(CASE WHEN balance > 0 AND due_date < CURDATE() THEN balance ELSE 0 END), 0) AS overdueAmount,
            COUNT(DISTINCT CASE WHEN balance > 0 THEN student_id END) AS studentsInArrears
         FROM invoices
         WHERE school_id = ? AND status != 'void'`,
        [schoolId]
    );

    const expected = Number(stats.expected);
    const collected = Number(stats.collected);
    const collectionRate = expected > 0 ? Math.round((collected / expected) * 1000) / 10 : 0;

    const [[recent]] = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN amount ELSE 0 END), 0) AS last7Days,
            COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN amount ELSE 0 END), 0) AS prior7Days
         FROM payments
         WHERE school_id = ? AND status = 'success'`,
        [schoolId]
    );

    return {
        expected,
        collected,
        outstanding: Number(stats.outstanding),
        collectionRate,
        invoiceCount: Number(stats.invoiceCount),
        overdueCount: Number(stats.overdueCount),
        overdueAmount: Number(stats.overdueAmount),
        studentsInArrears: Number(stats.studentsInArrears),
        collectedLast7Days: Number(recent.last7Days),
        collectedPrior7Days: Number(recent.prior7Days),
    };
}

// Fixed thresholds, not school-configurable — same deliberate choice
// Academia Hub made for its own equivalent (see its DESIGN.md), not a
// default meant to be revisited lightly.
const LOW_COLLECTION_RATE_THRESHOLD = 70;
const OVERDUE_BACKLOG_THRESHOLD = 5;

function evaluateFinancialAttention(overview) {
    const items = [];

    if (overview.expected > 0 && overview.collectionRate < LOW_COLLECTION_RATE_THRESHOLD) {
        items.push({
            type: 'LOW_COLLECTION_RATE',
            severity: 'warning',
            message: `Collection rate is ${overview.collectionRate}%, below the ${LOW_COLLECTION_RATE_THRESHOLD}% expected level.`,
            evidence: { collectionRate: overview.collectionRate, threshold: LOW_COLLECTION_RATE_THRESHOLD },
        });
    }

    if (overview.overdueCount >= OVERDUE_BACKLOG_THRESHOLD) {
        items.push({
            type: 'OVERDUE_BACKLOG',
            severity: 'danger',
            message: `${overview.overdueCount} invoices are overdue, totaling ${overview.overdueAmount.toFixed(2)}.`,
            evidence: { overdueCount: overview.overdueCount, overdueAmount: overview.overdueAmount, threshold: OVERDUE_BACKLOG_THRESHOLD },
        });
    }

    return items;
}

module.exports = { getFinancialOverview, evaluateFinancialAttention, LOW_COLLECTION_RATE_THRESHOLD, OVERDUE_BACKLOG_THRESHOLD };
