const express = require('express');
const router = express.Router();
const controller = require('../controllers/arrearsController');
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/', verifyToken, controller.list);

module.exports = router;
