-- One-time backfill for the is_primary bug fixed in studentController.linkParent
-- (2026-10-06): every parent linked through the Students page UI before this
-- fix was inserted with is_primary = 0, since the UI never sent isPrimary and
-- the old code defaulted it to false. Several features key off is_primary = 1
-- specifically (Arrears' parent/payment-link column, the Outstanding Fees
-- report), so any student whose only/first parent link predates this fix is
-- silently invisible there until this runs once.
--
-- Safe to run more than once — idempotent. For every student who has at
-- least one parent_student row but none marked primary, this marks their
-- earliest-linked (lowest id) parent as primary. Students who already have
-- a primary parent are left untouched.
--
-- Run this once against the production database (Aiven console / Workbench)
-- after deploying the linkParent fix. Not run automatically — production DB
-- credentials aren't available to run this from the codebase itself.

UPDATE parent_student ps
JOIN (
    SELECT student_id, MIN(id) AS first_link_id
    FROM parent_student
    GROUP BY student_id
) first_links
    ON first_links.student_id = ps.student_id AND first_links.first_link_id = ps.id
LEFT JOIN (
    SELECT DISTINCT student_id FROM parent_student WHERE is_primary = 1
) has_primary
    ON has_primary.student_id = ps.student_id
SET ps.is_primary = 1
WHERE has_primary.student_id IS NULL;
