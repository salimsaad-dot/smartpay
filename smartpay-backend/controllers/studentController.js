const pool = require('../db');

// Redesign addition (2026-10): the primary parent's name/phone, via the
// same is_primary flag the Arrears/Outstanding-Fees queries already rely
// on — purely additive to the response shape, every existing field and
// filter is unchanged. A student with no linked parent, or no parent
// marked primary yet, simply gets null here rather than a join failure.
exports.list = async (req, res) => {
    try {
        const { classId, academicYearId, search } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT s.*, c.name AS class_name, ay.name AS academic_year_name,
                   pr.full_name AS parent_name, pr.phone AS parent_phone
            FROM students s
            JOIN classes c ON c.id = s.class_id
            JOIN academic_years ay ON ay.id = s.academic_year_id
            LEFT JOIN parent_student ps ON ps.student_id = s.id AND ps.is_primary = 1
            LEFT JOIN parents pr ON pr.id = ps.parent_id
            WHERE s.school_id = ?`;
        if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
        if (academicYearId) { sql += ' AND s.academic_year_id = ?'; params.push(academicYearId); }
        if (search?.trim()) {
            sql += ' AND (s.first_name LIKE ? OR s.last_name LIKE ? OR s.admission_no LIKE ?)';
            params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
        }
        sql += ' ORDER BY s.first_name ASC';

        const [students] = await pool.query(sql, params);
        res.status(200).json({ status: 'success', data: students });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching students.' });
    }
};

// Redesign addition (2026-10): optionally collect the parent/guardian's
// name + phone in the same Add Student request, mirroring Academia Hub's
// enrollOneStudent pattern (one form, one transaction, lookup-existing-
// parent-or-create) adapted to SmartPay's lighter parent model (no login,
// just name/phone — phone is the dedup key here, not email-or-phone,
// since every SmartPay parent has a phone but most won't have an email).
// Both parent fields stay optional — the admin can still add a student
// with no parent on file yet and link one later from the Students page,
// unchanged from before this addition (user's explicit choice).
exports.create = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { admissionNo, firstName, middleName, lastName, classId, academicYearId, gender, dateOfBirth, parentFullName, parentPhone, relationship } = req.body;
        if (!admissionNo?.trim() || !firstName?.trim() || !lastName?.trim() || !classId || !academicYearId) {
            connection.release();
            return res.status(400).json({ status: 'error', message: 'Admission number, first name, last name, class, and academic year are required.' });
        }
        // Partial parent info isn't actionable — both schema columns
        // (parents.full_name, parents.phone) are NOT NULL, so either both
        // are given or neither is.
        if ((parentFullName?.trim() || parentPhone?.trim()) && !(parentFullName?.trim() && parentPhone?.trim())) {
            connection.release();
            return res.status(400).json({ status: 'error', message: 'Parent name and phone must be provided together, or both left blank.' });
        }

        // class_id and academic_year_id are client-supplied foreign keys —
        // re-verify both actually belong to this school before trusting
        // them, same rule as everywhere else.
        const [[cls]] = await connection.query('SELECT id FROM classes WHERE id = ? AND school_id = ?', [classId, req.user.schoolId]);
        if (!cls) { connection.release(); return res.status(404).json({ status: 'error', message: 'Class not found.' }); }
        const [[year]] = await connection.query('SELECT id FROM academic_years WHERE id = ? AND school_id = ?', [academicYearId, req.user.schoolId]);
        if (!year) { connection.release(); return res.status(404).json({ status: 'error', message: 'Academic year not found.' }); }

        await connection.beginTransaction();

        const [studentResult] = await connection.query(
            `INSERT INTO students (school_id, admission_no, first_name, middle_name, last_name, class_id, academic_year_id, gender, date_of_birth)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.schoolId, admissionNo.trim(), firstName.trim(), middleName?.trim() || null, lastName.trim(), classId, academicYearId, gender || null, dateOfBirth || null]
        );
        const studentId = studentResult.insertId;

        let parentId = null;
        if (parentFullName?.trim() && parentPhone?.trim()) {
            // Reuse an existing parent sharing this phone within the school
            // (the sibling case — two children, same parent, added
            // separately) rather than creating a duplicate parent row.
            // Exact match after trim, same as the rest of this codebase
            // (no phone-format normalization at storage time anywhere else
            // either) — a differently-typed duplicate is a pre-existing,
            // unchanged possibility, not a new gap introduced here.
            const [[existingParent]] = await connection.query(
                'SELECT id FROM parents WHERE school_id = ? AND phone = ?',
                [req.user.schoolId, parentPhone.trim()]
            );
            if (existingParent) {
                parentId = existingParent.id;
            } else {
                const [parentResult] = await connection.query(
                    'INSERT INTO parents (school_id, full_name, phone) VALUES (?, ?, ?)',
                    [req.user.schoolId, parentFullName.trim(), parentPhone.trim()]
                );
                parentId = parentResult.insertId;
            }
            // Brand-new student, so this is unconditionally its first (and
            // only, so far) parent link — always primary.
            await connection.query(
                'INSERT INTO parent_student (parent_id, student_id, relationship, is_primary) VALUES (?, ?, ?, 1)',
                [parentId, studentId, relationship?.trim() || null]
            );
        }

        await connection.commit();
        res.status(201).json({ status: 'success', message: 'Student created.', data: { id: studentId, parentId } });
    } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'A student with that admission number already exists.' });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while creating the student.' });
    } finally {
        connection.release();
    }
};

exports.getById = async (req, res) => {
    try {
        const [[student]] = await pool.query(
            `SELECT s.*, c.name AS class_name, ay.name AS academic_year_name
             FROM students s JOIN classes c ON c.id = s.class_id JOIN academic_years ay ON ay.id = s.academic_year_id
             WHERE s.id = ? AND s.school_id = ?`,
            [req.params.id, req.user.schoolId]
        );
        if (!student) {
            return res.status(404).json({ status: 'error', message: 'Student not found.' });
        }

        const [parents] = await pool.query(
            `SELECT p.id, p.full_name, p.phone, p.email, ps.relationship, ps.is_primary
             FROM parent_student ps JOIN parents p ON p.id = ps.parent_id
             WHERE ps.student_id = ? AND p.school_id = ?
             ORDER BY ps.is_primary DESC, p.full_name ASC`,
            [req.params.id, req.user.schoolId]
        );

        res.status(200).json({ status: 'success', data: { ...student, parents } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching the student.' });
    }
};

// Links an existing parent/guardian to a student — both are re-verified to
// belong to this school first, since neither parentId nor the :id route
// param can be trusted just because they're plausible integers. This is
// also where a sibling naturally gets recognized: linking the same
// parent_id to a second student is exactly what makes them siblings.
// A student's first linked parent/guardian is automatically the primary
// one — the only UI that links a parent (the Students page) never lets an
// admin choose "primary" explicitly, so defaulting isPrimary to false
// meant the very first (and for most students, only) parent linked was
// silently never primary. Several features key off is_primary=1
// specifically (Arrears' parent/payment-link column, the Outstanding Fees
// report), so that meant a normally-linked parent could never appear
// there or receive a payment link — a real, user-impacting gap this
// closes. An explicit isPrimary in the request body still overrides the
// auto-first-parent default, for any future UI that wants to set it
// directly. Locks the student's existing parent_student rows
// (SELECT ... FOR UPDATE) before deciding, so two concurrent "first link"
// requests for the same student can't both decide they're the first.
exports.linkParent = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { parentId, relationship, isPrimary } = req.body;
        if (!parentId) {
            connection.release();
            return res.status(400).json({ status: 'error', message: 'parentId is required.' });
        }

        const [[student]] = await connection.query('SELECT id FROM students WHERE id = ? AND school_id = ?', [req.params.id, req.user.schoolId]);
        if (!student) {
            connection.release();
            return res.status(404).json({ status: 'error', message: 'Student not found.' });
        }
        const [[parent]] = await connection.query('SELECT id FROM parents WHERE id = ? AND school_id = ?', [parentId, req.user.schoolId]);
        if (!parent) {
            connection.release();
            return res.status(404).json({ status: 'error', message: 'Parent/guardian not found.' });
        }

        await connection.beginTransaction();
        const [existingLinks] = await connection.query(
            'SELECT id FROM parent_student WHERE student_id = ? FOR UPDATE',
            [req.params.id]
        );
        const primary = isPrimary !== undefined ? (isPrimary ? 1 : 0) : (existingLinks.length === 0 ? 1 : 0);

        await connection.query(
            'INSERT INTO parent_student (parent_id, student_id, relationship, is_primary) VALUES (?, ?, ?, ?)',
            [parentId, req.params.id, relationship?.trim() || null, primary]
        );
        await connection.commit();
        res.status(201).json({ status: 'success', message: 'Parent/guardian linked.' });
    } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'This parent/guardian is already linked to this student.' });
        }
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while linking the parent/guardian.' });
    } finally {
        connection.release();
    }
};

exports.unlinkParent = async (req, res) => {
    try {
        // Scoped through a join back to students.school_id rather than a
        // bare parent_student.id delete — parent_student itself carries no
        // school_id column, so this is what actually enforces tenant
        // isolation on the unlink action.
        const [result] = await pool.query(
            `DELETE ps FROM parent_student ps
             JOIN students s ON s.id = ps.student_id
             WHERE ps.student_id = ? AND ps.parent_id = ? AND s.school_id = ?`,
            [req.params.id, req.params.parentId, req.user.schoolId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'Link not found.' });
        }
        res.status(200).json({ status: 'success', message: 'Parent/guardian unlinked.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while unlinking the parent/guardian.' });
    }
};
