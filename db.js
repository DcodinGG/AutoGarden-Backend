// db.js — SQLite Database
// Stores plant configuration and history
// of sensor readings + watering decisions.

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './autogarden.db';
const db = new Database(DB_PATH);

// Activate WAL for better performance on Raspberry Pi
db.pragma('journal_mode = WAL');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  -- Plant configuration per pot
  CREATE TABLE IF NOT EXISTS plants (
    id          INTEGER PRIMARY KEY,   -- matches plant_id from ESP32 (1, 2, 3...)
    name        TEXT    NOT NULL,      -- plant name, e.g., "Cherry Tomato"
    species     TEXT,                  -- botanical species for AI context
    notes       TEXT,                  -- user notes (e.g., "recently repotted")
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  -- History for each ESP32 cycle
  CREATE TABLE IF NOT EXISTS sensor_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at   TEXT    DEFAULT (datetime('now')),
    plant_id      INTEGER NOT NULL,
    moisture_pct  INTEGER NOT NULL,   -- 0–100%
    temperature   REAL,               -- DHT22 °C
    humidity      REAL,               -- DHT22 %
    weather_desc  TEXT,               -- weather description, e.g., "light rain"
    weather_temp  REAL,               -- outdoor temperature
    weather_rain  REAL,               -- predicted rain (mm)
    ai_decision   TEXT,               -- JSON with AI decision
    watered       INTEGER DEFAULT 0,  -- 1 if watered
    water_secs    INTEGER DEFAULT 0   -- watering seconds executed
  );

  -- Indexes for faster history queries
  CREATE INDEX IF NOT EXISTS idx_sensor_log_recorded_at ON sensor_log(recorded_at);
  CREATE INDEX IF NOT EXISTS idx_sensor_log_plant_id ON sensor_log(plant_id);
`);

// ── Plants ────────────────────────────────────────────────────────────────────

function getPlants() {
  return db.prepare('SELECT * FROM plants ORDER BY id').all();
}

function getPlant(id) {
  return db.prepare('SELECT * FROM plants WHERE id = ?').get(id);
}

function upsertPlant({ id, name, species, notes }) {
  return db.prepare(`
    INSERT INTO plants (id, name, species, notes, updated_at)
    VALUES (@id, @name, @species, @notes, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name       = excluded.name,
      species    = excluded.species,
      notes      = excluded.notes,
      updated_at = excluded.updated_at
  `).run({ id, name, species: species || '', notes: notes || '' });
}

function deletePlant(id) {
  return db.prepare('DELETE FROM plants WHERE id = ?').run(id);
}

// ── History ───────────────────────────────────────────────────────────────────

function logCycle({ plant_id, moisture_pct, temperature, humidity,
                    weather_desc, weather_temp, weather_rain,
                    ai_decision, watered, water_secs }) {
  return db.prepare(`
    INSERT INTO sensor_log
      (plant_id, moisture_pct, temperature, humidity,
       weather_desc, weather_temp, weather_rain,
       ai_decision, watered, water_secs)
    VALUES
      (@plant_id, @moisture_pct, @temperature, @humidity,
       @weather_desc, @weather_temp, @weather_rain,
       @ai_decision, @watered, @water_secs)
  `).run({
    plant_id, moisture_pct, temperature, humidity,
    weather_desc: weather_desc || '',
    weather_temp: weather_temp || null,
    weather_rain: weather_rain || 0,
    ai_decision: typeof ai_decision === 'object'
      ? JSON.stringify(ai_decision)
      : ai_decision,
    watered: watered ? 1 : 0,
    water_secs: water_secs || 0
  });
}

// Last N history entries (all plants)
function getHistory(limit = 50) {
  return db.prepare(`
    SELECT h.*, p.name as plant_name, p.species
    FROM sensor_log h
    LEFT JOIN plants p ON h.plant_id = p.id
    ORDER BY h.recorded_at DESC
    LIMIT ?
  `).all(limit);
}

// Last N entries for a specific plant
function getPlantHistory(plant_id, limit = 10) {
  return db.prepare(`
    SELECT * FROM sensor_log
    WHERE plant_id = ?
    ORDER BY recorded_at DESC
    LIMIT ?
  `).all(plant_id, limit);
}

module.exports = { getPlants, getPlant, upsertPlant, deletePlant, logCycle, getHistory, getPlantHistory };
