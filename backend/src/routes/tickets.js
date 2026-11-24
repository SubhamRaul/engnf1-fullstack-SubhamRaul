const express = require('express');
const db = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { classifyTicket } = require('../utils/classifier');
const { mapTicket, mapTicketEvent } = require('../utils/mappers');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['BILLING', 'BUG', 'FEATURE_REQUEST', 'LOGIN', 'DELIVERY'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

// Endpoint 4: POST /api/tickets/import
router.post('/import', async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const tickets = req.body.tickets;
    if (!Array.isArray(tickets)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Request body must include a tickets array');
    }

    let importedCount = 0;
    let updatedCount = 0;
    let skippedOverrideCount = 0;

    await client.query('BEGIN');

    for (const item of tickets) {
      const externalId = typeof item.externalId === 'string' ? item.externalId.trim() : '';
      const subject = typeof item.subject === 'string' ? item.subject.trim() : '';
      const body = typeof item.body === 'string' ? item.body.trim() : '';

      if (!externalId || subject.length < 3 || subject.length > 150 || body.length < 5 || body.length > 2000) {
        throw new AppError(400, 'VALIDATION_ERROR', `Invalid ticket fields for externalId: ${externalId || 'missing'}`);
      }

      const { category, priority } = classifyTicket(subject, body);
      const found = await client.query('SELECT * FROM tickets WHERE external_id = $1 FOR UPDATE', [externalId]);

      if (found.rows.length === 0) {
        // Brand new ticket
        await client.query(
          `INSERT INTO tickets (external_id, subject, body, auto_category, category, priority)
           VALUES ($1, $2, $3, $4, $4, $5)`,
          [externalId, subject, body, category, priority]
        );
        importedCount++;
      } else {
        const existing = found.rows[0];
        if (existing.is_human_override) {
          // Human override protection: NEVER overwrite category; only sync subject/body if changed
          if (existing.subject !== subject || existing.body !== body) {
            await client.query(
              'UPDATE tickets SET subject = $1, body = $2, updated_at = NOW() WHERE id = $3',
              [subject, body, existing.id]
            );
          }
          skippedOverrideCount++;
        } else {
          // Safe to re-classify since no human has overridden it (auto_category stays immutable)
          await client.query(
            `UPDATE tickets
             SET subject = $1, body = $2, category = $3, priority = $4, updated_at = NOW()
             WHERE id = $5`,
            [subject, body, category, priority, existing.id]
          );
          updatedCount++;
        }
      }
    }

    await client.query('COMMIT');
    res.json({ importedCount, updatedCount, skippedOverrideCount, total: tickets.length });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// Endpoint 5: GET /api/tickets
router.get('/', async (req, res, next) => {
  try {
    const { status, category, priority, q } = req.query;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);

    if (!Number.isInteger(page) || page < 1) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid page');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid limit');
    if (status && !STATUSES.includes(status)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid status');
    if (category && !CATEGORIES.includes(category)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid category');
    if (priority && !PRIORITIES.includes(priority)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid priority');

    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (priority) {
      params.push(priority);
      conditions.push(`priority = $${params.length}`);
    }
    if (typeof q === 'string' && q.trim() !== '') {
      params.push(`%${escapeLike(q.trim())}%`);
      conditions.push(`(subject ILIKE $${params.length} ESCAPE '\\' OR body ILIKE $${params.length} ESCAPE '\\')`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM tickets ${whereClause}`, params);
    const total = countRes.rows[0].total;

    params.push(limit, (page - 1) * limit);
    const rowsRes = await db.query(
      `SELECT * FROM tickets ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: rowsRes.rows.map(mapTicket),
      page,
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

// Endpoint 6: GET /api/tickets/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new AppError(404, 'NOT_FOUND', 'Ticket not found');

    const ticketRes = await db.query('SELECT * FROM tickets WHERE id = $1', [id]);
    if (ticketRes.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Ticket not found');

    const eventsRes = await db.query(
      'SELECT * FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at DESC, id DESC',
      [id]
    );

    res.json({
      ticket: mapTicket(ticketRes.rows[0]),
      events: eventsRes.rows.map(mapTicketEvent),
    });
  } catch (err) {
    next(err);
  }
});

// Endpoint 7: PATCH /api/tickets/:id
router.patch('/:id', async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new AppError(404, 'NOT_FOUND', 'Ticket not found');

    await client.query('BEGIN');

    // Step 1: Check 404 (path id)
    const found = await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [id]);
    if (found.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Ticket not found');
    const current = found.rows[0];

    // Step 2: Validate fields (422)
    const { category, priority, status, assigneeId } = req.body;
    if (category !== undefined && !CATEGORIES.includes(category)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Invalid category value');
    }
    if (priority !== undefined && !PRIORITIES.includes(priority)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Invalid priority value');
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Invalid status value');
    }

    // Step 3: Validate referenced assigneeId (404)
    if (assigneeId !== undefined && assigneeId !== null) {
      const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [assigneeId]);
      if (userCheck.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Assignee not found');
    }

    const nextCategory = category !== undefined ? category : current.category;
    const nextPriority = priority !== undefined ? priority : current.priority;
    const nextStatus = status !== undefined ? status : current.status;
    const nextAssignee = assigneeId !== undefined ? assigneeId : current.assignee_id;

    const categoryChanged = nextCategory !== current.category;
    const statusLeftOpen = current.status === 'OPEN' && nextStatus !== 'OPEN';

    const nextHumanOverride = current.is_human_override || categoryChanged;
    const nextReviewed = current.is_reviewed || categoryChanged || statusLeftOpen;

    const updated = await client.query(
      `UPDATE tickets
       SET category = $1, priority = $2, status = $3, assignee_id = $4,
           is_human_override = $5, is_reviewed = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [nextCategory, nextPriority, nextStatus, nextAssignee, nextHumanOverride, nextReviewed, id]
    );

    const actor = (req.headers['x-agent'] || req.user.email).toString().trim();
    const fieldsToCheck = [
      ['category', current.category, nextCategory],
      ['priority', current.priority, nextPriority],
      ['status', current.status, nextStatus],
      ['assigneeId', current.assignee_id, nextAssignee],
    ];

    for (const [field, oldVal, newVal] of fieldsToCheck) {
      if (String(oldVal ?? '') !== String(newVal ?? '')) {
        await client.query(
          `INSERT INTO ticket_events (ticket_id, field, old_value, new_value, actor)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, field, oldVal === null ? null : String(oldVal), newVal === null ? null : String(newVal), actor]
        );
      }
    }

    const eventsRes = await client.query(
      'SELECT * FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at DESC, id DESC',
      [id]
    );

    await client.query('COMMIT');
    res.json({
      ticket: mapTicket(updated.rows[0]),
      events: eventsRes.rows.map(mapTicketEvent),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;