const express = require('express');
const router = express.Router();
const controller = require('../controllers/scheduledJobController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

router.get('/', verifyToken, controller.list);
router.post('/friday/run', verifyToken, verifyRole('school_admin'), controller.manualRun);

module.exports = router;
