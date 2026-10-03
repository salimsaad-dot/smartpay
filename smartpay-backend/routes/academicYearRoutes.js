const express = require('express');
const router = express.Router();
const controller = require('../controllers/academicYearController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

router.get('/', verifyToken, controller.list);
router.post('/', verifyToken, verifyRole('school_admin'), controller.create);
router.patch('/:id/set-current', verifyToken, verifyRole('school_admin'), controller.setCurrent);

module.exports = router;
