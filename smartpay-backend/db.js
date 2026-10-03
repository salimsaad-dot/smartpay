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
    ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000
});

pool.on('error', (err) => {
    console.error('MySQL pool error:', err.code, err.message);
});

console.log('SmartPay MySQL pool created successfully.');

module.exports = pool;
