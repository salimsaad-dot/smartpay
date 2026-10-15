const express = require('express');
const controller = require('../controllers/platformController');
const { verifyPlatformAdmin } = require('../middleware/platformAuth');
const { loginRateLimit } = require('../middleware/authRateLimit');

const router = express.Router();

// The SmartPay owner console. Only platform_admins can use these.
router.post('/auth/login', loginRateLimit, controller.login);
router.post('/auth/logout', controller.logout);
router.get('/auth/me', verifyPlatformAdmin, controller.getMe);

router.get('/schools', verifyPlatformAdmin, controller.listSchools);
router.post('/schools', verifyPlatformAdmin, controller.createSchool);
router.patch('/schools/:id', verifyPlatformAdmin, controller.updateSchool);
router.post('/schools/:id/reset-admin-password', verifyPlatformAdmin, controller.resetAdminPassword);

module.exports = router;
