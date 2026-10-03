const express = require('express');
const router = express.Router();
const controller = require('../controllers/parentController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

router.get('/', verifyToken, controller.list);
router.post('/', verifyToken, verifyRole('school_admin'), controller.create);
router.get('/:id', verifyToken, controller.getById);
router.patch('/:id', verifyToken, verifyRole('school_admin'), controller.update);
router.post('/:id/payment-link', verifyToken, verifyRole('school_admin'), controller.generatePaymentLink);

module.exports = router;
