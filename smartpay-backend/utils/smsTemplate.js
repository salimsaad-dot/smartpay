// Simple {{variable}} substitution — matches the spec's own variable
// table exactly (section 9.1). Kept deliberately simple (no conditional
// template syntax): a multi-child reminder renders {{student_name}} as a
// comma-joined list and {{total_balance}} as the combined sum, rather
// than the spec's richer per-child "Kwame GH₵500; Ama GH₵300" breakdown
// format — that's a real, documented scope cut for Phase 7 (see
// smartpay/DESIGN.md's Decisions Log), not an oversight.
function renderTemplate(body, variables) {
    return body.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match;
    });
}

const DEFAULT_TEMPLATE_NAME = 'Default Reminder';
const DEFAULT_TEMPLATE_BODY =
    '{{school_name}}: Dear {{parent_name}}, {{student_name}} has an outstanding fee balance of {{total_balance}} for {{term_name}}. Pay securely: {{payment_link}}';

function formatMoneyForSms(amount, currencyCode) {
    return `${currencyCode} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

module.exports = { renderTemplate, DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_BODY, formatMoneyForSms };
