const pool = require('../db');

exports.list = async (req, res) => {
    try {
        const { action, entityType, startDate, endDate } = req.query;
        const params = [req.user.schoolId];
        let sql = `
            SELECT al.*, u.name AS user_name
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.school_id = ?`;
        if (action) { sql += ' AND al.action = ?'; params.push(action); }
        if (entityType) { sql += ' AND al.entity_type = ?'; params.push(entityType); }
        if (startDate) { sql += ' AND DATE(al.created_at) >= ?'; params.push(startDate); }
        if (endDate) { sql += ' AND DATE(al.created_at) <= ?'; params.push(endDate); }
        sql += ' ORDER BY al.created_at DESC LIMIT 200';

        const [logs] = await pool.query(sql, params);
        res.status(200).json({ status: 'success', data: logs });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Server error while fetching audit logs.' });
    }
};
