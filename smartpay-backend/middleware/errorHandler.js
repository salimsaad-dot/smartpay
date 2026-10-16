// Last-resort error handler. Known client mistakes keep their status and a
// safe message; anything else is a server fault: logged in full here, but
// the caller gets a plain 500 with no internal details (2026-10-16; this
// used to send err.message back with 400 for every error).
module.exports = function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
    if (err.message === 'Not allowed by CORS') {
        return res.status(400).json({ status: 'error', message: 'Not allowed by CORS' });
    }
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ status: 'error', message: 'The request body is not valid JSON.' });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ status: 'error', message: 'The request is too large.' });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ status: 'error', message: 'Something went wrong on our side. Please try again.' });
};
