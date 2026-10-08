const pool = require('../db');
const { getFinancialOverview, evaluateFinancialAttention } = require('../utils/financialIntelligenceData');
// Required as a module object, never destructured — the exact
// mock-target-mismatch bug class this project already hit twice this
// session (SMS provider testing, then forgot-password email testing).
// jest.spyOn(geminiService, 'interpretFinancialInsight') only intercepts
// calls made through the module object itself.
const geminiService = require('../utils/geminiService');

// Cached once per calendar day per school — the real numbers stay live
// regardless (a school's own existing collection-summary/arrears reports
// are never cached), only the AI-written paragraph is. One row per
// school via the UNIQUE KEY on financial_insight_cache.school_id,
// overwritten daily. Mirrors Academia Hub's own CURDATE()-based daily
// cache for the identical feature.
async function getOrGenerateSummary(schoolId) {
    const [[cached]] = await pool.query(
        `SELECT summary_json, generated_at FROM financial_insight_cache
         WHERE school_id = ? AND generated_at >= CURDATE()`,
        [schoolId]
    );
    if (cached) {
        return { ...JSON.parse(cached.summary_json), generatedAt: cached.generated_at, cached: true };
    }

    const overview = await getFinancialOverview(schoolId);
    const attentionItems = evaluateFinancialAttention(overview);
    const result = await geminiService.interpretFinancialInsight({ overview, attentionItems });
    if (!result.ok) return { ok: false, reason: result.reason };

    await pool.query(
        `INSERT INTO financial_insight_cache (school_id, summary_json, generated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE summary_json = VALUES(summary_json), generated_at = VALUES(generated_at)`,
        [schoolId, JSON.stringify(result.data)]
    );
    return { ...result.data, generatedAt: new Date(), cached: false };
}

exports.getFinancialSummary = async (req, res) => {
    try {
        const summary = await getOrGenerateSummary(req.user.schoolId);
        if (summary.ok === false) {
            return res.status(200).json({ status: 'success', data: { ok: false, message: "Couldn't get an AI summary right now — try again in a moment." } });
        }
        res.status(200).json({ status: 'success', data: { ok: true, ...summary } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while loading the financial summary.' });
    }
};
