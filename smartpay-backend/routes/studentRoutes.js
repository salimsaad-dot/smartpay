const express = require('express');
const router = express.Router();
const controller = require('../controllers/studentController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

router.get('/', verifyToken, controller.list);
router.post('/', verifyToken, verifyRole('school_admin'), controller.create);
router.post('/bulk-enroll', verifyToken, verifyRole('school_admin'), controller.bulkEnroll);
router.get('/:id', verifyToken, controller.getById);
router.post('/:id/parents', verifyToken, verifyRole('school_admin'), controller.linkParent);
router.delete('/:id/parents/:parentId', verifyToken, verifyRole('school_admin'), controller.unlinkParent);

module.exports = router;
