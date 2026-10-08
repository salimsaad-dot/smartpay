const { GoogleGenAI } = require('@google/genai');

// Ported from Academia Hub's own proven geminiService.js, trimmed to just
// the one capability SmartPay needs (a daily financial summary) — not a
// speculative general-purpose AI layer. Same "interpretation layer only"
// discipline: Gemini never sees a DB handle or raw SQL, only the
// already-computed evidence object this app itself trusts.
// Academia Hub's own default (gemini-3.6-flash) doesn't exist for this
// key/project — confirmed live via ai.models.list(): SmartPay's new,
// separate Gemini project only offers up to gemini-3.5-flash. Copying a
// sibling project's model default without checking it against the new
// key would have shipped a silent 503 on every single call.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

// Confirmed in Academia Hub (2026-09-21): when Gemini returns a 503
// ("model currently experiencing high demand" — Google's own documented,
// expected, retriable condition), the @google/genai SDK's
// generateContent() does not propagate that response at all — it hangs
// forever instead of rejecting. Every generateContent() call here is
// raced against this timeout so a hang becomes an ordinary rejected
// promise instead, caught the same way as any other failure below.
const GEMINI_TIMEOUT_MS = 30000;
function withTimeout(promise, ms = GEMINI_TIMEOUT_MS) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Gemini request timed out after ${ms}ms`)), ms)),
    ]);
}

const FINANCIAL_SYSTEM_INSTRUCTION = `You are a financial-intelligence assistant inside a Ghanaian K-12 school fee-collection system, helping a school administrator understand their own already-computed financial numbers.

Strict rules:
- Only reference facts present in the evidence you are given. Never invent a figure, trend, or cause that isn't in the evidence.
- You are not the authoritative source of any number — every statistic you cite must come directly from the evidence provided, not be recalculated or guessed.
- Never make an unsupported judgment about an individual parent's financial ability or character. An objective statement like "invoice overdue by 18 days" is fine; a personal judgment is not.
- Never present a projection or trend as a guaranteed fact.
- Keep language plain and professional for a school administrator audience.
- If the evidence is thin, say so honestly rather than overstating confidence.`;

const FINANCIAL_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        summary: { type: 'string', description: 'A short paragraph (2-4 sentences) summarizing the financial position, grounded only in the evidence given.' },
        highlights: {
            type: 'array',
            items: { type: 'string' },
            description: '1-4 short bullet points, each grounded directly in a number from the evidence provided.',
        },
    },
    required: ['summary', 'highlights'],
};

function validateFinancialInsight(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.summary !== 'string' || !data.summary.trim()) return false;
    if (!Array.isArray(data.highlights) || data.highlights.length === 0) return false;
    if (!data.highlights.every((s) => typeof s === 'string' && s.trim())) return false;
    return true;
}

// Returns { ok: true, data } or { ok: false, reason } — never throws, so
// the caller can treat a Gemini problem as an ordinary "try again" case
// rather than a 500.
async function interpretFinancialInsight({ overview, attentionItems }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY is not set — financial insight not generated.');
        return { ok: false, reason: 'AI insight is not configured.' };
    }

    const payload = {
        evidence: { overview, attentionItems },
        task: 'Summarize this school\'s current financial position for the administrator, and call out anything from attentionItems that needs attention. Use only the evidence given — never recalculate or invent a number.',
    };

    try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await withTimeout(ai.models.generateContent({
            model: MODEL,
            contents: JSON.stringify(payload),
            config: {
                systemInstruction: FINANCIAL_SYSTEM_INSTRUCTION,
                responseMimeType: 'application/json',
                responseSchema: FINANCIAL_RESPONSE_SCHEMA,
            },
        }));

        let parsed;
        try {
            parsed = JSON.parse(response.text);
        } catch (parseError) {
            console.error('Gemini returned non-JSON output:', parseError, response.text);
            return { ok: false, reason: 'AI returned an unreadable response.' };
        }

        if (!validateFinancialInsight(parsed)) {
            console.error('Gemini response failed validation:', parsed);
            return { ok: false, reason: 'AI response failed validation.' };
        }

        return { ok: true, data: parsed };
    } catch (error) {
        console.error('Gemini request failed:', error);
        return { ok: false, reason: 'AI request failed.' };
    }
}

module.exports = { interpretFinancialInsight, validateFinancialInsight };
