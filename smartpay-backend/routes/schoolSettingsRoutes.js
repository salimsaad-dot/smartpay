const express = require('express');
const router = express.Router();
const controller = require('../controllers/schoolSettingsController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

router.get('/friday-reminders', verifyToken, controller.getFridaySettings);
router.patch('/friday-reminders', verifyToken, verifyRole('school_admin'), controller.updateFridaySettings);

module.exports = router;
