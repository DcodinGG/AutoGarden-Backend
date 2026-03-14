// ai.js — Decisión de riego con Claude
// Recibe el contexto completo (sensores, planta, tiempo, historial)
// y devuelve una decisión estructurada.

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Esquema JSON que Claude debe devolver
const RESPONSE_SCHEMA = `
{
  "water": boolean,           // true si recomienda regar
  "duration_secs": number,    // segundos de riego (0 si water=false)
  "confidence": "high"|"medium"|"low",
  "reasoning": string,        // explicación breve (1-2 frases)
  "alert": string|null        // aviso opcional (ej: "posible lluvia en 3h")
}`;

// Construye el prompt con todo el contexto disponible
function buildPrompt({ plant, moisture, ambientTemp, ambientHumidity, weather, history }) {
  const plantDesc = plant
    ? `Planta: "${plant.name}" (${plant.species || 'especie desconocida'}).${plant.notes ? ` Notas: ${plant.notes}.` : ''}`
    : 'Planta: no configurada (sin datos de especie).';

  const weatherDesc = weather
    ? `Tiempo actual en ${weather.city}: ${weather.description}, ${weather.temp}°C (sensación ${weather.feels_like}°C), humedad exterior ${weather.humidity}%, viento ${weather.wind_speed} m/s. Lluvia última hora: ${weather.rain_now}mm. Lluvia prevista próximas 24h: ${weather.rain_next24h}mm.`
    : 'Previsión meteorológica no disponible.';

  const ambientDesc = (ambientTemp != null && ambientHumidity != null)
    ? `Temperatura interior/invernadero: ${ambientTemp}°C, humedad relativa: ${ambientHumidity}%.`
    : 'Datos del sensor DHT22 no disponibles.';

  const historyDesc = history && history.length > 0
    ? `Últimos ${history.length} riegos de esta planta:\n` +
      history.map(h =>
        `  - ${h.recorded_at}: humedad ${h.moisture_pct}%, regada ${h.watered ? `sí (${h.water_secs}s)` : 'no'}`
      ).join('\n')
    : 'Sin historial previo de riegos.';

  return `Eres el sistema de riego inteligente de AutoGarden. Tu tarea es decidir si una planta debe regarse ahora y durante cuánto tiempo, considerando todos los factores disponibles.

## Contexto actual

${plantDesc}
Humedad del suelo: ${moisture}% (0=seco, 100=empapado).
${ambientDesc}
${weatherDesc}

## Historial reciente
${historyDesc}

## Criterios de decisión
- No riegues si la humedad del suelo es superior al 60% salvo que la planta lo requiera específicamente.
- No riegues si se esperan más de 5mm de lluvia en las próximas 6 horas.
- Reduce la duración del riego si la temperatura exterior es baja (<10°C) o si hay mucha humedad ambiental.
- Aumenta la duración si la temperatura es alta (>28°C) o si la planta es de riego frecuente.
- La duración máxima recomendada es 30 segundos por ciclo.
- Ten en cuenta el historial: si se regó hace menos de 2 horas, sé conservador.

## Respuesta
Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta, sin texto adicional, sin bloques de código:
${RESPONSE_SCHEMA}`;
}

// Decisión principal
async function getWateringDecision({ plant, moisture, ambientTemp, ambientHumidity, weather, history }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[ai] ANTHROPIC_API_KEY no configurada. Usando lógica de fallback.');
    return fallbackDecision(moisture);
  }

  const prompt = buildPrompt({ plant, moisture, ambientTemp, ambientHumidity, weather, history });

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0].text.trim();
    console.log(`[ai] Respuesta raw para planta ${plant?.name || '?'}: ${raw}`);

    const decision = JSON.parse(raw);

    // Validación mínima
    if (typeof decision.water !== 'boolean' || typeof decision.duration_secs !== 'number') {
      throw new Error('Respuesta JSON con formato incorrecto');
    }

    // Seguridad: limitar duración máxima
    decision.duration_secs = Math.min(decision.duration_secs, 30);

    return decision;

  } catch (err) {
    console.error('[ai] Error al procesar respuesta de Claude:', err.message);
    return fallbackDecision(moisture);
  }
}

// Lógica simple de fallback si la IA no está disponible
function fallbackDecision(moisture) {
  const water = moisture < 30;
  return {
    water,
    duration_secs: water ? 10 : 0,
    confidence: 'low',
    reasoning: 'Decisión automática por fallback (IA no disponible).',
    alert: 'Claude API no disponible. Usando umbrales fijos.'
  };
}

module.exports = { getWateringDecision };
