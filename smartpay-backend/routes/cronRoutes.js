const express = require('express');
const router = express.Router();
const controller = require('../controllers/scheduledJobController');
const { verifyCronSecret } = require('../middleware/cronAuth');
const { generateBackupSql } = require('../utils/backupSql');

// No verifyToken — the caller is an external scheduler, not a logged-in
// admin. Authenticated instead by the secret-header check.
router.post('/friday-reminders', verifyCronSecret, controller.runForAllSchools);
router.post('/reconcile-payments', verifyCronSecret, controller.reconcilePayments);

// Nightly database backup, fetched and encrypted by the database-backup
// GitHub Actions workflow. GET so the workflow can save the body to a file.
router.get('/backup', verifyCronSecret, async (req, res) => {
    try {
        const { sql, createdAt } = await generateBackupSql();
        res.setHeader('Content-Type', 'application/sql; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="smartpay-backup-${createdAt.slice(0, 10)}.sql"`);
        res.status(200).send(sql);
    } catch (error) {
        console.error('Database backup failed:', error);
        res.status(500).json({ status: 'error', message: 'Database backup failed.' });
    }
});

module.exports = router;
