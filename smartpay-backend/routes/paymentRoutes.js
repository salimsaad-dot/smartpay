const express = require('express');
const router = express.Router();
const controller = require('../controllers/paymentController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

router.get('/', verifyToken, controller.list);
router.post('/', verifyToken, verifyRole('school_admin'), controller.create);
router.post('/:id/void', verifyToken, verifyRole('school_admin'), controller.voidPayment);

module.exports = router;
