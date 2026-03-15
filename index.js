// index.js — AutoGarden Backend
// Entry point: starts Express (dashboard + REST API)
// and the MQTT client that connects with the ESP32.

require('dotenv').config();

const express = require('express');
const path    = require('path');
const { connect: mqttConnect } = require('./mqtt');
const { getPlants, getPlant, upsertPlant, deletePlant, getHistory } = require('./db');
const { getWeather, clearWeatherCache } = require('./weather');

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
    mqtt_configured: !!process.env.MQTT_HOST,
    ai_configured:   !!process.env.GEMINI_API_KEY,
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
  res.json(wx || { error: 'Weather not available' });
});

// ── Dashboard (SPA) ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Startup ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌱 AutoGarden Backend v3.0 (Gemini Edition)`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   API:       http://localhost:${PORT}/api`);
  console.log(`   AI:        ${process.env.GEMINI_API_KEY ? '✓ Gemini configured' : '✗ missing GEMINI_API_KEY'}`);
  console.log(`   Weather:   ${process.env.OPENWEATHER_API_KEY ? '✓ configured' : '✗ missing OPENWEATHER_API_KEY'}\n`);
});

mqttConnect();
