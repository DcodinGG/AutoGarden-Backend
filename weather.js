// weather.js — Previsión meteorológica
// Consulta OpenWeatherMap para obtener el tiempo actual
// y la lluvia prevista en las próximas horas.

const axios = require('axios');

const API_KEY = process.env.OPENWEATHER_API_KEY;
const CITY    = process.env.OPENWEATHER_CITY || 'Madrid';
const UNITS   = process.env.OPENWEATHER_UNITS || 'metric';

// Cache de 30 minutos para no gastar llamadas a la API gratuita
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30 * 60 * 1000;

async function getWeather() {
  if (!API_KEY) {
    console.warn('[weather] OPENWEATHER_API_KEY no configurada. Usando datos vacíos.');
    return null;
  }

  // Devolver caché si es reciente
  if (_cache && Date.now() - _cacheTime < CACHE_TTL_MS) {
    return _cache;
  }

  try {
    // Tiempo actual
    const current = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: { q: CITY, appid: API_KEY, units: UNITS, lang: 'es' },
      timeout: 8000
    });

    // Previsión próximas 24h (para saber si va a llover)
    const forecast = await axios.get('https://api.openweathermap.org/data/2.5/forecast', {
      params: { q: CITY, appid: API_KEY, units: UNITS, lang: 'es', cnt: 8 }, // 8 × 3h = 24h
      timeout: 8000
    });

    // Calcular lluvia total prevista en las próximas 24h
    const rainNext24h = forecast.data.list.reduce((acc, entry) => {
      return acc + (entry.rain?.['3h'] || 0);
    }, 0);

    const data = {
      city:          current.data.name,
      description:   current.data.weather[0].description,
      temp:          current.data.main.temp,
      feels_like:    current.data.main.feels_like,
      humidity:      current.data.main.humidity,
      wind_speed:    current.data.wind.speed,
      rain_now:      current.data.rain?.['1h'] || 0,   // mm última hora
      rain_next24h:  Math.round(rainNext24h * 10) / 10, // mm próximas 24h
      uv_index:      null, // requiere endpoint de pago
      fetched_at:    new Date().toISOString()
    };

    _cache = data;
    _cacheTime = Date.now();

    console.log(`[weather] ${data.city}: ${data.temp}°C, ${data.description}, lluvia 24h: ${data.rain_next24h}mm`);
    return data;

  } catch (err) {
    console.error('[weather] Error al consultar OpenWeatherMap:', err.message);
    return null;
  }
}

module.exports = { getWeather };
