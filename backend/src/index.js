const express = require("express");
const { query } = require("./config/db");
const cors = require('cors');

const authRoutes = require('./routes/auth');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.use('/api/auth', authRoutes);
app.use(errorHandler);

app.listen(port, async () => {
  try {
    await query("SELECT 1");
    console.log("Database connected");
    console.log(`Server is running on port ${port}`);
  } catch (error) {
    console.error("Database connection failed:", error.message);
  }
});