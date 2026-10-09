// Phase 1 of the fee-management upgrade (see
// SmartPay_Fee_Management_Requirements_and_Implementation_Plan.docx):
// adds a school-scoped fee_types table and wires fee_structures to it.
//
// Idempotent — safe to re-run. Every step checks before acting:
//   1. CREATE TABLE IF NOT EXISTS fee_types.
//   2. Seed each existing school with the 13 default fee types
//      (INSERT IGNORE — a school that already has a same-named type,
//      custom or previously seeded, is left alone).
//   3. Add fee_structures.fee_type_id as a nullable column if it doesn't
//      already exist.
//   4. Backfill: for every existing fee_structures row, find-or-create a
//      fee_type matching its current free-text name, then point
//      fee_type_id at it. This preserves historical meaning exactly —
//      a structure named "Feeding Term 1" gets backfilled to whatever
//      fee_type is named "Feeding Term 1" for that school (creating one
//      if none of the 13 defaults happen to match verbatim), not
//      silently remapped to something close.
//   5. Only once no NULLs remain: make the column NOT NULL, add the FK,
//      and swap the old unique(term_id, class_id, name) index for
//      unique(term_id, class_id, fee_type_id) — safe by construction,
//      since step 4's backfill preserves the same per-school name
//      distinctness the old constraint already enforced.
//
// Run locally:      node scripts/migrate-fee-types.js
// Run against prod: DB_HOST=... DB_PORT=... DB_USER=... DB_PASSWORD=... DB_NAME=... DB_SSL=true node scripts/migrate-fee-types.js
const pool = require('../db');
const { DEFAULT_FEE_TYPES } = require('../utils/feeTypes');

async function columnExists(table, column) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows[0].cnt > 0;
}

async function indexExists(table, indexName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [table, indexName]
    );
    return rows[0].cnt > 0;
}

async function constraintExists(table, constraintName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
        [table, constraintName]
    );
    return rows[0].cnt > 0;
}

(async () => {
    console.log('Step 1: ensure fee_types table exists...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS fee_types (
          id INT NOT NULL AUTO_INCREMENT,
          school_id INT NOT NULL,
          name VARCHAR(100) NOT NULL,
          status ENUM('active','inactive') NOT NULL DEFAULT 'active',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY unique_school_type_name (school_id, name),
          CONSTRAINT fk_feetype_school FOREIGN KEY (school_id) REFERENCES schools (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  done.');

    console.log('Step 2: seed default fee types for every existing school...');
    const [schools] = await pool.query('SELECT id FROM schools');
    for (const { id: schoolId } of schools) {
        for (const typeName of DEFAULT_FEE_TYPES) {
            await pool.query('INSERT IGNORE INTO fee_types (school_id, name) VALUES (?, ?)', [schoolId, typeName]);
        }
    }
    console.log(`  seeded (or already present) for ${schools.length} school(s).`);

    console.log('Step 3: add fee_structures.fee_type_id (nullable) if missing...');
    if (await columnExists('fee_structures', 'fee_type_id')) {
        console.log('  column already exists, skipping.');
    } else {
        await pool.query('ALTER TABLE fee_structures ADD COLUMN fee_type_id INT NULL AFTER class_id');
        console.log('  added.');
    }

    console.log('Step 4: backfill fee_type_id from each structure\'s existing name...');
    const [structures] = await pool.query('SELECT id, school_id, name FROM fee_structures WHERE fee_type_id IS NULL');
    let created = 0, matched = 0;
    for (const s of structures) {
        let [[feeType]] = await pool.query('SELECT id FROM fee_types WHERE school_id = ? AND name = ?', [s.school_id, s.name]);
        if (!feeType) {
            const [result] = await pool.query('INSERT INTO fee_types (school_id, name) VALUES (?, ?)', [s.school_id, s.name]);
            feeType = { id: result.insertId };
            created += 1;
        } else {
            matched += 1;
        }
        await pool.query('UPDATE fee_structures SET fee_type_id = ? WHERE id = ?', [feeType.id, s.id]);
    }
    console.log(`  backfilled ${structures.length} structure(s): ${matched} matched an existing fee type, ${created} created a new one from the structure's own name.`);

    console.log('Step 5: verify no NULLs remain before tightening constraints...');
    const [[{ remaining }]] = await pool.query('SELECT COUNT(*) AS remaining FROM fee_structures WHERE fee_type_id IS NULL');
    if (remaining > 0) {
        console.error(`  ABORTING: ${remaining} fee_structures row(s) still have a NULL fee_type_id. Investigate before re-running — constraints were not tightened.`);
        process.exit(1);
    }
    console.log('  clean — no NULLs.');

    const [[{ cnt: totalStructures }]] = await pool.query('SELECT COUNT(*) AS cnt FROM fee_structures');
    if (totalStructures > 0) {
        await pool.query('ALTER TABLE fee_structures MODIFY COLUMN fee_type_id INT NOT NULL');
        console.log('  fee_type_id set NOT NULL.');
    } else {
        console.log('  no fee_structures rows at all — leaving fee_type_id NULL-able is fine; the application layer already requires it on every new insert.');
    }

    if (await constraintExists('fee_structures', 'fk_fs_feetype')) {
        console.log('  FK fk_fs_feetype already exists, skipping.');
    } else {
        await pool.query('ALTER TABLE fee_structures ADD CONSTRAINT fk_fs_feetype FOREIGN KEY (fee_type_id) REFERENCES fee_types (id)');
        console.log('  FK fk_fs_feetype added.');
    }

    // Order matters: fk_fs_term (term_id) requires SOME index on this
    // table with term_id as its leftmost column at all times — the old
    // unique_term_class_name index was quietly serving that role, so the
    // replacement must exist before the old one is dropped, or MySQL
    // refuses the drop (ER_DROP_INDEX_FK).
    if (await indexExists('fee_structures', 'unique_term_class_feetype')) {
        console.log('  unique_term_class_feetype already exists, skipping.');
    } else {
        await pool.query('ALTER TABLE fee_structures ADD UNIQUE KEY unique_term_class_feetype (term_id, class_id, fee_type_id)');
        console.log('  added unique_term_class_feetype index.');
    }

    if (await indexExists('fee_structures', 'unique_term_class_name')) {
        await pool.query('ALTER TABLE fee_structures DROP INDEX unique_term_class_name');
        console.log('  dropped old unique_term_class_name index.');
    } else {
        console.log('  unique_term_class_name already gone, skipping.');
    }

    console.log('\nMigration complete.');
    process.exit(0);
})().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
