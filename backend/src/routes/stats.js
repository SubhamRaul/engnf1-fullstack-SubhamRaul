const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

async function buildTicketStats() {
  const [catRes, priRes, stRes, reviewRes] = await Promise.all([
    db.query('SELECT category, COUNT(*)::int AS cnt FROM tickets GROUP BY category'),
    db.query('SELECT priority, COUNT(*)::int AS cnt FROM tickets GROUP BY priority'),
    db.query('SELECT status, COUNT(*)::int AS cnt FROM tickets GROUP BY status'),
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE is_reviewed = TRUE)::int AS reviewed_count,
        COUNT(*) FILTER (WHERE is_reviewed = TRUE AND category = auto_category)::int AS agreed_count
      FROM tickets
    `),
  ]);

  const byCategory = { BILLING: 0, BUG: 0, FEATURE_REQUEST: 0, LOGIN: 0, DELIVERY: 0 };
  catRes.rows.forEach((r) => { byCategory[r.category] = r.cnt; });

  const byPriority = { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };
  priRes.rows.forEach((r) => { byPriority[r.priority] = r.cnt; });

  const byStatus = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 };
  stRes.rows.forEach((r) => { byStatus[r.status] = r.cnt; });

  const reviewedCount = reviewRes.rows[0].reviewed_count;
  const agreedCount = reviewRes.rows[0].agreed_count;
  const modelAgreementRate = reviewedCount > 0
    ? Number(((agreedCount / reviewedCount) * 100).toFixed(1))
    : 100;

  return { byCategory, byPriority, byStatus, reviewedCount, modelAgreementRate };
}

// Endpoint 8: GET /api/stats
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    res.json(await buildTicketStats());
  } catch (err) {
    next(err);
  }
});

// Endpoint 21: GET /api/admin/stats (ADMIN only)
router.get('/admin/stats', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [activeRes, bookingStatusRes, topResourcesRes, ticketStats] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS cnt FROM resources WHERE is_active = TRUE'),
      db.query('SELECT status, COUNT(*)::int AS cnt FROM bookings GROUP BY status'),
      db.query(`
        SELECT r.id, r.name, r.type, COUNT(b.id)::int AS booking_count
        FROM resources r
        LEFT JOIN bookings b ON b.resource_id = r.id
        GROUP BY r.id
        ORDER BY booking_count DESC, LOWER(r.name) ASC
        LIMIT 3
      `),
      buildTicketStats(),
    ]);

    const bookingsByStatus = { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
    bookingStatusRes.rows.forEach((r) => { bookingsByStatus[r.status] = r.cnt; });

    res.json({
      activeResources: activeRes.rows[0].cnt,
      bookingsByStatus,
      topResources: topResourcesRes.rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        bookingCount: r.booking_count,
      })),
      ticketStats,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;