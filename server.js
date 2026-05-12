const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const Pusher = require("pusher");

const app = express();
app.use(cors());
app.use(express.json());
const fs = require("fs");

// Create MySQL CONNECTION POOL - FIXED SSL CERTIFICATE ISSUE
const db = mysql.createPool({
  host: "mysql-3e840356-iubaub4-5ef3.h.aivencloud.com",
  port: 13853,
  user: "avnadmin",
  password: "AVNS_k2C0gQBrf_AR4GFV6G0",
  database: "realtime_monitoring",
  ssl: {
    ca: fs.readFileSync("./ca.pem"),

    rejectUnauthorized: true, // THIS FIXES THE SSL CERTIFICATE ERROR
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Test connection
db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Database connection failed:", err);
  } else {
    console.log("✅ Connected to Aiven MySQL database");
    connection.release();
  }
});

// Pusher setup
const pusher = new Pusher({
  appId: "2153708",
  key: "32be18924a54faaf0cb6",
  secret: "09eed306de2e869d4782",
  cluster: "ap1",
  useTLS: true,
});

console.log("🔌 Pusher configured");

// Receive location from mobile
app.post("/api/locations", (req, res) => {
  const { device_id, latitude, longitude, accuracy, speed, battery_level } =
    req.body;

  console.log("📍 Received location:", { device_id, latitude, longitude });

  const sql =
    "INSERT INTO locations (device_id, latitude, longitude, accuracy, speed, battery_level, timestamp) VALUES (?, ?, ?, ?, ?, ?, NOW())";

  db.query(
    sql,
    [
      device_id,
      latitude,
      longitude,
      accuracy || null,
      speed || null,
      battery_level || null,
    ],
    (err, result) => {
      if (err) {
        console.error("❌ Database error:", err);
        return res.status(500).json({ error: err.message });
      }

      // Send real-time update via Pusher
      pusher.trigger("locations", "LocationUpdated", {
        id: result.insertId,
        device_id,
        latitude,
        longitude,
        accuracy,
        speed,
        battery_level,
        timestamp: new Date(),
      });

      console.log("✅ Location saved and broadcasted");
      res.json({ success: true, id: result.insertId });
    },
  );
});

// Get locations
app.get("/api/locations", (req, res) => {
  const limit = req.query.limit || 100;
  const deviceId = req.query.device_id;

  let sql = "SELECT * FROM locations ORDER BY timestamp DESC LIMIT ?";
  let params = [parseInt(limit)];

  if (deviceId && deviceId !== "all") {
    sql =
      "SELECT * FROM locations WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?";
    params = [deviceId, parseInt(limit)];
  }

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("❌ Query error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, data: results });
  });
});

// Get devices
app.get("/api/devices", (req, res) => {
  db.query(
    "SELECT DISTINCT device_id FROM locations ORDER BY device_id",
    (err, results) => {
      if (err) {
        console.error("❌ Devices query error:", err);
        return res.status(500).json({ error: err.message });
      }
      const devices = results.map((r) => r.device_id);
      res.json({ success: true, data: devices });
    },
  );
});

// Health check
app.get("/api/health", (req, res) => {
  db.query("SELECT 1", (err, results) => {
    if (err) {
      console.error("❌ Health check failed:", err);
      return res
        .status(500)
        .json({ status: "error", db: "disconnected", error: err.message });
    }
    res.json({ status: "ok", db: "connected", timestamp: new Date() });
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    status: "GPS Tracking API",
    endpoints: [
      "POST /api/locations - Send location",
      "GET /api/locations - Get locations",
      "GET /api/devices - Get devices",
      "GET /api/health - Health check",
    ],
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 API URL: http://localhost:${PORT}/api`);
  console.log(`✅ Database: realtime_monitoring`);
  console.log(`🔌 Pusher Key: 32be18924a54faaf0cb6`);
});

// Handle process termination
process.on("SIGINT", () => {
  console.log("Shutting down gracefully...");
  db.end(() => {
    console.log("Database connections closed");
    process.exit(0);
  });
});
