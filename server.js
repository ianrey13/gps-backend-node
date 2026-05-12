const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const Pusher = require('pusher');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Database connection (use environment variables)
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'realtime_monitor'
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err);
    } else {
        console.log('Connected to database');
    }
});

// Pusher setup for real-time
const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID || '1474be695528c4258e23',
    key: process.env.PUSHER_KEY || '1474be695528c4258e23',
    secret: process.env.PUSHER_SECRET || 'your-pusher-secret',
    cluster: 'ap1',
    useTLS: true
});

// API endpoint to receive location from mobile
app.post('/api/locations', (req, res) => {
    const { device_id, latitude, longitude, accuracy, speed, battery_level } = req.body;
    
    const sql = 'INSERT INTO locations (device_id, latitude, longitude, accuracy, speed, battery_level, timestamp) VALUES (?, ?, ?, ?, ?, ?, NOW())';
    
    db.query(sql, [device_id, latitude, longitude, accuracy || null, speed || null, battery_level || null], (err, result) => {
        if (err) {
            console.error('Error saving location:', err);
            return res.status(500).json({ error: err.message });
        }
        
        // Trigger Pusher event for real-time updates
        pusher.trigger('locations', 'LocationUpdated', {
            id: result.insertId,
            device_id,
            latitude,
            longitude,
            accuracy,
            speed,
            battery_level,
            timestamp: new Date()
        });
        
        res.json({ success: true, id: result.insertId });
    });
});

// Get latest locations
app.get('/api/locations', (req, res) => {
    const limit = req.query.limit || 100;
    const deviceId = req.query.device_id;
    
    let sql = 'SELECT * FROM locations ORDER BY timestamp DESC LIMIT ?';
    let params = [parseInt(limit)];
    
    if (deviceId && deviceId !== 'all') {
        sql = 'SELECT * FROM locations WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?';
        params = [deviceId, parseInt(limit)];
    }
    
    db.query(sql, params, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, data: results });
    });
});

// Get unique devices
app.get('/api/devices', (req, res) => {
    db.query('SELECT DISTINCT device_id FROM locations ORDER BY device_id', (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const devices = results.map(r => r.device_id);
        res.json({ success: true, data: devices });
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});