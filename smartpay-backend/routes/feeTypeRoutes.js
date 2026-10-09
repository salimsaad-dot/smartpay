const express = require('express');
const router = express.Router();
const controller = require('../controllers/feeTypeController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

router.get('/', verifyToken, controller.list);
router.post('/', verifyToken, verifyRole('school_admin'), controller.create);
router.patch('/:id/status', verifyToken, verifyRole('school_admin'), controller.updateStatus);
router.patch('/:id/applicability', verifyToken, verifyRole('school_admin'), controller.updateApplicability);
router.get('/:id/eligibility', verifyToken, controller.listEligibility);
router.put('/:id/eligibility', verifyToken, verifyRole('school_admin'), controller.updateEligibility);

module.exports = router;
