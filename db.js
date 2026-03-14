// db.js — Base de datos SQLite
// Guarda la configuración de plantas y el historial
// de lecturas + decisiones de riego.

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './autogarden.db';
const db = new Database(DB_PATH);

// Activar WAL para mejor rendimiento en Raspberry Pi
db.pragma('journal_mode = WAL');

// ── Esquema ───────────────────────────────────────────────────────────────────

db.exec(`
  -- Configuración de plantas por maceta
  CREATE TABLE IF NOT EXISTS plants (
    id          INTEGER PRIMARY KEY,   -- coincide con plant_id del ESP32 (1, 2, 3...)
    name        TEXT    NOT NULL,      -- nombre de la planta, ej: "Tomate cherry"
    species     TEXT,                  -- especie botánica para que la IA la conozca
    notes       TEXT,                  -- notas del usuario (ej: "recién trasplantada")
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  -- Historial de cada ciclo del ESP32
  CREATE TABLE IF NOT EXISTS sensor_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at   TEXT    DEFAULT (datetime('now')),
    plant_id      INTEGER NOT NULL,
    moisture_pct  INTEGER NOT NULL,   -- 0–100%
    temperature   REAL,               -- DHT22 °C
    humidity      REAL,               -- DHT22 %
    weather_desc  TEXT,               -- descripción del tiempo, ej: "lluvia ligera"
    weather_temp  REAL,               -- temperatura exterior
    weather_rain  REAL,               -- lluvia prevista (mm)
    ai_decision   TEXT,               -- JSON con la decisión de la IA
    watered       INTEGER DEFAULT 0,  -- 1 si se regó
    water_secs    INTEGER DEFAULT 0   -- segundos de riego ejecutados
  );
`);

// ── Plantas ───────────────────────────────────────────────────────────────────

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

// ── Historial ─────────────────────────────────────────────────────────────────

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

// Últimas N entradas del historial (todas las plantas)
function getHistory(limit = 50) {
  return db.prepare(`
    SELECT h.*, p.name as plant_name, p.species
    FROM sensor_log h
    LEFT JOIN plants p ON h.plant_id = p.id
    ORDER BY h.recorded_at DESC
    LIMIT ?
  `).all(limit);
}

// Últimas N entradas de una planta específica
function getPlantHistory(plant_id, limit = 10) {
  return db.prepare(`
    SELECT * FROM sensor_log
    WHERE plant_id = ?
    ORDER BY recorded_at DESC
    LIMIT ?
  `).all(plant_id, limit);
}

module.exports = { getPlants, getPlant, upsertPlant, deletePlant, logCycle, getHistory, getPlantHistory };
