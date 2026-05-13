const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const Pusher = require("pusher");
const fs = require("fs");


const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Helper function to convert ISO to MySQL datetime
function toMySQLDateTime(isoString) {
    if (!isoString) return null;
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Create MySQL CONNECTION POOL
const db = mysql.createPool({
  host: "mysql-3e840356-iubaub4-5ef3.h.aivencloud.com",
  port: 13853,
  user: "avnadmin",
  password: "AVNS_k2C0gQBrf_AR4GFV6G0",
  database: "realtime_monitoring",
  ssl: {
    ca: fs.readFileSync("./ca.pem"),
    rejectUnauthorized: true,
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

// ==================== LOCATION ENDPOINTS ====================

// Receive location from mobile (with trip support) - IMPROVED LOGGING
app.post("/api/locations", (req, res) => {
  const { device_id, latitude, longitude, accuracy, speed, battery_level, trip_id, trip_active, trip_name } = req.body;

  console.log("📍 Received location:", { 
    device_id, 
    latitude, 
    longitude, 
    trip_active,
    trip_id: trip_id || 'null'
  });

  const sql = `INSERT INTO locations (device_id, latitude, longitude, accuracy, speed, battery_level, timestamp, trip_id, trip_active) 
               VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)`;

  db.query(
    sql,
    [
      device_id,
      latitude,
      longitude,
      accuracy || null,
      speed || null,
      battery_level || null,
      trip_id || null,
      trip_active || false
    ],
    (err, result) => {
      if (err) {
        console.error("❌ Database error:", err);
        return res.status(500).json({ error: err.message });
      }

      console.log(`✅ Location saved with trip_id: ${trip_id || 'none'}`);
      
      pusher.trigger("locations", "LocationUpdated", {
        id: result.insertId,
        device_id,
        latitude,
        longitude,
        accuracy,
        speed,
        battery_level,
        trip_id: trip_id || null,
        trip_active: trip_active || false,
        trip_name: trip_name || null,
        timestamp: new Date(),
      });

      res.json({ success: true, id: result.insertId });
    },
  );
});

// Get locations with optional trip filter
app.get("/api/locations", (req, res) => {
  const limit = req.query.limit || 100;
  const deviceId = req.query.device_id;
  const tripId = req.query.trip_id;

  let sql = "SELECT * FROM locations ORDER BY timestamp DESC LIMIT ?";
  let params = [parseInt(limit)];

  if (tripId) {
    sql = "SELECT * FROM locations WHERE trip_id = ? ORDER BY timestamp ASC LIMIT ?";
    params = [tripId, parseInt(limit)];
  } else if (deviceId && deviceId !== "all") {
    sql = "SELECT * FROM locations WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?";
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

// ==================== TRIP ENDPOINTS ====================

// Start a trip
app.post("/api/trips/start", (req, res) => {
  const { id, name, startTime, startLat, startLng, device_id } = req.body;
  
  const mysqlStartTime = toMySQLDateTime(startTime);
  
  console.log("🚀 Starting trip:", { id, name, device_id, originalTime: startTime, convertedTime: mysqlStartTime });
  
  const sql = `INSERT INTO trips (trip_id, device_id, name, start_time, start_lat, start_lng, status) 
               VALUES (?, ?, ?, ?, ?, ?, 'active')`;
  
  db.query(sql, [id, device_id, name, mysqlStartTime, startLat, startLng], (err, result) => {
    if (err) {
      console.error("❌ Error starting trip:", err);
      return res.status(500).json({ error: err.message });
    }
    
    pusher.trigger("locations", "TripStarted", {
      trip_id: id,
      device_id,
      name,
      start_lat: startLat,
      start_lng: startLng,
      start_time: startTime
    });
    
    console.log("✅ Trip started successfully");
    res.json({ success: true, trip_id: id });
  });
});

// End a trip
app.post("/api/trips/end", (req, res) => {
  const { id, endTime, endLat, endLng, duration, distance, avgSpeed, maxSpeed, pointsCount } = req.body;
  
  const mysqlEndTime = toMySQLDateTime(endTime);
  
  console.log("🏁 Ending trip:", { id, distance: (distance / 1000).toFixed(2) + "km", duration, convertedTime: mysqlEndTime });
  
  const sql = `UPDATE trips 
               SET end_time = ?, end_lat = ?, end_lng = ?, duration = ?, 
                   distance = ?, avg_speed = ?, max_speed = ?, points_count = ?, status = 'completed'
               WHERE trip_id = ?`;
  
  db.query(sql, [mysqlEndTime, endLat, endLng, duration, distance, avgSpeed, maxSpeed, pointsCount, id], (err, result) => {
    if (err) {
      console.error("❌ Error ending trip:", err);
      return res.status(500).json({ error: err.message });
    }
    
    pusher.trigger("locations", "TripEnded", {
      trip_id: id,
      end_lat: endLat,
      end_lng: endLng,
      end_time: endTime,
      distance: distance,
      duration: duration
    });
    
    console.log("✅ Trip ended successfully");
    res.json({ success: true });
  });
});

// Get all trips (history)
app.get("/api/trips", (req, res) => {
  const deviceId = req.query.device_id;
  
  let sql = "SELECT * FROM trips ORDER BY start_time DESC LIMIT 50";
  let params = [];
  
  if (deviceId && deviceId !== "all") {
    sql = "SELECT * FROM trips WHERE device_id = ? ORDER BY start_time DESC LIMIT 50";
    params = [deviceId];
  }
  
  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("❌ Trips query error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, data: results });
  });
});

// Get single trip details with all locations - IMPROVED VERSION with fallback
app.get("/api/trips/:tripId", (req, res) => {
  const { tripId } = req.params;
  
  console.log("🔍 Fetching trip details for:", tripId);
  
  // Get trip info
  db.query("SELECT * FROM trips WHERE trip_id = ?", [tripId], (err, tripResults) => {
    if (err) {
      console.error("❌ Trip query error:", err);
      return res.status(500).json({ error: err.message });
    }
    
    if (tripResults.length === 0) {
      return res.status(404).json({ error: "Trip not found" });
    }
    
    const trip = tripResults[0];
    console.log("✅ Trip found:", trip.name);
    console.log("Trip time range:", trip.start_time, "to", trip.end_time);
    
    // First try to get locations by trip_id
    db.query("SELECT * FROM locations WHERE trip_id = ? ORDER BY timestamp ASC", [tripId], (err, locationResults) => {
      if (err) {
        console.error("❌ Locations query error:", err);
        return res.status(500).json({ error: err.message });
      }
      
      console.log(`📍 Found ${locationResults.length} locations with trip_id = ${tripId}`);
      
      // If no locations found by trip_id, try by time range
      if (locationResults.length === 0 && trip.start_time && trip.end_time) {
        console.log("⚠️ No locations with trip_id, trying time range query...");
        
        db.query(
          `SELECT * FROM locations 
           WHERE device_id = ? 
             AND timestamp BETWEEN DATE_SUB(?, INTERVAL 5 MINUTE) AND DATE_ADD(?, INTERVAL 5 MINUTE)
           ORDER BY timestamp ASC`,
          [trip.device_id, trip.start_time, trip.end_time],
          (err2, timeRangeResults) => {
            if (err2) {
              console.error("❌ Time range query error:", err2);
              return res.status(500).json({ error: err2.message });
            }
            
            console.log(`📍 Found ${timeRangeResults.length} locations by time range`);
            
            // Update these locations with the trip_id for future queries
            if (timeRangeResults.length > 0) {
              const ids = timeRangeResults.map(loc => loc.id);
              db.query(
                `UPDATE locations SET trip_id = ? WHERE id IN (?)`,
                [tripId, ids],
                (updateErr) => {
                  if (updateErr) console.error("Update error:", updateErr);
                  else console.log(`✅ Updated ${ids.length} locations with trip_id`);
                }
              );
            }
            
            res.json({
              success: true,
              data: {
                trip: trip,
                locations: timeRangeResults || []
              }
            });
          }
        );
      } else {
        res.json({
          success: true,
          data: {
            trip: trip,
            locations: locationResults || []
          }
        });
      }
    });
  });
});

// Get active trips
app.get("/api/trips/active/current", (req, res) => {
  const sql = "SELECT * FROM trips WHERE status = 'active' ORDER BY start_time DESC";
  db.query(sql, (err, results) => {
    if (err) {
      console.error("❌ Active trips query error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, data: results });
  });
});

// ==================== DEVICE ENDPOINTS ====================

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

// ==================== HEALTH & ROOT ====================

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

app.get("/", (req, res) => {
  res.json({
    status: "GPS Tracking API",
    version: "2.0.0",
    endpoints: [
      "POST /api/locations - Send location",
      "GET /api/locations - Get locations",
      "POST /api/trips/start - Start a trip",
      "POST /api/trips/end - End a trip",
      "GET /api/trips - Get all trips",
      "GET /api/trips/:tripId - Get trip details with locations",
      "GET /api/trips/active/current - Get active trips",
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
  console.log(`📊 Trip tracking endpoints enabled`);
});

process.on("SIGINT", () => {
  console.log("Shutting down gracefully...");
  db.end(() => {
    console.log("Database connections closed");
    process.exit(0);
  });
});