const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const academicYearRoutes = require('./routes/academicYearRoutes');
const termRoutes = require('./routes/termRoutes');
const classRoutes = require('./routes/classRoutes');
const parentRoutes = require('./routes/parentRoutes');
const studentRoutes = require('./routes/studentRoutes');

const app = express();

// Same overrides as Academia Hub, same reasoning: this is a pure JSON API
// consumed by a separate frontend origin, not a server serving its own
// HTML — helmet's default CSP is built for the latter and adds nothing
// here, and crossOriginResourcePolicy needs loosening so the frontend can
// actually load anything cross-origin.
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
}));

// Cookie-based auth requires credentials:true + a specific origin — the
// wildcard default can't carry cookies cross-origin, and browsers reject
// credentials:true paired with origin:'*' outright. This stays
// credentialed + explicit-allowlist for this authenticated app; the
// public, no-account parent payment-link flow (a later phase) will need
// its own separate, non-credentialed public route group rather than
// bending this one.
const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3100',
];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'success', message: 'SmartPay API is running.' });
});

app.use('/api/auth', authRoutes);
app.use('/api/academic-years', academicYearRoutes);
app.use('/api/terms', termRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/parents', parentRoutes);
app.use('/api/students', studentRoutes);

app.use((req, res) => {
    res.status(404).json({ status: 'error', message: 'Not found.' });
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(400).json({ status: 'error', message: err.message || 'Something went wrong.' });
});

const PORT = process.env.PORT || 5100;
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`SmartPay server is running on port ${PORT}`);
    });
}

module.exports = app;
