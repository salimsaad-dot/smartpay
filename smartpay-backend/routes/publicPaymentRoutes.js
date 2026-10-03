const express = require('express');
const router = express.Router();
const controller = require('../controllers/publicPaymentController');
const { publicPaymentRateLimit } = require('../middleware/authRateLimit');

// No verifyToken anywhere in this file — this is the whole point of
// SmartPay's parent journey: SMS link -> checkout -> pay, no account.
// Tenant/parent scoping comes entirely from the token itself, never from
// anything the client supplies (see resolveLink in the controller).
router.get('/checkout/:token', publicPaymentRateLimit, controller.getCheckout);
router.post('/payments/initialize', publicPaymentRateLimit, controller.initializePayment);
router.get('/payments/:reference/status', publicPaymentRateLimit, controller.getPaymentStatus);

module.exports = router;
