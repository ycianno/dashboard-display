// ══════════════════════════════════════════════════════════════════════════
// Weather (Open-Meteo — free, no API key)
// ══════════════════════════════════════════════════════════════════════════

import { CONFIG } from './config.js';
import { weatherStore } from './store.js';
import { createPoller } from './util.js';

// WMO weather codes → an icon in the sprite plus a short label.
const WMO = {
  0: ['clear', 'Clear'],
  1: ['mostly-clear', 'Mainly Clear'],
  2: ['partly-cloudy', 'Partly Cloudy'],
  3: ['overcast', 'Overcast'],
  45: ['fog', 'Fog'],
  48: ['fog', 'Rime Fog'],
  51: ['drizzle', 'Light Drizzle'],
  53: ['drizzle', 'Drizzle'],
  55: ['drizzle', 'Heavy Drizzle'],
  56: ['drizzle', 'Freezing Drizzle'],
  57: ['drizzle', 'Freezing Drizzle'],
  61: ['rain', 'Light Rain'],
  63: ['rain', 'Rain'],
  65: ['heavy-rain', 'Heavy Rain'],
  66: ['rain', 'Freezing Rain'],
  67: ['heavy-rain', 'Freezing Rain'],
  71: ['snow', 'Light Snow'],
  73: ['snow', 'Snow'],
  75: ['snow', 'Heavy Snow'],
  77: ['snow', 'Snow Grains'],
  80: ['showers', 'Rain Showers'],
  81: ['showers', 'Heavy Showers'],
  82: ['heavy-rain', 'Violent Showers'],
  85: ['snow', 'Snow Showers'],
  86: ['snow', 'Heavy Snow Showers'],
  95: ['thunder', 'Thunderstorm'],
  96: ['thunder', 'Storm & Hail'],
  99: ['thunder', 'Severe Storm']
};

/**
 * Returns `condition`, not `label` — hourly and daily entries carry their own
 * `label` (the hour / weekday), and spreading a second `label` in silently
 * replaced them with the weather description.
 */
export function describeWeather(code, isDay = true) {
  const [iconName, condition] = WMO[code] || ['clear', 'Clear'];
  // Only the two clear-ish states have a night variant; a rainy night still
  // reads as rain.
  if (!isDay && (iconName === 'clear' || iconName === 'mostly-clear')) {
    return { icon: `${iconName}-night`, condition };
  }
  return { icon: iconName, condition };
}

function shortTime(iso) {
  const date = new Date(iso);
  let hours = date.getHours();
  const suffix = hours >= 12 ? 'p' : 'a';
  hours %= 12;
  if (hours === 0) hours = 12;
  return `${hours}${suffix}`;
}

function shortDay(iso, index) {
  if (index === 0) return 'Today';
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
}

async function fetchWeather() {
  const { latitude, longitude, label, timezone } = CONFIG.location;

  const params = new URLSearchParams({
    latitude,
    longitude,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,precipitation',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max',
    temperature_unit: CONFIG.weather.temperatureUnit,
    wind_speed_unit: CONFIG.weather.windSpeedUnit,
    timezone: timezone || 'auto',
    forecast_days: 6
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error(`Weather API ${response.status}`);
  const data = await response.json();

  const isDay = data.current.is_day === 1;
  const current = {
    temp: Math.round(data.current.temperature_2m),
    feelsLike: Math.round(data.current.apparent_temperature),
    humidity: data.current.relative_humidity_2m,
    wind: Math.round(data.current.wind_speed_10m),
    isDay,
    ...describeWeather(data.current.weather_code, isDay),
    high: Math.round(data.daily.temperature_2m_max[0]),
    low: Math.round(data.daily.temperature_2m_min[0]),
    sunrise: data.daily.sunrise[0],
    sunset: data.daily.sunset[0],
    uv: Math.round(data.daily.uv_index_max[0])
  };

  // Next 12 hours starting from the current hour.
  const now = Date.now();
  const startIndex = Math.max(
    0,
    data.hourly.time.findIndex((t) => new Date(t).getTime() >= now - 3600000)
  );

  const hourly = data.hourly.time.slice(startIndex, startIndex + 12).map((time, i) => {
    const idx = startIndex + i;
    return {
      time,
      label: i === 0 ? 'Now' : shortTime(time),
      temp: Math.round(data.hourly.temperature_2m[idx]),
      precip: data.hourly.precipitation_probability[idx] ?? 0,
      ...describeWeather(data.hourly.weather_code[idx], data.hourly.is_day[idx] === 1)
    };
  });

  const daily = data.daily.time.map((time, i) => ({
    time,
    label: shortDay(time, i),
    high: Math.round(data.daily.temperature_2m_max[i]),
    low: Math.round(data.daily.temperature_2m_min[i]),
    precip: data.daily.precipitation_probability_max[i] ?? 0,
    ...describeWeather(data.daily.weather_code[i], true)
  }));

  weatherStore.set({
    status: 'ready',
    // The location label comes from config and is shown verbatim — the old
    // build had "San Juan, PR" hardcoded in the render path, which stayed put
    // no matter what the coordinates said.
    place: label || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
    current,
    hourly,
    daily,
    updatedAt: Date.now()
  });
}

export function startWeather() {
  const poller = createPoller(
    async () => {
      try {
        await fetchWeather();
      } catch (err) {
        // Keep the last good reading on screen rather than blanking it.
        if (weatherStore.get().status !== 'ready') {
          weatherStore.set({ status: 'error' });
        }
        throw err;
      }
    },
    { interval: CONFIG.weather.refreshInterval }
  );
  poller.start();
  return poller;
}
