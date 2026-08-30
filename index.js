// index.js — AutoGarden Backend
// Entry point: starts Express (dashboard + REST API)
// and the MQTT client that connects with the ESP32.

require('dotenv').config();

const express = require('express');
const path    = require('path');
const { connect: mqttConnect } = require('./mqtt');
const { getPlants, getPlant, upsertPlant, deletePlant, getHistory,
        logWeatherSnapshot, getWeatherHistory } = require('./db');
const { getWeather, clearWeatherCache } = require('./weather');

const WEATHER_LOG_INTERVAL_MS = 30 * 60 * 1000; // matches weather.js cache TTL

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── REST API ──────────────────────────────────────────────────────────────────

// GET /api/plants — list of configured plants
app.get('/api/plants', (req, res) => {
  res.json(getPlants());
});

// GET /api/plants/:id — single plant
app.get('/api/plants/:id', (req, res) => {
  const plant = getPlant(parseInt(req.params.id));
  if (!plant) return res.status(404).json({ error: 'Plant not found' });
  res.json(plant);
});

// PUT /api/plants/:id — create or update plant
app.put('/api/plants/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { name, species, notes } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'The "name" field is mandatory' });
  }

  upsertPlant({ id, name: name.trim(), species, notes });
  res.json(getPlant(id));
});

// DELETE /api/plants/:id — delete plant
app.delete('/api/plants/:id', (req, res) => {
  const id = parseInt(req.params.id);
  deletePlant(id);
  res.json({ ok: true });
});

// GET /api/history?limit=50 — watering history
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(getHistory(limit));
});

// GET /api/status — backend status
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    uptime_s: Math.floor(process.uptime()),
    version: '3.0.0',
    ai_engine: 'Claude',
    mqtt_configured: !!process.env.MQTT_HOST,
    ai_configured:   !!process.env.ANTHROPIC_API_KEY,
    weather_configured: !!process.env.OPENWEATHER_API_KEY
  });
});

// GET /api/weather — current weather (cached or fresh)
app.get('/api/weather', async (req, res) => {
  const wx = await getWeather();
  res.json(wx || { error: 'Weather not available' });
});

// POST /api/weather/refresh — force weather refresh
app.post('/api/weather/refresh', async (req, res) => {
  clearWeatherCache();
  const wx = await getWeather();
  if (wx) logWeatherSnapshot(wx);
  res.json(wx || { error: 'Weather not available' });
});

// GET /api/weather/history?limit=100 — weather trend over time
// Logged independently of ESP32 cycles (see logWeatherPeriodically below),
// so it stays smooth even if the sensor node is asleep for hours.
app.get('/api/weather/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(getWeatherHistory(limit));
});

// ── Dashboard (SPA) ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Weather history logger ───────────────────────────────────────────────────
// Runs on its own schedule (independent of ESP32 sensor cycles) so the
// weather trend chart stays smooth even during long deep-sleep windows.
async function logWeatherPeriodically() {
  try {
    const wx = await getWeather();
    if (wx) {
      logWeatherSnapshot(wx);
      console.log(`[weather] Logged snapshot: ${wx.city} ${wx.temp}°C, ${wx.description}`);
    }
  } catch (err) {
    console.error('[weather] Failed to log periodic snapshot:', err.message);
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌱 AutoGarden Backend v3.0`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   API:       http://localhost:${PORT}/api`);
  console.log(`   AI:        ${process.env.ANTHROPIC_API_KEY ? '✓ configured' : '✗ missing ANTHROPIC_API_KEY'}`);
  console.log(`   Weather:   ${process.env.OPENWEATHER_API_KEY ? '✓ configured' : '✗ missing OPENWEATHER_API_KEY'}\n`);
});

mqttConnect();

// Log an initial snapshot on startup, then every WEATHER_LOG_INTERVAL_MS
logWeatherPeriodically();
setInterval(logWeatherPeriodically, WEATHER_LOG_INTERVAL_MS);
