const mysql = require('mysql2/promise');
require('dotenv').config();

// Same opt-in SSL pattern as Academia Hub: local dev (XAMPP) doesn't need
// it, a managed production host (Aiven/PlanetScale/etc.) will require it.
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    // With DB_CA_CERT (Aiven's CA certificate, PEM text) the server's
    // certificate is verified; without it the connection is still encrypted
    // but not verified, which startup warns about (utils/config.js).
    ...(process.env.DB_SSL === 'true'
        ? { ssl: process.env.DB_CA_CERT ? { ca: process.env.DB_CA_CERT.replace(/\\n/g, '\n'), rejectUnauthorized: true } : { rejectUnauthorized: false } }
        : {}),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000
});

// Every connection uses UTC, so CURDATE()/NOW() (subscription end dates,
// reminder cycles, reconciliation windows) mean the same thing locally and
// on Aiven. Ghana is UTC+0, so school dates are unaffected.
pool.pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
});

pool.on('error', (err) => {
    console.error('MySQL pool error:', err.code, err.message);
});

console.log('SmartPay MySQL pool created successfully.');

module.exports = pool;
