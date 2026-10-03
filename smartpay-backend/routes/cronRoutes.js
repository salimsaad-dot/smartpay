const express = require('express');
const router = express.Router();
const controller = require('../controllers/scheduledJobController');
const { verifyCronSecret } = require('../middleware/cronAuth');

// No verifyToken — the caller is an external scheduler, not a logged-in
// admin. Authenticated instead by the secret-header check.
router.post('/friday-reminders', verifyCronSecret, controller.runForAllSchools);

module.exports = router;
