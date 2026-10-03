const express = require('express');
const router = express.Router();
const controller = require('../controllers/auditLogController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

router.get('/', verifyToken, verifyRole('school_admin'), controller.list);

module.exports = router;
