// Phase 2 of the fee-management upgrade: lets a fee type be marked
// "selected students only" (vs. the existing class-wide default), backed
// by a reusable per-student eligibility list that persists across terms
// (per the user's explicit choice — an admin picks students once, not
// every time a new term's fee structure is generated).
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
    console.log('Step 1: add fee_types.applicability if missing...');
    if (await columnExists('fee_types', 'applicability')) {
        console.log('  column already exists, skipping.');
    } else {
        await pool.query(
            `ALTER TABLE fee_types ADD COLUMN applicability ENUM('class_wide','selected_students') NOT NULL DEFAULT 'class_wide' AFTER status`
        );
        console.log('  added (defaulted to class_wide — every existing fee type keeps today\'s behavior exactly).');
    }

    console.log('Step 2: ensure student_fee_eligibility table exists...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS student_fee_eligibility (
          id INT NOT NULL AUTO_INCREMENT,
          school_id INT NOT NULL,
          student_id INT NOT NULL,
          fee_type_id INT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY unique_student_feetype (student_id, fee_type_id),
          KEY idx_school (school_id),
          KEY idx_feetype (fee_type_id),
          CONSTRAINT fk_sfe_school FOREIGN KEY (school_id) REFERENCES schools (id),
          CONSTRAINT fk_sfe_student FOREIGN KEY (student_id) REFERENCES students (id),
          CONSTRAINT fk_sfe_feetype FOREIGN KEY (fee_type_id) REFERENCES fee_types (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  done.');

    console.log('\nMigration complete.');
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
