// weather.js — Weather Forecast
// Queries OpenWeatherMap for current weather
// and predicted rain in the coming hours.

const axios = require('axios');

const API_KEY = process.env.OPENWEATHER_API_KEY;
const CITY    = process.env.OPENWEATHER_CITY    || 'Madrid';
const UNITS   = process.env.OPENWEATHER_UNITS   || 'metric';
const LANG    = process.env.OPENWEATHER_LANG    || 'en';

// 30-minute cache to avoid exhausting free API calls
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30 * 60 * 1000;

function clearWeatherCache() {
  _cache = null;
  _cacheTime = 0;
}

async function getWeather() {
  if (!API_KEY) {
    console.warn('[weather] OPENWEATHER_API_KEY not configured. Weather features will be disabled.');
    return null;
  }

  // Return cache if it is recent
  if (_cache && Date.now() - _cacheTime < CACHE_TTL_MS) {
    return _cache;
  }

  try {
    // Current weather
    const current = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: { q: CITY, appid: API_KEY, units: UNITS, lang: LANG },
      timeout: 8000
    });

    // Next 24h forecast (to check for upcoming rain)
    const forecast = await axios.get('https://api.openweathermap.org/data/2.5/forecast', {
      params: { q: CITY, appid: API_KEY, units: UNITS, lang: LANG, cnt: 8 }, // 8 × 3h = 24h
      timeout: 8000
    });

    // Calculate total predicted rain in the next 24h
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
      rain_now:      current.data.rain?.['1h'] || 0,   // mm in the last hour
      rain_next24h:  Math.round(rainNext24h * 10) / 10, // mm in the next 24h
      uv_index:      null, // requires paid endpoint
      fetched_at:    new Date().toISOString()
    };

    _cache = data;
    _cacheTime = Date.now();

    console.log(`[weather] ${data.city}: ${data.temp}°C, ${data.description}, 24h rain: ${data.rain_next24h}mm`);
    return data;

  } catch (err) {
    console.error('[weather] Error querying OpenWeatherMap:', err.message);
    return null;
  }
}

module.exports = { getWeather, clearWeatherCache };
