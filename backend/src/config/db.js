const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required for hosted Supabase Postgres
  max: 15,
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};