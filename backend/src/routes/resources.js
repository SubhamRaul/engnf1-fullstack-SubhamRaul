const express = require('express');
const db = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { mapResource } = require('../utils/mappers');

const router = express.Router();
router.use(requireAuth);

const RESOURCE_TYPES = ['ROOM', 'LAB', 'EQUIPMENT'];

// Endpoint 9: GET /api/resources
router.get('/', async (req, res, next) => {
  try {
    const { search, type, minCapacity } = req.query;
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = 10;

    if (!Number.isInteger(page) || page < 1) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid page');
    if (type && !RESOURCE_TYPES.includes(type)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid type');

    let minCap = null;
    if (minCapacity !== undefined && minCapacity !== '') {
      minCap = Number(minCapacity);
      if (!Number.isInteger(minCap) || minCap < 1) {
        throw new AppError(400, 'VALIDATION_ERROR', 'minCapacity must be a positive integer');
      }
    }

    const conditions = [];
    const params = [];

    // USER sees active resources only; ADMIN sees all
    if (req.user.role !== 'ADMIN') {
      conditions.push('is_active = TRUE');
    }
    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }
    if (minCap !== null) {
      params.push(minCap);
      conditions.push(`capacity >= $${params.length}`);
    }
    if (typeof search === 'string' && search.trim() !== '') {
      const escaped = search.trim().replace(/[\\%_]/g, '\\$&');
      params.push(`%${escaped}%`);
      conditions.push(`(name ILIKE $${params.length} ESCAPE '\\' OR COALESCE(description, '') ILIKE $${params.length} ESCAPE '\\')`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM resources ${whereClause}`, params);
    const total = countRes.rows[0].total;

    params.push(pageSize, (page - 1) * pageSize);
    const rowsRes = await db.query(
      `SELECT * FROM resources ${whereClause}
       ORDER BY LOWER(name) ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: rowsRes.rows.map(mapResource),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

// Endpoint 13: GET /api/resources/:id/availability
router.get('/:id/availability', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new AppError(404, 'NOT_FOUND', 'Resource not found');

    const resRow = await db.query('SELECT * FROM resources WHERE id = $1', [id]);
    if (resRow.rows.length === 0 || (req.user.role !== 'ADMIN' && !resRow.rows[0].is_active)) {
      throw new AppError(404, 'NOT_FOUND', 'Resource not found');
    }

    const from = new Date(req.query.from);
    const to = new Date(req.query.to);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Valid ISO UTC from and to (to > from) are required');
    }
    const maxSevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (to - from > maxSevenDaysMs) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Date range cannot exceed 7 days');
    }

    const bookingsRes = await db.query(
      `SELECT start_time, end_time, status
       FROM bookings
       WHERE resource_id = $1
         AND status IN ('PENDING', 'APPROVED')
         AND start_time < $2 AND end_time > $3
       ORDER BY start_time ASC`,
      [id, to.toISOString(), from.toISOString()]
    );

    // Privacy rule: only expose startTime, endTime, status
    res.json({
      resourceId: id,
      from: from.toISOString(),
      to: to.toISOString(),
      bookings: bookingsRes.rows.map((b) => ({
        startTime: b.start_time,
        endTime: b.end_time,
        status: b.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Endpoint 10: GET /api/resources/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new AppError(404, 'NOT_FOUND', 'Resource not found');

    const result = await db.query('SELECT * FROM resources WHERE id = $1', [id]);
    if (result.rows.length === 0 || (req.user.role !== 'ADMIN' && !result.rows[0].is_active)) {
      throw new AppError(404, 'NOT_FOUND', 'Resource not found');
    }

    res.json(mapResource(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

// Endpoint 11: POST /api/resources (ADMIN only)
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const type = req.body.type;
    const capacity = Number(req.body.capacity);
    const description = req.body.description == null ? null : String(req.body.description).trim();

    if (name.length < 3 || name.length > 60) throw new AppError(400, 'VALIDATION_ERROR', 'Name must be 3 to 60 chars');
    if (!RESOURCE_TYPES.includes(type)) throw new AppError(400, 'VALIDATION_ERROR', 'Type must be ROOM, LAB, or EQUIPMENT');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Capacity must be an integer between 1 and 500');
    }
    if (description && description.length > 300) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Description cannot exceed 300 characters');
    }

    const result = await db.query(
      `INSERT INTO resources (name, type, capacity, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, type, capacity, description]
    );

    res.status(201).json(mapResource(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

// Endpoint 12: PATCH /api/resources/:id (ADMIN only)
router.patch('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new AppError(404, 'NOT_FOUND', 'Resource not found');

    const currentRes = await db.query('SELECT * FROM resources WHERE id = $1', [id]);
    if (currentRes.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
    const cur = currentRes.rows[0];

    const name = req.body.name !== undefined ? String(req.body.name).trim() : cur.name;
    const type = req.body.type !== undefined ? req.body.type : cur.type;
    const capacity = req.body.capacity !== undefined ? Number(req.body.capacity) : cur.capacity;
    const description = req.body.description !== undefined
      ? (req.body.description === null ? null : String(req.body.description).trim())
      : cur.description;
    const isActive = req.body.isActive !== undefined ? Boolean(req.body.isActive) : cur.is_active;

    if (name.length < 3 || name.length > 60) throw new AppError(400, 'VALIDATION_ERROR', 'Name must be 3 to 60 chars');
    if (!RESOURCE_TYPES.includes(type)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid type');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Capacity must be an integer between 1 and 500');
    }
    if (description && description.length > 300) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Description cannot exceed 300 characters');
    }

    const updated = await db.query(
      `UPDATE resources
       SET name = $1, type = $2, capacity = $3, description = $4, is_active = $5
       WHERE id = $6
       RETURNING *`,
      [name, type, capacity, description, isActive, id]
    );

    res.json(mapResource(updated.rows[0]));
  } catch (err) {
    next(err);
  }
});

module.exports = router;