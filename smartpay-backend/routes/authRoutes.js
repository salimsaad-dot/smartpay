const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const { loginRateLimit, registerRateLimit } = require('../middleware/authRateLimit');

router.post('/register-school', registerRateLimit, authController.registerSchool);
router.post('/login', loginRateLimit, authController.login);
router.post('/logout', authController.logout);
router.get('/me', verifyToken, authController.getMe);
// Public — no session exists yet when these run. Rate-limited for the
// same reason /login is: forgot-password can be used to spam a target's
// inbox, and reset-password guards a real (if cryptographically strong)
// token against brute-force guessing.
router.post('/forgot-password', loginRateLimit, authController.forgotPassword);
router.post('/reset-password', loginRateLimit, authController.resetPasswordWithToken);
router.post('/change-password', verifyToken, loginRateLimit, authController.changePassword);
router.post('/revoke-sessions', verifyToken, authController.revokeSessions);

module.exports = router;
