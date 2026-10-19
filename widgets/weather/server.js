'use strict';
// Weather. Default provider Open-Meteo needs no API key. OpenWeatherMap is
// available if you prefer it (enter your API key in the widget settings).

exports.meta = {
  type: 'weather',
  name: 'Weather',
  description: 'Current conditions and a 5-day forecast.',
  refreshSec: 900,
  fields: [
    {
      key: 'provider', label: 'Provider', type: 'select',
      options: [{ value: 'openmeteo', label: 'Open-Meteo (no key needed)' }, { value: 'openweathermap', label: 'OpenWeatherMap (API key)' }],
    },
    { key: 'location', label: 'City', type: 'text', placeholder: 'Austin, TX', help: 'Or fill in latitude/longitude below.' },
    { key: 'latitude', label: 'Latitude (optional)', type: 'text' },
    { key: 'longitude', label: 'Longitude (optional)', type: 'text' },
    { key: 'apiKey', label: 'OpenWeatherMap API key', type: 'text', secret: true, help: 'Only used when the provider is OpenWeatherMap.' },
    { key: 'days', label: 'Forecast days', type: 'number', placeholder: '5' },
  ],
};

const geoCache = new Map();

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'PiDash/1.0' }, signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.reason || `HTTP ${res.status}`);
  return body;
}

async function locate(o) {
  if (o.latitude && o.longitude) return { lat: Number(o.latitude), lon: Number(o.longitude), name: o.location || '' };
  if (!o.location) throw new Error('Set a city (or latitude/longitude) in the weather widget settings.');
  const key = o.location.toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key);
  const city = o.location.split(',')[0].trim();
  const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(city)}`);
  if (!g.results || !g.results.length) throw new Error(`Could not find "${o.location}".`);
  const r = g.results[0];
  const loc = { lat: r.latitude, lon: r.longitude, name: r.name };
  geoCache.set(key, loc);
  return loc;
}

// WMO weather codes -> simple condition keys the client maps to icons.
function wmo(code) {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}

function owm(id) {
  if (id >= 200 && id < 300) return 'thunder';
  if (id >= 300 && id < 400) return 'drizzle';
  if (id >= 500 && id < 600) return 'rain';
  if (id >= 600 && id < 700) return 'snow';
  if (id >= 700 && id < 800) return 'fog';
  if (id === 800) return 'clear';
  if (id <= 802) return 'partly';
  return 'cloudy';
}

async function openMeteo(o, units, loc) {
  const imperial = units === 'imperial';
  const days = Math.min(Math.max(Number(o.days) || 5, 1), 7);
  const q = new URLSearchParams({
    latitude: loc.lat,
    longitude: loc.lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: imperial ? 'fahrenheit' : 'celsius',
    wind_speed_unit: imperial ? 'mph' : 'kmh',
    timezone: 'auto',
    forecast_days: String(days + 1),
  });
  const w = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`);
  const c = w.current;
  return {
    location: loc.name,
    current: {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      wind: Math.round(c.wind_speed_10m),
      condition: wmo(c.weather_code),
      isDay: !!c.is_day,
    },
    daily: w.daily.time.slice(1).map((date, i) => ({
      date,
      high: Math.round(w.daily.temperature_2m_max[i + 1]),
      low: Math.round(w.daily.temperature_2m_min[i + 1]),
      rain: w.daily.precipitation_probability_max[i + 1],
      condition: wmo(w.daily.weather_code[i + 1]),
    })),
    today: { high: Math.round(w.daily.temperature_2m_max[0]), low: Math.round(w.daily.temperature_2m_min[0]) },
    units: { temp: imperial ? 'F' : 'C', wind: imperial ? 'mph' : 'km/h' },
  };
}

async function openWeatherMap(o, units, loc) {
  if (!o.apiKey) throw new Error('Enter your OpenWeatherMap API key in the weather widget settings.');
  const imperial = units === 'imperial';
  const base = `lat=${loc.lat}&lon=${loc.lon}&units=${imperial ? 'imperial' : 'metric'}&appid=${encodeURIComponent(o.apiKey)}`;
  const [cur, fc] = await Promise.all([
    getJson(`https://api.openweathermap.org/data/2.5/weather?${base}`),
    getJson(`https://api.openweathermap.org/data/2.5/forecast?${base}`),
  ]);
  // 3-hourly forecast -> daily buckets (by the city's local date)
  const days = new Map();
  for (const e of fc.list) {
    const date = new Date((e.dt + fc.city.timezone) * 1000).toISOString().slice(0, 10);
    const d = days.get(date) || { date, high: -Infinity, low: Infinity, rain: 0, ids: [] };
    d.high = Math.max(d.high, e.main.temp_max);
    d.low = Math.min(d.low, e.main.temp_min);
    d.rain = Math.max(d.rain, Math.round((e.pop || 0) * 100));
    d.ids.push(e.weather[0].id);
    days.set(date, d);
  }
  const list = [...days.values()];
  const todayKey = new Date((cur.dt + cur.timezone) * 1000).toISOString().slice(0, 10);
  const upcoming = list.filter((d) => d.date > todayKey).slice(0, Math.min(Math.max(Number(o.days) || 5, 1), 5));
  const today = list.find((d) => d.date === todayKey);
  const mid = (d) => owm(d.ids[Math.floor(d.ids.length / 2)]);
  return {
    location: cur.name || loc.name,
    current: {
      temp: Math.round(cur.main.temp),
      feelsLike: Math.round(cur.main.feels_like),
      humidity: cur.main.humidity,
      wind: Math.round(cur.wind.speed * (imperial ? 1 : 3.6)),
      condition: owm(cur.weather[0].id),
      isDay: cur.dt > cur.sys.sunrise && cur.dt < cur.sys.sunset,
    },
    daily: upcoming.map((d) => ({ date: d.date, high: Math.round(d.high), low: Math.round(d.low), rain: d.rain, condition: mid(d) })),
    today: today ? { high: Math.round(today.high), low: Math.round(today.low) } : null,
    units: { temp: imperial ? 'F' : 'C', wind: imperial ? 'mph' : 'km/h' },
  };
}

exports.data = async (options, ctx) => {
  const loc = await locate(options);
  return options.provider === 'openweathermap'
    ? openWeatherMap(options, ctx.display.units, loc)
    : openMeteo(options, ctx.display.units, loc);
};

exports._internals = { wmo, owm };
