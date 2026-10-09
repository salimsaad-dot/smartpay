// The headmaster's handwritten list, transcribed as-is (per the user's
// explicit decision: seed with the document's wording now, since
// fee_types is school-scoped and editable later — wording can be fixed
// without a code change). Seeded once per school (at registration, or by
// the one-off backfill for schools that already existed before this
// feature shipped) — this is a starting point, not a fixed enum.
const DEFAULT_FEE_TYPES = [
    'School Fees',
    'Feeding',
    'School Uniform',
    'Wednesday Wear',
    'Thursday Wear',
    'Friday Wear',
    'Exam Fees / Mock',
    'Textbook / Stationery',
    'Transportation',
    'BECE Registration',
    'Extra Classes',
    'Graduation Fees',
    'T-shirt / Lacoste',
];

module.exports = { DEFAULT_FEE_TYPES };
