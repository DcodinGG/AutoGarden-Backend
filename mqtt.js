// mqtt.js — Cliente MQTT
// Se suscribe a los datos del ESP32, invoca la IA
// y publica comandos de riego de vuelta al ESP32.

const mqtt = require('mqtt');
const { getWeather }          = require('./weather');
const { getWateringDecision } = require('./ai');
const { getPlant, getPlantHistory, logCycle } = require('./db');

const MQTT_HOST = process.env.MQTT_HOST     || 'localhost';
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 1883;
const MQTT_USER = process.env.MQTT_USER     || '';
const MQTT_PASS = process.env.MQTT_PASSWORD || '';

// Topics (deben coincidir con credentials.h del ESP32)
const TOPIC_SENSORS = 'autogarden/sensors';
const TOPIC_COMMAND = 'autogarden/command';
const TOPIC_STATUS  = 'autogarden/status';

let client = null;

// ── Procesar un mensaje de sensores ──────────────────────────────────────────

async function processSensorMessage(payload) {
  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    console.error('[mqtt] Payload inválido:', payload);
    return;
  }

  console.log(`[mqtt] Datos recibidos: ${data.plants?.length} plantas`);

  // Obtener previsión meteorológica (cacheada 30 min)
  const weather = await getWeather();

  // Procesar cada planta en paralelo
  const decisions = await Promise.all(
    (data.plants || []).map(async (p) => {
      const plant   = getPlant(p.id);
      const history = getPlantHistory(p.id, 5); // últimos 5 ciclos

      console.log(`[mqtt] Consultando IA para planta ${p.id} (${plant?.name || 'sin nombre'}), humedad: ${p.moisture}%`);

      const decision = await getWateringDecision({
        plant,
        moisture:        p.moisture,
        ambientTemp:     data.ambient?.valid ? data.ambient.temp     : null,
        ambientHumidity: data.ambient?.valid ? data.ambient.humidity : null,
        weather,
        history
      });

      console.log(`[mqtt] Decisión planta ${p.id}: regar=${decision.water}, duración=${decision.duration_secs}s — ${decision.reasoning}`);

      // Guardar en historial
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

  // Publicar comando al ESP32
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
    if (err) console.error('[mqtt] Error publicando comando:', err.message);
    else     console.log('[mqtt] Comando publicado:', cmdStr);
  });
}

// ── Conexión y suscripciones ──────────────────────────────────────────────────

function connect() {
  const options = {
    host:     MQTT_HOST,
    port:     MQTT_PORT,
    clientId: 'autogarden_backend',
    clean:    true,
    reconnectPeriod: 5000,
    ...(MQTT_USER && { username: MQTT_USER, password: MQTT_PASS })
  };

  console.log(`[mqtt] Conectando a ${MQTT_HOST}:${MQTT_PORT}...`);
  client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, options);

  client.on('connect', () => {
    console.log('[mqtt] Conectado al broker.');
    client.subscribe(TOPIC_SENSORS, { qos: 1 });
    client.subscribe(TOPIC_STATUS,  { qos: 0 });
    console.log(`[mqtt] Suscrito a: ${TOPIC_SENSORS}, ${TOPIC_STATUS}`);
  });

  client.on('message', (topic, message) => {
    const payload = message.toString();
    if (topic === TOPIC_SENSORS) {
      processSensorMessage(payload).catch(err =>
        console.error('[mqtt] Error procesando sensores:', err.message)
      );
    } else if (topic === TOPIC_STATUS) {
      console.log(`[mqtt] Estado ESP32: ${payload}`);
    }
  });

  client.on('error',       (err) => console.error('[mqtt] Error:', err.message));
  client.on('reconnect',   ()    => console.log('[mqtt] Reconectando...'));
  client.on('offline',     ()    => console.warn('[mqtt] Cliente offline.'));

  return client;
}

function getClient() { return client; }

module.exports = { connect, getClient };
