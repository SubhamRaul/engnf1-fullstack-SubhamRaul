const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { mapUser } = require('../utils/mappers');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (name.length < 2 || name.length > 50)
      throw new AppError(400, 'VALIDATION_ERROR', 'Name must be 2 to 50 characters');
    if (!EMAIL_RE.test(email) || email.length > 254)
      throw new AppError(400, 'VALIDATION_ERROR', 'Valid email up to 254 characters is required');
    if (password.length < 8 || password.length > 64 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
      throw new AppError(400, 'VALIDATION_ERROR', 'Password must be 8-64 chars with >=1 letter and >=1 digit');

    const exists = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (exists.rows.length) throw new AppError(409, 'CONFLICT', 'Email already registered');

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'USER') RETURNING id, name, email, role, created_at`,
      [name, email, hash]
    );
    res.status(201).json({ user: mapUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!email || !password) throw new AppError(400, 'VALIDATION_ERROR', 'Email and password are required');

    const { rows } = await db.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
    if (!rows.length) throw new AppError(401, 'UNAUTHENTICATED', 'Invalid email or password');

    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) throw new AppError(401, 'UNAUTHENTICATED', 'Invalid email or password');

    const token = jwt.sign({ userId: rows[0].id, role: rows[0].role }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: mapUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: mapUser(req.user) });
});

module.exports = router;