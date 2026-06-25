/**
 * Weather module — current conditions, hourly, 7-day forecast, animated radar
 * Data: Open-Meteo (free, no key), RainViewer (free, no key), Leaflet (CDN)
 */

let _container = null;
let _map = null;
let _radarLayers = [];
let _radarFrames = [];
let _frameIdx = 0;
let _playing = false;
let _playTimer = null;
let _wx = null;
let _radar = null;
let _loc = null;
let _loading = true;
let _error = null;

const LS_LOC = 'wx_loc';
const FALLBACK = { lat: 38.906, lon: -94.683 }; // Leawood, KS

// ── WMO weather codes ─────────────────────────────────────────────
const WMO = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mainly clear'], 2: ['⛅', 'Partly cloudy'],
  3: ['☁️', 'Overcast'], 45: ['🌫️', 'Fog'], 48: ['🌫️', 'Icy fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'],
  61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
  71: ['🌨️', 'Light snow'], 73: ['❄️', 'Snow'], 75: ['❄️', 'Heavy snow'],
  77: ['🌨️', 'Snow grains'], 80: ['🌦️', 'Light showers'], 81: ['🌧️', 'Showers'],
  82: ['⛈️', 'Heavy showers'], 85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Heavy snow showers'],
  95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'T-storm + hail'], 99: ['⛈️', 'T-storm + hail'],
};
const wmo = code => WMO[code] || ['🌡️', 'Unknown'];

function windDir(deg) {
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round((deg || 0) / 45) % 8];
}
function uvLabel(uv) {
  if (!uv && uv !== 0) return 'UV';
  if (uv <= 2) return 'Low';
  if (uv <= 5) return 'Moderate';
  if (uv <= 7) return 'High';
  if (uv <= 10) return 'Very high';
  return 'Extreme';
}
function fmt12h(isoStr) {
  const h = new Date(isoStr).getHours();
  return h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
}

// ── Location ──────────────────────────────────────────────────────
async function getLocation() {
  try {
    const cached = JSON.parse(localStorage.getItem(LS_LOC) || 'null');
    if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached;
  } catch {}
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(FALLBACK);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const loc = { lat: coords.latitude, lon: coords.longitude, ts: Date.now() };
        localStorage.setItem(LS_LOC, JSON.stringify(loc));
        resolve(loc);
      },
      () => resolve(FALLBACK),
      { timeout: 6000, maximumAge: 30 * 60 * 1000 }
    );
  });
}

// ── Fetch ─────────────────────────────────────────────────────────
async function fetchWeather(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,uv_index,precipitation_probability',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max',
    timezone: 'auto',
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    forecast_days: 7,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
  if (!res.ok) throw new Error('Weather API error');
  return res.json();
}

async function fetchRadar() {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!res.ok) throw new Error('Radar API error');
  return res.json();
}

// ── Render ────────────────────────────────────────────────────────
function render() {
  if (!_container) return;

  if (_loading) {
    _container.innerHTML = `
      <div class="module-content" style="display:flex;align-items:center;justify-content:center;min-height:400px">
        <div style="text-align:center;color:var(--text-secondary)">
          <div style="font-size:48px;margin-bottom:var(--space-3)">🌤️</div>
          <div style="font-size:var(--text-sm)">Loading weather…</div>
        </div>
      </div>`;
    return;
  }

  if (_error) {
    _container.innerHTML = `
      <div class="module-content" style="padding:var(--space-5)">
        <div class="card" style="padding:var(--space-6);text-align:center;max-width:400px;margin:0 auto">
          <div style="font-size:36px;margin-bottom:var(--space-2)">⚠️</div>
          <div style="font-weight:700;margin-bottom:var(--space-2)">Weather unavailable</div>
          <div style="color:var(--text-secondary);font-size:var(--text-sm)">${_error}</div>
          <button class="btn btn-primary" style="margin-top:var(--space-4)" id="wx-retry">Try again</button>
        </div>
      </div>`;
    _container.querySelector('#wx-retry')?.addEventListener('click', load);
    return;
  }

  const c = _wx.current;
  const daily = _wx.daily;
  const hourly = _wx.hourly;
  const [curIcon, curDesc] = wmo(c.weather_code);

  // Find current hour in hourly array
  const nowStr = new Date().toISOString().slice(0, 13);
  const hi0 = Math.max(0, hourly.time.findIndex(t => t >= nowStr));
  const next24 = Array.from({ length: 24 }, (_, i) => hi0 + i).filter(i => i < hourly.time.length);

  // Temp range for the week (for bar scaling)
  const weekMin = Math.min(...daily.temperature_2m_min);
  const weekMax = Math.max(...daily.temperature_2m_max);
  const weekSpan = weekMax - weekMin || 1;

  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  _container.innerHTML = `
    <div class="module-content" style="padding:var(--space-4);max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:var(--space-4)">

      <!-- Hero card -->
      <div class="card" style="padding:var(--space-5)">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-5)">
          <div style="display:flex;align-items:center;gap:var(--space-4)">
            <div style="font-size:80px;line-height:1">${curIcon}</div>
            <div>
              <div style="font-size:56px;font-weight:800;line-height:1;letter-spacing:-0.03em;font-family:var(--font-sans)">${Math.round(c.temperature_2m)}°F</div>
              <div style="font-size:var(--text-lg);font-weight:600;margin-top:4px">${curDesc}</div>
              <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-top:4px">
                Feels like ${Math.round(c.apparent_temperature)}° · High ${Math.round(daily.temperature_2m_max[0])}° · Low ${Math.round(daily.temperature_2m_min[0])}°
              </div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            ${statPill('💧', `${c.relative_humidity_2m}%`, 'Humidity')}
            ${statPill('💨', `${Math.round(c.wind_speed_10m)} mph ${windDir(c.wind_direction_10m)}`, 'Wind')}
            ${statPill('🌞', `UV ${c.uv_index ?? '—'} · ${uvLabel(c.uv_index)}`, 'UV Index')}
            ${statPill('☔', `${c.precipitation_probability ?? 0}%`, 'Rain chance')}
          </div>
        </div>
      </div>

      <!-- Hourly strip -->
      <div class="card" style="padding:var(--space-4)">
        <div style="font-weight:700;font-size:var(--text-xs);color:var(--text-secondary);text-transform:uppercase;letter-spacing:.07em;margin-bottom:var(--space-3)">Hourly</div>
        <div style="display:flex;gap:2px;overflow-x:auto;padding-bottom:var(--space-1)">
          ${next24.map((idx, i) => {
            const [hIcon] = wmo(hourly.weather_code[idx]);
            const temp = Math.round(hourly.temperature_2m[idx]);
            const pop = hourly.precipitation_probability[idx] || 0;
            const isNow = i === 0;
            return `
              <div style="flex-shrink:0;width:54px;text-align:center;padding:var(--space-2) 4px;border-radius:var(--radius-md);background:${isNow ? 'var(--accent-light)' : 'transparent'}">
                <div style="font-size:11px;font-weight:${isNow ? '700' : '400'};color:${isNow ? 'var(--accent)' : 'var(--text-secondary)'}">${isNow ? 'Now' : fmt12h(hourly.time[idx])}</div>
                <div style="font-size:22px;margin:4px 0;line-height:1">${hIcon}</div>
                <div style="font-size:var(--text-sm);font-weight:600">${temp}°</div>
                <div style="font-size:10px;color:#007AFF;min-height:14px">${pop >= 20 ? pop + '%' : ''}</div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <!-- 7-day forecast -->
      <div class="card" style="padding:var(--space-4)">
        <div style="font-weight:700;font-size:var(--text-xs);color:var(--text-secondary);text-transform:uppercase;letter-spacing:.07em;margin-bottom:var(--space-3)">7-Day Forecast</div>
        ${daily.time.map((t, i) => {
          const d = new Date(t + 'T12:00:00');
          const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayNames[d.getDay()];
          const [dIcon, dDesc] = wmo(daily.weather_code[i]);
          const hi = Math.round(daily.temperature_2m_max[i]);
          const lo = Math.round(daily.temperature_2m_min[i]);
          const pop = daily.precipitation_probability_max[i] || 0;
          // Bar position within week range
          const barLeft = ((lo - weekMin) / weekSpan) * 100;
          const barWidth = ((hi - lo) / weekSpan) * 100;
          return `
            <div style="display:flex;align-items:center;gap:var(--space-3);padding:10px 0;${i < daily.time.length - 1 ? 'border-bottom:1px solid var(--separator)' : ''}">
              <div style="width:78px;font-size:var(--text-sm);font-weight:${i === 0 ? '700' : '400'}">${label}</div>
              <div style="font-size:24px;width:30px;text-align:center;flex-shrink:0">${dIcon}</div>
              <div style="flex:1;display:flex;align-items:center;gap:var(--space-3);min-width:0">
                <div style="font-size:var(--text-xs);color:var(--text-secondary);width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${dDesc}${pop >= 20 ? ` · ☔${pop}%` : ''}</div>
                <div style="flex:1;position:relative;height:4px;background:var(--bg-surface-2);border-radius:2px">
                  <div style="position:absolute;left:${barLeft}%;width:${barWidth}%;height:100%;background:linear-gradient(90deg,var(--accent-light),var(--accent));border-radius:2px"></div>
                </div>
                <div style="display:flex;gap:var(--space-2);font-size:var(--text-sm);flex-shrink:0">
                  <span style="font-weight:700;color:var(--text-primary)">${hi}°</span>
                  <span style="color:var(--text-secondary)">${lo}°</span>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>

      <!-- Radar -->
      <div class="card" style="padding:var(--space-4)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);flex-wrap:wrap;gap:var(--space-2)">
          <div style="font-weight:700;font-size:var(--text-xs);color:var(--text-secondary);text-transform:uppercase;letter-spacing:.07em">Radar</div>
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            <button class="btn btn-secondary btn-sm" id="radar-prev" title="Previous frame">◀</button>
            <button class="btn btn-primary btn-sm" id="radar-play">▶ Play</button>
            <button class="btn btn-secondary btn-sm" id="radar-next" title="Next frame">▶</button>
            <span style="font-size:var(--text-xs);color:var(--text-secondary);min-width:80px;text-align:right" id="radar-timestamp"></span>
          </div>
        </div>
        <div id="wx-radar-map" style="height:360px;border-radius:var(--radius-md);overflow:hidden;background:var(--bg-surface-2)"></div>
        <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:var(--space-2)">
          Radar data: RainViewer · Map: © OpenStreetMap contributors
        </div>
      </div>

    </div>
  `;

  bindEvents();
  initMap();
}

function statPill(icon, value, label) {
  return `
    <div style="background:var(--bg-surface-2);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);min-width:120px">
      <div style="font-size:var(--text-xs);color:var(--text-secondary)">${icon} ${label}</div>
      <div style="font-weight:700;font-size:var(--text-sm);margin-top:2px">${value}</div>
    </div>`;
}

// ── Leaflet + Radar map ───────────────────────────────────────────
function loadLeaflet() {
  return new Promise(resolve => {
    if (window.L) return resolve();
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = resolve;
    document.head.appendChild(s);
  });
}

async function initMap() {
  const el = document.getElementById('wx-radar-map');
  if (!el || !_loc) return;

  await loadLeaflet();
  const L = window.L;

  if (_map) { try { _map.remove(); } catch {} _map = null; }
  _radarLayers = [];

  _map = L.map('wx-radar-map', { zoomControl: true, attributionControl: false })
    .setView([_loc.lat, _loc.lon], 7);

  // Dark base tiles
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 12,
  }).addTo(_map);

  // My location dot
  L.circleMarker([_loc.lat, _loc.lon], {
    radius: 7, fillColor: '#007AFF', color: '#fff', weight: 2.5, fillOpacity: 1,
  }).addTo(_map);

  // Build radar tile layers from RainViewer frames
  if (_radar?.radar) {
    const host = _radar.host;
    const past = _radar.radar.past || [];
    const nowcast = _radar.radar.nowcast || [];
    _radarFrames = [...past, ...nowcast];

    for (const frame of _radarFrames) {
      const layer = L.tileLayer(
        `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
        { opacity: 0.65, maxZoom: 12, zIndex: 10 }
      );
      _radarLayers.push({ layer, frame });
    }

    if (_radarLayers.length) {
      _frameIdx = _radarLayers.length - 1; // most recent
      _radarLayers[_frameIdx].layer.addTo(_map);
      updateTimestamp();
    }
  }
}

function showFrame(idx) {
  if (!_radarLayers.length || !_map) return;
  _radarLayers[_frameIdx]?.layer.remove();
  _frameIdx = ((idx % _radarLayers.length) + _radarLayers.length) % _radarLayers.length;
  _radarLayers[_frameIdx].layer.addTo(_map);
  updateTimestamp();
}

function updateTimestamp() {
  const el = document.getElementById('radar-timestamp');
  if (!el || !_radarLayers[_frameIdx]) return;
  const { frame } = _radarLayers[_frameIdx];
  const isNowcast = frame.path?.includes('nowcast');
  const t = new Date(frame.time * 1000);
  el.textContent = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  el.style.color = isNowcast ? 'var(--accent)' : 'var(--text-secondary)';
  el.title = isNowcast ? 'Forecast' : 'Past';
}

function startPlay() {
  if (_playing) return;
  _playing = true;
  const btn = document.getElementById('radar-play');
  if (btn) btn.textContent = '⏸ Pause';
  _playTimer = setInterval(() => showFrame(_frameIdx + 1), 400);
}

function stopPlay() {
  _playing = false;
  clearInterval(_playTimer);
  _playTimer = null;
  const btn = document.getElementById('radar-play');
  if (btn) btn.textContent = '▶ Play';
}

// ── Events ────────────────────────────────────────────────────────
function bindEvents() {
  _container.querySelector('#radar-prev')?.addEventListener('click', () => { stopPlay(); showFrame(_frameIdx - 1); });
  _container.querySelector('#radar-next')?.addEventListener('click', () => { stopPlay(); showFrame(_frameIdx + 1); });
  _container.querySelector('#radar-play')?.addEventListener('click', () => _playing ? stopPlay() : startPlay());
}

// ── Load ──────────────────────────────────────────────────────────
async function load() {
  stopPlay();
  _loading = true;
  _error = null;
  render();

  try {
    _loc = await getLocation();
    const [wx, radar] = await Promise.all([
      fetchWeather(_loc.lat, _loc.lon),
      fetchRadar().catch(() => null),
    ]);
    _wx = wx;
    _radar = radar;
    _loading = false;
  } catch (e) {
    _loading = false;
    _error = e.message;
  }

  render();
}

// ── Module exports ────────────────────────────────────────────────
export async function init(container) {
  _container = container;
  load();
}

export function cleanup() {
  stopPlay();
  if (_map) { try { _map.remove(); } catch {} _map = null; }
  _radarLayers = [];
  _radarFrames = [];
  _container = null;
  _wx = null;
  _radar = null;
  _loc = null;
  _loading = true;
  _error = null;
}
