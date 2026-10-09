const express = require('express');
const router = express.Router();
const controller = require('../controllers/invoiceController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

router.get('/', verifyToken, controller.list);
router.get('/generation-preview', verifyToken, controller.previewGeneration);
router.post('/generate', verifyToken, verifyRole('school_admin'), controller.generate);
router.get('/:id', verifyToken, controller.getById);

module.exports = router;
