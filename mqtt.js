// mqtt.js — MQTT Client
// Subscribes to ESP32 data, invokes AI,
// and publishes watering commands back to the ESP32.

const mqtt = require('mqtt');
const { getWeather }          = require('./weather');
const { getWateringDecision } = require('./ai');
const { getPlant, getPlantHistory, logCycle } = require('./db');

const MQTT_HOST = process.env.MQTT_HOST     || 'localhost';
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 1883;
const MQTT_USER = process.env.MQTT_USER     || '';
const MQTT_PASS = process.env.MQTT_PASSWORD || '';

// Topics (must match credentials.h in ESP32)
const TOPIC_SENSORS = 'autogarden/sensors';
const TOPIC_COMMAND = 'autogarden/command';
const TOPIC_STATUS  = 'autogarden/status';

let client = null;

// ── Process a sensor message ──────────────────────────────────────────────────

async function processSensorMessage(payload) {
  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    console.error('[mqtt] Invalid JSON payload:', payload);
    return;
  }

  // Basic structure validation
  if (!data || !Array.isArray(data.plants)) {
    console.warn('[mqtt] Received malformed sensor data (missing plants array):', data);
    return;
  }

  console.log(`[mqtt] Received data: ${data.plants.length} plants`);

  // Get weather forecast (cached for 30 min)
  const weather = await getWeather();

  // Process each plant in parallel
  const decisions = await Promise.all(
    (data.plants || []).map(async (p) => {
      const plant   = getPlant(p.id);
      const history = getPlantHistory(p.id, 5); // last 5 cycles

      console.log(`[mqtt] Consulting AI for plant ${p.id} (${plant?.name || 'unnamed'}), moisture: ${p.moisture}%`);

      const decision = await getWateringDecision({
        plant,
        moisture:        p.moisture,
        ambientTemp:     data.ambient?.valid ? data.ambient.temp     : null,
        ambientHumidity: data.ambient?.valid ? data.ambient.humidity : null,
        weather,
        history
      });

      console.log(`[mqtt] Plant ${p.id} decision: water=${decision.water}, duration=${decision.duration_secs}s — ${decision.reasoning}`);

      // Save to history
      logCycle({
        plant_id:    p.id,
        moisture_pct: p.moisture,
        temperature: data.ambient?.temp     || null,
        humidity:    data.ambient?.humidity || null,
        weather_desc: weather?.description  || null,
        weather_temp: weather?.temp         || null,
        weather_rain: weather?.rain_next24h || 0,
        ai_decision:  decision,
        watered:      decision.water,
        water_secs:   decision.duration_secs
      });

      return { plant_id: p.id, ...decision };
    })
  );

  // Publish command to ESP32
  const command = {
    timestamp: new Date().toISOString(),
    plants: decisions.map(d => ({
      id:           d.plant_id,
      water:        d.water,
      duration_secs: d.duration_secs
    }))
  };

  const cmdStr = JSON.stringify(command);
  client.publish(TOPIC_COMMAND, cmdStr, { qos: 1 }, (err) => {
    if (err) console.error('[mqtt] Error publishing command:', err.message);
    else     console.log('[mqtt] Command published:', cmdStr);
  });
}

// ── Connection and subscriptions ──────────────────────────────────────────────

function connect() {
  const options = {
    host:     MQTT_HOST,
    port:     MQTT_PORT,
    clientId: 'autogarden_backend',
    clean:    true,
    reconnectPeriod: 5000,
    ...(MQTT_USER && { username: MQTT_USER, password: MQTT_PASS })
  };

  console.log(`[mqtt] Connecting to ${MQTT_HOST}:${MQTT_PORT}...`);
  client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, options);

  client.on('connect', () => {
    console.log('[mqtt] Connected to broker.');
    client.subscribe(TOPIC_SENSORS, { qos: 1 });
    client.subscribe(TOPIC_STATUS,  { qos: 0 });
    console.log(`[mqtt] Subscribed to: ${TOPIC_SENSORS}, ${TOPIC_STATUS}`);
  });

  client.on('message', (topic, message) => {
    const payload = message.toString();
    if (topic === TOPIC_SENSORS) {
      processSensorMessage(payload).catch(err =>
        console.error('[mqtt] Error processing sensors:', err.message)
      );
    } else if (topic === TOPIC_STATUS) {
      console.log(`[mqtt] ESP32 Status: ${payload}`);
    }
  });

  client.on('error',       (err) => console.error('[mqtt] Error:', err.message));
  client.on('reconnect',   ()    => console.log('[mqtt] Reconnecting...'));
  client.on('offline',     ()    => console.warn('[mqtt] Client offline.'));

  return client;
}

function getClient() { return client; }

module.exports = { connect, getClient };
