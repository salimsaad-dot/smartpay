const pool = require('../db');
// Called through the module object, not destructured, so tests can
// jest.spyOn it (same reason as authController.js).
const emailSender = require('../utils/emailSender');

// Public, unauthenticated endpoint behind the SmartPay marketing site's
// "Book a demo" form (added 2026-10-15). Not tenant data: a lead belongs
// to the platform owner, not to any school, so there is no school_id.
// Modelled on Academia Hub's demoRequestController, with one deliberate
// difference: phone is required and email optional, because headmasters
// in Ghana are reached by phone and WhatsApp far more reliably than email.

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Loose on purpose: local (024 123 4567) and international (+233 24...)
// forms, spaces and dashes allowed. Only blocks obvious junk.
const PHONE_SHAPE = /^\+?[0-9][0-9\s-]{6,18}[0-9]$/;
const STUDENT_COUNTS = ['Under 100', '100–300', '300–600', 'Over 600'];
const LIMITS = { schoolName: 150, contactName: 100, role: 50, phone: 30, email: 150, message: 2000 };

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

exports.submitDemoRequest = async (req, res) => {
    try {
        const body = req.body || {};

        // Honeypot: a field hidden from people, which simple bots fill in.
        // Answer as if it worked so the bot learns nothing, but store nothing.
        if (clean(body.website)) {
            return res.status(201).json({ status: 'success', message: 'Demo request received.' });
        }

        const request = {
            schoolName: clean(body.schoolName),
            contactName: clean(body.contactName),
            role: clean(body.role),
            phone: clean(body.phone),
            email: clean(body.email),
            studentCount: clean(body.studentCount),
            message: clean(body.message),
        };

        if (!request.schoolName || !request.contactName || !request.phone) {
            return res.status(400).json({ status: 'error', message: 'School name, your name and a phone number are required.' });
        }
        if (!PHONE_SHAPE.test(request.phone)) {
            return res.status(400).json({ status: 'error', message: 'Please enter a valid phone number.' });
        }
        if (request.email && !EMAIL_SHAPE.test(request.email)) {
            return res.status(400).json({ status: 'error', message: 'Please enter a valid email address, or leave it blank.' });
        }
        if (request.studentCount && !STUDENT_COUNTS.includes(request.studentCount)) {
            return res.status(400).json({ status: 'error', message: 'Please choose a school size from the list.' });
        }
        for (const [field, max] of Object.entries(LIMITS)) {
            if (request[field].length > max) {
                return res.status(400).json({ status: 'error', message: `That entry is too long (max ${max} characters).` });
            }
        }

        await pool.query(
            `INSERT INTO demo_requests (school_name, contact_name, role, phone, email, student_count, message)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [request.schoolName, request.contactName, request.role || null, request.phone,
                request.email || null, request.studentCount || null, request.message || null]
        );

        // Best effort: the lead is already saved, so a failed email must
        // never turn a recorded request into an error for the visitor.
        const notifyTo = process.env.DEMO_NOTIFY_EMAIL;
        if (notifyTo) {
            const result = await emailSender.sendDemoRequestEmail(notifyTo, request).catch(() => ({ delivered: false }));
            if (!result.delivered) console.error('Demo request saved, but the notification email was not delivered.');
        }

        res.status(201).json({ status: 'success', message: 'Demo request received.' });
    } catch (error) {
        console.error('Demo request error:', error);
        res.status(500).json({ status: 'error', message: 'Something went wrong sending your request. Please try WhatsApp or call instead.' });
    }
};

exports.STUDENT_COUNTS = STUDENT_COUNTS;
