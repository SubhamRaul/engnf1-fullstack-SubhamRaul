const express = require('express');
const db = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { mapBooking } = require('../utils/mappers');

const router = express.Router();
router.use(requireAuth);

const BOOKING_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

function isValidHalfHourUtc(date) {
  return (
    (date.getUTCMinutes() === 0 || date.getUTCMinutes() === 30) &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

// Endpoint 14: POST /api/bookings (Atomic & Race-Safe)
router.post('/', async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const resourceId = Number(req.body.resourceId);
    const ticketId = req.body.ticketId !== undefined && req.body.ticketId !== null && req.body.ticketId !== ''
      ? Number(req.body.ticketId)
      : null;
    const purpose = typeof req.body.purpose === 'string' ? req.body.purpose.trim() : '';
    const start = new Date(req.body.startTime);
    const end = new Date(req.body.endTime);

    // 1. Validate request payload (400)
    if (!Number.isInteger(resourceId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Valid resourceId is required');
    }
    if (ticketId !== null && !Number.isInteger(ticketId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid ticketId');
    }
    if (purpose.length < 5 || purpose.length > 200) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Purpose must be 5 to 200 characters');
    }
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Valid ISO 8601 UTC startTime and endTime are required');
    }
    if (!isValidHalfHourUtc(start) || !isValidHalfHourUtc(end)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Times must fall on :00 or :30 UTC with 0 seconds/ms');
    }

    const durationMinutes = (end - start) / 60000;
    if (durationMinutes < 30 || durationMinutes > 240) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Duration must be between 30 and 240 minutes');
    }

    const now = new Date();
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (start <= now || start > thirtyDaysAhead) {
      throw new AppError(400, 'VALIDATION_ERROR', 'startTime must be in the future and at most 30 days ahead');
    }

    // 2. Open transaction + lock resource & user rows for race safety
    await client.query('BEGIN');

    const resourceRes = await client.query(
      'SELECT id, is_active FROM resources WHERE id = $1 FOR UPDATE',
      [resourceId]
    );
    if (resourceRes.rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Resource not found');
    }

    if (ticketId !== null) {
      const ticketRes = await client.query('SELECT id FROM tickets WHERE id = $1', [ticketId]);
      if (ticketRes.rows.length === 0) {
        throw new AppError(404, 'NOT_FOUND', 'Referenced ticket not found');
      }
    }

    if (!resourceRes.rows[0].is_active) {
      throw new AppError(409, 'CONFLICT', 'Cannot book an inactive resource');
    }

    // Lock user row so simultaneous requests cannot bypass the max-3 booking rule
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);

    const userBookingCount = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM bookings
       WHERE user_id = $1 AND status IN ('PENDING', 'APPROVED') AND start_time > NOW()`,
      [req.user.id]
    );
    if (userBookingCount.rows[0].cnt >= 3) {
      throw new AppError(409, 'CONFLICT', 'Maximum 3 future PENDING/APPROVED bookings allowed per user');
    }

    // Overlap rule: newStart < existingEnd AND newEnd > existingStart
    const overlapRes = await client.query(
      `SELECT id FROM bookings
       WHERE resource_id = $1
         AND status IN ('PENDING', 'APPROVED')
         AND start_time < $2 AND end_time > $3
       LIMIT 1`,
      [resourceId, end.toISOString(), start.toISOString()]
    );
    if (overlapRes.rows.length > 0) {
      throw new AppError(409, 'CONFLICT', 'Slot overlaps with an existing booking');
    }

    const insertRes = await client.query(
      `INSERT INTO bookings (resource_id, user_id, ticket_id, start_time, end_time, purpose, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
       RETURNING *`,
      [resourceId, req.user.id, ticketId, start.toISOString(), end.toISOString(), purpose]
    );

    await client.query('COMMIT');
    res.status(201).json(mapBooking(insertRes.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// Endpoint 15: GET /api/bookings/mine (IMPORTANT: must be above /:id)
router.get('/mine', async (req, res, next) => {
  try {
    const { status } = req.query;
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = 10;

    if (!Number.isInteger(page) || page < 1) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid page');
    if (status && !BOOKING_STATUSES.includes(status)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid status');

    const params = [req.user.id];
    let where = 'WHERE user_id = $1';
    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }

    const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM bookings ${where}`, params);
    const total = countRes.rows[0].total;

    params.push(pageSize, (page - 1) * pageSize);
    const rowsRes = await db.query(
      `SELECT * FROM bookings ${where}
       ORDER BY start_time DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: rowsRes.rows.map(mapBooking),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

// Endpoint 17: GET /api/bookings (ADMIN only)
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { status, resourceId, from, to } = req.query;
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = 10;

    if (!Number.isInteger(page) || page < 1) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid page');
    if (status && !BOOKING_STATUSES.includes(status)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid status');

    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (resourceId) {
      const rid = Number(resourceId);
      if (!Number.isInteger(rid)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid resourceId');
      params.push(rid);
      conditions.push(`resource_id = $${params.length}`);
    }
    if (from) {
      const f = new Date(from);
      if (isNaN(f.getTime())) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid from date');
      params.push(f.toISOString());
      conditions.push(`end_time > $${params.length}`);
    }
    if (to) {
      const t = new Date(to);
      if (isNaN(t.getTime())) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid to date');
      params.push(t.toISOString());
      conditions.push(`start_time < $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM bookings ${whereClause}`, params);
    const total = countRes.rows[0].total;

    params.push(pageSize, (page - 1) * pageSize);
    const rowsRes = await db.query(
      `SELECT * FROM bookings ${whereClause}
       ORDER BY start_time DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: rowsRes.rows.map(mapBooking),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

// Endpoint 16: GET /api/bookings/:id (Owner or ADMIN)
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new AppError(404, 'NOT_FOUND', 'Booking not found');

    const result = await db.query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Booking not found');

    const booking = result.rows[0];
    if (req.user.role !== 'ADMIN' && booking.user_id !== req.user.id) {
      throw new AppError(403, 'FORBIDDEN', 'You can only view your own bookings');
    }

    res.json(mapBooking(booking));
  } catch (err) {
    next(err);
  }
});

// Endpoint 18: PATCH /api/bookings/:id/cancel (Owner only)
router.patch('/:id/cancel', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new AppError(404, 'NOT_FOUND', 'Booking not found');

    const result = await db.query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Booking not found');

    const booking = result.rows[0];
    if (booking.user_id !== req.user.id) {
      throw new AppError(403, 'FORBIDDEN', 'Only the booking owner can cancel');
    }
    if (!['PENDING', 'APPROVED'].includes(booking.status) || new Date(booking.start_time) <= new Date()) {
      throw new AppError(409, 'CONFLICT', 'Only future PENDING or APPROVED bookings can be cancelled');
    }

    const updated = await db.query(
      "UPDATE bookings SET status = 'CANCELLED' WHERE id = $1 RETURNING *",
      [id]
    );
    res.json(mapBooking(updated.rows[0]));
  } catch (err) {
    next(err);
  }
});

// Endpoint 19: PATCH /api/bookings/:id/approve (ADMIN only)
router.patch('/:id/approve', requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new AppError(404, 'NOT_FOUND', 'Booking not found');

    const result = await db.query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Booking not found');

    const booking = result.rows[0];
    if (booking.status !== 'PENDING' || new Date(booking.start_time) <= new Date()) {
      throw new AppError(409, 'CONFLICT', 'Only future PENDING bookings can be approved');
    }

    const updated = await db.query(
      "UPDATE bookings SET status = 'APPROVED' WHERE id = $1 RETURNING *",
      [id]
    );
    res.json(mapBooking(updated.rows[0]));
  } catch (err) {
    next(err);
  }
});

// Endpoint 20: PATCH /api/bookings/:id/reject (ADMIN only)
router.patch('/:id/reject', requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new AppError(404, 'NOT_FOUND', 'Booking not found');

    const result = await db.query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Booking not found');

    // Validation (400) before transition conflict (409)
    const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
    if (note.length < 5 || note.length > 200) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Rejection note must be 5 to 200 characters');
    }

    const booking = result.rows[0];
    if (booking.status !== 'PENDING' || new Date(booking.start_time) <= new Date()) {
      throw new AppError(409, 'CONFLICT', 'Only future PENDING bookings can be rejected');
    }

    const updated = await db.query(
      "UPDATE bookings SET status = 'REJECTED', decision_note = $1 WHERE id = $2 RETURNING *",
      [note, id]
    );
    res.json(mapBooking(updated.rows[0]));
  } catch (err) {
    next(err);
  }
});

module.exports = router;