/**
 * Weather — Open-Meteo (free, no API key) via browser geolocation.
 * Shared by the Home debrief and the Kitchen kiosk.
 */

function wxDesc(code) {
  return code <= 1 ? "Clear" : code <= 3 ? "Partly cloudy" : code <= 49 ? "Foggy" :
         code <= 69 ? "Rainy" : code <= 79 ? "Snowy" : code <= 99 ? "Stormy" : "Mixed";
}

function wxEmoji(code) {
  return code <= 1 ? "☀️" : code <= 3 ? "⛅" : code <= 49 ? "🌫️" :
         code <= 69 ? "🌧️" : code <= 79 ? "❄️" : code <= 99 ? "⛈️" : "🌡️";
}

function uvLevel(uv) {
  return uv < 3 ? "Low" : uv < 6 ? "Moderate" : uv < 8 ? "High" : uv < 11 ? "Very High" : "Extreme";
}
function uvAdvice(uv) {
  return uv < 3 ? "no protection needed" : uv < 6 ? "hat & sunscreen" :
         uv < 8 ? "sunscreen, seek shade midday" : uv < 11 ? "extra protection, limit midday sun" : "avoid sun midday";
}

// Scan the hourly precip-probability for the next likely rain (>=50%) in ~12h
function nextRain(hourly) {
  if (!hourly || !hourly.time) return null;
  const now = Date.now();
  let start = hourly.time.findIndex(t => new Date(t).getTime() >= now);
  if (start < 0) start = 0;
  for (let i = start; i < Math.min(start + 12, hourly.time.length); i++) {
    if ((hourly.precipitation_probability?.[i] ?? 0) >= 50) {
      const dt = new Date(hourly.time[i]);
      const hrs = Math.round((dt.getTime() - now) / 3600000);
      const when = dt.toLocaleTimeString("en-US", { hour: "numeric" });
      return { soon: true, label: hrs <= 0 ? "Rain now" : `Rain ~${when}`, when, prob: hourly.precipitation_probability[i] };
    }
  }
  return { soon: false, label: "Dry next 12h" };
}

// Current conditions + 3-day forecast for a fixed lat/lon (no geolocation) — for the kiosk.
export async function fetchWeatherAt(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,precipitation,weathercode,windspeed_10m` +
      `&hourly=precipitation_probability` +
      `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max` +
      `&forecast_days=5&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph`;
    const wx = await fetch(url).then(r => r.json());
    const c = wx.current;
    const code = c.weathercode;

    const daily = [];
    const dd = wx.daily;
    if (dd && dd.time) {
      for (let i = 0; i < Math.min(4, dd.time.length); i++) {
        daily.push({
          day: i === 0 ? "Today" : new Date(dd.time[i] + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" }),
          hi: Math.round(dd.temperature_2m_max[i]),
          lo: Math.round(dd.temperature_2m_min[i]),
          rainPct: dd.precipitation_probability_max?.[i] ?? 0,
          emoji: wxEmoji(dd.weathercode[i]),
        });
      }
    }

    let uv = null;
    if (dd && dd.uv_index_max) {
      const v = Math.round(dd.uv_index_max[0]);
      uv = { value: v, level: uvLevel(v), advice: uvAdvice(v) };
    }

    return {
      tempF: Math.round(c.temperature_2m),
      desc: wxDesc(code),
      emoji: wxEmoji(code),
      wind: Math.round(c.windspeed_10m),
      precip: c.precipitation,
      code,
      daily,
      rain: nextRain(wx.hourly),
      uv,
    };
  } catch {
    return null;
  }
}

// Structured current conditions via browser geolocation, or null on failure.
export async function fetchWeatherDetail() {
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
    );
    return fetchWeatherAt(pos.coords.latitude, pos.coords.longitude);
  } catch {
    return null;
  }
}

// One-line string form (used by the debrief prompt).
export async function fetchWeather() {
  const d = await fetchWeatherDetail();
  if (!d) return null;
  return `${d.desc}, ${d.tempF}°F, wind ${d.wind} mph. Precip: ${d.precip}in.`;
}
