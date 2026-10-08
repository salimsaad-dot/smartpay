const express = require('express');
const router = express.Router();
const controller = require('../controllers/intelligenceController');
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/financial-summary', verifyToken, controller.getFinancialSummary);

module.exports = router;
