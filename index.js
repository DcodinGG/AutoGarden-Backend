// index.js — AutoGarden Backend
// Punto de entrada: arranca Express (dashboard + API REST)
// y el cliente MQTT que conecta con el ESP32.

require('dotenv').config();

const express = require('express');
const path    = require('path');
const { connect: mqttConnect } = require('./mqtt');
const { getPlants, getPlant, upsertPlant, deletePlant, getHistory } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API REST ──────────────────────────────────────────────────────────────────

// GET /api/plants — lista de plantas configuradas
app.get('/api/plants', (req, res) => {
  res.json(getPlants());
});

// GET /api/plants/:id — una planta
app.get('/api/plants/:id', (req, res) => {
  const plant = getPlant(parseInt(req.params.id));
  if (!plant) return res.status(404).json({ error: 'Planta no encontrada' });
  res.json(plant);
});

// PUT /api/plants/:id — crear o actualizar planta
app.put('/api/plants/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { name, species, notes } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'El campo "name" es obligatorio' });
  }

  upsertPlant({ id, name: name.trim(), species, notes });
  res.json(getPlant(id));
});

// DELETE /api/plants/:id — eliminar planta
app.delete('/api/plants/:id', (req, res) => {
  const id = parseInt(req.params.id);
  deletePlant(id);
  res.json({ ok: true });
});

// GET /api/history?limit=50 — historial de riegos
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(getHistory(limit));
});

// GET /api/status — estado del backend
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    uptime_s: Math.floor(process.uptime()),
    version: '3.0.0',
    mqtt_configured: !!process.env.MQTT_HOST,
    ai_configured:   !!process.env.ANTHROPIC_API_KEY,
    weather_configured: !!process.env.OPENWEATHER_API_KEY
  });
});

// ── Dashboard (SPA) ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Arranque ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌱 AutoGarden Backend v3.0`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   API:       http://localhost:${PORT}/api`);
  console.log(`   AI:        ${process.env.ANTHROPIC_API_KEY ? '✓ configurada' : '✗ falta ANTHROPIC_API_KEY'}`);
  console.log(`   Weather:   ${process.env.OPENWEATHER_API_KEY ? '✓ configurada' : '✗ falta OPENWEATHER_API_KEY'}\n`);
});

mqttConnect();
