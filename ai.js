// ai.js — Watering decision engine powered by Claude
// Receives full context (sensors, plant, weather, history)
// and returns a structured decision.
 
const Anthropic = require('@anthropic-ai/sdk');
 
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 
// JSON schema Claude must return
const RESPONSE_SCHEMA = `
{
  "water": boolean,           // true if watering is recommended
  "duration_secs": number,    // watering duration in seconds (0 if water=false)
  "confidence": "high"|"medium"|"low",
  "reasoning": string,        // brief explanation (1-2 sentences)
  "alert": string|null        // optional warning (e.g. "possible rain in 3h")
}`;
 
// Static portion of the prompt — eligible for prompt caching
const STATIC_PROMPT = `You are the intelligent irrigation system of AutoGarden. Your task is to decide whether a plant should be watered now and for how long, considering all available factors.
 
## Decision Criteria
- Do NOT water if soil moisture is above 60%, unless the plant specifically requires it.
- Do NOT water if more than 5mm of rain is expected in the next 6 hours.
- Reduce watering duration if outdoor temperature is low (<10°C) or ambient humidity is high.
- Increase duration if temperature is high (>28°C) or the plant requires frequent watering.
- Maximum recommended duration is 30 seconds per cycle.
- Consider history: if watered less than 2 hours ago, be conservative.
 
## Response
Reply ONLY with a valid JSON object with this exact structure, no additional text, no code blocks:
${RESPONSE_SCHEMA}`;
 
// Builds the dynamic portion of the prompt with live sensor/context data
function buildDynamicPrompt({ plant, moisture, ambientTemp, ambientHumidity, weather, history }) {
  const plantDesc = plant
    ? `Plant: "${plant.name}" (${plant.species || 'unknown species'}).${plant.notes ? ` Notes: ${plant.notes}.` : ''}`
    : 'Plant: not configured (no species data).';
 
  const weatherDesc = weather
    ? `Current weather in ${weather.city}: ${weather.description}, ${weather.temp}°C (feels like ${weather.feels_like}°C), outdoor humidity ${weather.humidity}%, wind ${weather.wind_speed} m/s. Rain last hour: ${weather.rain_now}mm. Rain forecast next 24h: ${weather.rain_next24h}mm.`
    : 'Weather forecast not available.';
 
  const ambientDesc = (ambientTemp != null && ambientHumidity != null)
    ? `Indoor/greenhouse temperature: ${ambientTemp}°C, relative humidity: ${ambientHumidity}%.`
    : 'DHT22 sensor data not available.';
 
  const historyDesc = history && history.length > 0
    ? `Last ${history.length} watering events for this plant:\n` +
      history.map(h =>
        `  - ${h.recorded_at}: moisture ${h.moisture_pct}%, watered ${h.watered ? `yes (${h.water_secs}s)` : 'no'}`
      ).join('\n')
    : 'No previous watering history.';
 
  return `## Current Context
 
${plantDesc}
Soil moisture: ${moisture}% (0=dry, 100=soaked).
${ambientDesc}
${weatherDesc}
 
## Recent History
${historyDesc}`;
}
 
// Quick pre-filter to skip the API call when the answer is obvious
function quickDecision(moisture, weather) {
  // Clearly too wet — no need to consult the AI
  if (moisture > 70) {
    return {
      water: false,
      duration_secs: 0,
      confidence: 'high',
      reasoning: 'Soil moisture is above 70% — watering not needed.',
      alert: null
    };
  }
 
  // Heavy rain expected soon — skip watering
  const rainSoon = weather?.rain_next24h > 5;
  if (rainSoon && moisture > 40) {
    return {
      water: false,
      duration_secs: 0,
      confidence: 'high',
      reasoning: `Significant rain expected (${weather.rain_next24h}mm) and moisture is acceptable.`,
      alert: `Rain forecast: ${weather.rain_next24h}mm in the next 24h.`
    };
  }
 
  return null; // No shortcut — let Claude decide
}
 
// Main decision function
async function getWateringDecision({ plant, moisture, ambientTemp, ambientHumidity, weather, history }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[ai] ANTHROPIC_API_KEY not set. Using fallback logic.');
    return fallbackDecision(moisture);
  }
 
  // Try a quick rule-based decision before hitting the API
  const quick = quickDecision(moisture, weather);
  if (quick) {
    console.log(`[ai] Quick decision for plant ${plant?.name || '?'}: skipping API call.`);
    return quick;
  }
 
  const dynamicPrompt = buildDynamicPrompt({ plant, moisture, ambientTemp, ambientHumidity, weather, history });
 
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',  // Haiku: fast, cheap, sufficient for structured decisions
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              // Static part cached — saves ~90% on repeated input tokens
              type: 'text',
              text: STATIC_PROMPT,
              cache_control: { type: 'ephemeral' }
            },
            {
              // Dynamic part with live sensor data — never cached
              type: 'text',
              text: dynamicPrompt
            }
          ]
        }
      ]
    });
 
    const raw = message.content[0].text.trim();
    console.log(`[ai] Raw response for plant ${plant?.name || '?'}: ${raw}`);
 
    const decision = JSON.parse(raw);
 
    // Basic validation
    if (typeof decision.water !== 'boolean' || typeof decision.duration_secs !== 'number') {
      throw new Error('JSON response has incorrect format');
    }
 
    // Safety cap on duration
    decision.duration_secs = Math.min(decision.duration_secs, 30);
 
    return decision;
 
  } catch (err) {
    console.error('[ai] Error processing Claude response:', err.message);
    return fallbackDecision(moisture);
  }
}
 
// Simple fallback if AI is unavailable
function fallbackDecision(moisture) {
  const water = moisture < 30;
  return {
    water,
    duration_secs: water ? 10 : 0,
    confidence: 'low',
    reasoning: 'Automatic fallback decision (AI unavailable).',
    alert: 'Claude API unavailable. Using fixed moisture thresholds.'
  };
}
 
module.exports = { getWateringDecision }