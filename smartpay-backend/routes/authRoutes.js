const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const { loginRateLimit, registerRateLimit } = require('../middleware/authRateLimit');

router.post('/register-school', registerRateLimit, authController.registerSchool);
router.post('/login', loginRateLimit, authController.login);
router.post('/logout', authController.logout);
router.get('/me', verifyToken, authController.getMe);

module.exports = router;
