const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { AppError } = require('./errorHandler');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Missing or invalid token'));
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const { rows } = await db.query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [payload.userId]
    );
    if (!rows.length) return next(new AppError(401, 'UNAUTHENTICATED', 'User not found'));
    req.user = rows[0];
    next();
  } catch {
    next(new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN') {
    return next(new AppError(403, 'FORBIDDEN', 'Admin access required'));
  }
  next();
}

module.exports = { requireAuth, requireAdmin };