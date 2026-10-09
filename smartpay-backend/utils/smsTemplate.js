// Simple {{variable}} substitution — matches the spec's own variable
// table exactly (section 9.1). Kept deliberately simple (no conditional
// template syntax): a multi-child reminder renders {{student_name}} as a
// comma-joined list and {{total_balance}} as the combined sum, while
// {{outstanding_breakdown}} (fee-management Phase 4) is what actually
// carries the spec's richer per-child "Kwame GH₵500; Ama GH₵300" detail
// — see utils/reminderCore.js's buildOutstandingBreakdown.
function renderTemplate(body, variables) {
    return body.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match;
    });
}

const DEFAULT_TEMPLATE_NAME = 'Default Reminder';
// Itemized by default (fee-management Phase 4), and includes MoMo
// number (added after real pilot usage surfaced a serious gap: a
// payment link alone is useless to a parent without a smartphone, and
// the original default template never mentioned the school's MoMo
// number even when the school had one configured). Renders a dangling
// "or MoMo" with nothing after it for a school that hasn't set one —
// a real but minor cosmetic cost, accepted because a payment-blocking
// gap for feature-phone parents is far worse than an odd trailing
// phrase. Only affects schools registering from now on; an existing
// school's already-created template row is its own content and is
// never silently rewritten — the new variable is simply available for
// them to add on the SMS Templates page, same as any other variable.
const DEFAULT_TEMPLATE_BODY =
    '{{school_name}}: {{student_name}} owes {{outstanding_breakdown}}. Total {{total_balance}}. Pay: {{payment_link}} or MoMo {{school_momo_number}}';

function formatMoneyForSms(amount, currencyCode) {
    return `${currencyCode} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

module.exports = { renderTemplate, DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_BODY, formatMoneyForSms };
