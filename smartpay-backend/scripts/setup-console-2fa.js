// Turns on (or replaces) the owner console's second login step: an
// authenticator app on your phone (Google Authenticator, Microsoft
// Authenticator, Authy...). Like create-platform-admin.js there is no
// screen for this on purpose: only someone with database access can set
// it up or reset it, so a stolen password can't be used to enrol the
// thief's own phone.
//
// Usage:  node scripts/setup-console-2fa.js you@example.com
// It shows a QR code (and the same key as text), asks for the 6-digit
// code your app then shows, and saves only if that code is right. Lost
// your phone? Run it again: the old phone stops working and every console
// session is signed out.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const readline = require('readline');
const QRCode = require('qrcode');
const pool = require('../db');
const totp = require('../utils/totp');

const [email] = process.argv.slice(2);
let qrImage = null;
process.on('exit', () => { if (qrImage) fs.rmSync(qrImage, { force: true }); });

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

(async () => {
    if (!email?.includes('@')) {
        console.error('Usage: node scripts/setup-console-2fa.js you@example.com');
        process.exit(1);
    }
    const normalizedEmail = email.trim().toLowerCase();
    const [[admin]] = await pool.query('SELECT id FROM platform_admins WHERE email = ?', [normalizedEmail]);
    if (!admin) {
        console.error(`No console login for ${normalizedEmail} (database: ${process.env.DB_NAME}). Create it first with create-platform-admin.js.`);
        process.exit(1);
    }

    const secret = totp.generateSecret();
    console.log('\nIn your authenticator app, add an account and scan this QR code:\n');
    console.log(await QRCode.toString(totp.otpauthUri(normalizedEmail, secret), { type: 'terminal', small: true }));
    console.log(`Can't scan it? Choose "Enter a setup key" and type:\n\n    ${secret.match(/.{1,4}/g).join(' ')}\n`);

    // Terminal QR codes often don't scan (fonts, line spacing), so also open
    // a real image. It holds the secret, so it's deleted when the script ends.
    qrImage = path.join(os.tmpdir(), `smartpay-console-2fa-${process.pid}.png`);
    await QRCode.toFile(qrImage, totp.otpauthUri(normalizedEmail, secret), { width: 360, margin: 2 });
    const opener = process.platform === 'win32' ? `start "" "${qrImage}"` : process.platform === 'darwin' ? `open "${qrImage}"` : `xdg-open "${qrImage}"`;
    exec(opener, () => {});
    console.log('A larger QR code has also opened in an image window. Scan that one with your phone.\n');

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const code = await ask('Enter the 6-digit code the app shows now: ');
        const step = totp.verify(secret, code);
        if (step !== null) {
            await pool.query(
                'UPDATE platform_admins SET totp_secret = ?, totp_last_step = ?, token_version = token_version + 1 WHERE id = ?',
                [secret, step, admin.id]
            );
            console.log(`\nTwo-step login is on for ${normalizedEmail} (database: ${process.env.DB_NAME}). Old console sessions were signed out.`);
            process.exit(0);
        }
        console.log("That code didn't match. Check the app shows \"SmartPay console\" and try the newest code.");
    }
    console.error('Nothing was changed.');
    process.exit(1);
})().catch((error) => {
    console.error('Failed:', error.message);
    process.exit(1);
});
