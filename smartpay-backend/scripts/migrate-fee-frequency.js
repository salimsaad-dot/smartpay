// Phase 3 of the fee-management upgrade: a display-only frequency label
// on fee types (termly/annual/one_time/as_needed). Per the user's
// explicit choice, this is purely informational — no new duplicate-
// billing enforcement. The existing per-structure
// UNIQUE(term_id, class_id, fee_type_id) constraint (Phase 1) already
// does that job; frequency just explains the billing rhythm to the
// admin reading the Fee Types page.
//
// Idempotent — safe to re-run.
const pool = require('../db');

async function columnExists(table, column) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows[0].cnt > 0;
}

(async () => {
    console.log('Step 1: add fee_types.frequency if missing...');
    if (await columnExists('fee_types', 'frequency')) {
        console.log('  column already exists, skipping.');
    } else {
        await pool.query(
            `ALTER TABLE fee_types ADD COLUMN frequency ENUM('termly','annual','one_time','as_needed') NOT NULL DEFAULT 'termly' AFTER applicability`
        );
        console.log('  added (defaulted to termly for every existing fee type).');
    }

    console.log('\nMigration complete.');
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
