const bcrypt = require('bcrypt');
const pool = require('../db');
const { isValidCode } = require('./schoolCode');
const { DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_BODY } = require('./smsTemplate');
const { DEFAULT_FEE_TYPES } = require('./feeTypes');

// Creates a school and its first school_admin in one transaction, seeded
// with a default reminder template and fee types so it can work straight
// away. Used by the owner console (the only way schools are created in
// production since 2026-10-15) and by the test-only register route.
//
// Two creations racing for the same code is handled by the UNIQUE KEY on
// schools.code (ER_DUP_ENTRY below), not a SELECT-then-INSERT pre-check,
// which would leave a race window.
//
// Throws an Error with .status (400/409) for problems the caller should
// show to the person, or a plain Error for anything unexpected.

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function provisioningError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

async function createSchoolWithAdmin({ schoolName, code, adminName, email, password, paidUntil = null }) {
    if (!schoolName?.trim() || !code?.trim() || !adminName?.trim() || !email?.trim() || !password) {
        throw provisioningError(400, 'School name, code, admin name, email, and password are all required.');
    }
    const normalizedCode = code.trim().toLowerCase();
    if (!isValidCode(normalizedCode)) {
        throw provisioningError(400, 'Code must be 3-30 characters, lowercase letters/numbers/hyphens only, and not a reserved word.');
    }
    if (password.length < 8) {
        throw provisioningError(400, 'Password must be at least 8 characters.');
    }
    if (paidUntil !== null && !DATE_SHAPE.test(paidUntil)) {
        throw provisioningError(400, 'Paid-until date must be a date (YYYY-MM-DD), or left empty for no expiry.');
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [schoolResult] = await connection.query(
            'INSERT INTO schools (name, code, paid_until) VALUES (?, ?, ?)',
            [schoolName.trim(), normalizedCode, paidUntil]
        );
        const schoolId = schoolResult.insertId;

        const passwordHash = await bcrypt.hash(password, 10);
        const [userResult] = await connection.query(
            'INSERT INTO users (school_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
            [schoolId, adminName.trim(), email.trim().toLowerCase(), passwordHash, 'school_admin']
        );

        await connection.query(
            `INSERT INTO sms_templates (school_id, name, body, type) VALUES (?, ?, ?, 'manual_reminder')`,
            [schoolId, DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_BODY]
        );
        for (const typeName of DEFAULT_FEE_TYPES) {
            await connection.query('INSERT INTO fee_types (school_id, name) VALUES (?, ?)', [schoolId, typeName]);
        }

        await connection.commit();
        return { schoolId, userId: userResult.insertId, schoolName: schoolName.trim(), code: normalizedCode };
    } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') {
            const field = error.sqlMessage?.includes('unique_code') ? 'That school code is' : 'That email is';
            throw provisioningError(409, `${field} already taken.`);
        }
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = { createSchoolWithAdmin };
