const express = require('express');
const router = express.Router();
const controller = require('../controllers/reminderController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');
const { reminderRateLimit } = require('../middleware/authRateLimit');

router.post('/preview', verifyToken, verifyRole('school_admin'), controller.preview);
router.post('/send', verifyToken, verifyRole('school_admin'), reminderRateLimit, controller.send);
router.get('/', verifyToken, controller.list);

module.exports = router;
