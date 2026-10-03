const express = require('express');
const router = express.Router();
const controller = require('../controllers/paymentController');
const publicController = require('../controllers/publicPaymentController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');
const { webhookRateLimit } = require('../middleware/authRateLimit');

router.get('/', verifyToken, controller.list);
router.post('/', verifyToken, verifyRole('school_admin'), controller.create);
router.post('/:id/void', verifyToken, verifyRole('school_admin'), controller.voidPayment);

// Public: Paystack calls this directly, no session. Matches the spec's own
// suggested route (`POST /api/payments/webhook`) rather than nesting it
// under /api/public, since a gateway webhook isn't really "public" in the
// same sense as the parent checkout endpoints — it's provider-to-server.
router.post('/webhook', webhookRateLimit, publicController.webhook);

module.exports = router;
