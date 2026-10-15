// Whether a school may use SmartPay right now. Added 2026-10-15 so the
// platform owner controls access: schools are created by the owner (no
// public sign-up), and a school is blocked when either
//   - the owner suspended it (schools.status = 'suspended'), or
//   - its subscription lapsed (schools.paid_until is in the past).
// paid_until NULL means no expiry, which is what every school created
// before this change has, so existing pilot schools keep working.
//
// Dates are compared in SQL with CURDATE(): Ghana is UTC+0 with no
// daylight saving, matching the database's UTC clock, so "today" agrees.
// A school paid until the 14th can still use SmartPay on the 14th.

// For WHERE clauses on a query that aliases schools as `s`.
const SCHOOL_IS_OPEN_SQL = "(s.status = 'active' AND (s.paid_until IS NULL OR s.paid_until >= CURDATE()))";

// Columns to select (with schools aliased as `s`) for describeAccess().
// paid_until comes back as a plain 'YYYY-MM-DD' string, not a JS Date,
// so it can't shift a day when serialized in a non-UTC timezone.
const ACCESS_COLUMNS_SQL = `s.status AS school_status, DATE_FORMAT(s.paid_until, '%Y-%m-%d') AS paid_until,
    (s.paid_until IS NOT NULL AND s.paid_until < CURDATE()) AS subscription_expired,
    DATEDIFF(s.paid_until, CURDATE()) AS days_left`;

const RENEWAL_WARNING_DAYS = 7;

const MESSAGES = {
    suspended: 'Your school\'s SmartPay account is suspended. Please contact SmartPay to restore access.',
    expired: 'Your school\'s SmartPay subscription has ended. Please contact SmartPay to renew.',
};

// row: a result row that includes ACCESS_COLUMNS_SQL.
function describeAccess(row) {
    if (row.school_status !== 'active') return { blocked: true, reason: 'suspended', message: MESSAGES.suspended };
    if (Number(row.subscription_expired) === 1) return { blocked: true, reason: 'expired', message: MESSAGES.expired };
    return { blocked: false };
}

// What the dashboard needs for the renewal notice. daysLeft is null when
// the school has no expiry date.
function billingSummary(row) {
    const daysLeft = row.days_left === null || row.days_left === undefined ? null : Number(row.days_left);
    return {
        paidUntil: row.paid_until,
        daysLeft,
        renewalDue: daysLeft !== null && daysLeft >= 0 && daysLeft < RENEWAL_WARNING_DAYS,
    };
}

module.exports = { SCHOOL_IS_OPEN_SQL, ACCESS_COLUMNS_SQL, RENEWAL_WARNING_DAYS, describeAccess, billingSummary };
