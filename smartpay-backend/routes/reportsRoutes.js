const express = require('express');
const router = express.Router();
const controller = require('../controllers/reportsController');
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/collection-summary', verifyToken, controller.collectionSummary);
router.get('/outstanding-fees', verifyToken, controller.outstandingFees);
router.get('/payment-history', verifyToken, controller.paymentHistory);
router.get('/invoices', verifyToken, controller.invoiceReport);
router.get('/sms-activity', verifyToken, controller.smsActivity);
router.get('/student-statement/:studentId', verifyToken, controller.studentStatement);
router.get('/parent-statement/:parentId', verifyToken, controller.parentStatement);

module.exports = router;
