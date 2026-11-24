const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./config/db');
const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const resourceRoutes = require('./routes/resources');
const bookingRoutes = require('./routes/bookings');
const statsRoutes = require('./routes/stats');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/api/health', async (req, res, next) => {
  try {
    const result = await db.query('SELECT NOW() AS db_time');
    res.json({ status: 'ok', dbTime: result.rows[0].db_time });
  } catch (err) {
    next(err);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api', statsRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));