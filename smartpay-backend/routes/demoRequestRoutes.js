const express = require('express');
const { submitDemoRequest } = require('../controllers/demoRequestController');
const { demoRequestRateLimit } = require('../middleware/authRateLimit');

const router = express.Router();

// Public: the marketing site's "Book a demo" form. No auth by design.
router.post('/', demoRequestRateLimit, submitDemoRequest);

module.exports = router;
