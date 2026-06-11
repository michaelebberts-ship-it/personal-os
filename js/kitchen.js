/**
 * Kitchen kiosk — standalone portrait dashboard for the Raspberry Pi display.
 * Reuses shared logic (weather, iCal, debrief) + Firebase (meals) but renders its
 * own big, glanceable, tap-to-expand UI. No sidebar/router.
 */

import { subscribeDoc, subscribe as dbSubscribe, refs, dbSet } from "./db.js";
import { fetchWeatherAt } from "./weather.js";
import { fetchIcalEvents } from "./ical.js";
import { getDayBrief } from "./debrief.js";
import { generateRecipeDetail } from "./ai.js";
import { BRIDGE_URL } from "./config.js";

// Headless config via URL params (so a kiosk with no keyboard can be configured by the launch URL):
//   ?key=sk-ant-...  &geo=38.98,-94.67  &theme=auto  &sleep=  &album=...  &bridge=http://host:3333
(function () {
  const q = new URLSearchParams(location.search);
  const map = { key:"personal_os_anthropic_key", geo:"kitchen_geo", theme:"kitchen_theme",
                sleep:"kitchen_sleep", album:"kitchen_photos_album", bridge:"os_bridge_url" };
  for (const [param, lsKey] of Object.entries(map)) {
    if (q.has(param)) localStorage.setItem(lsKey, q.get(param));
  }
})();

const root = document.getElementById("kitchen");

// Fixed kitchen location (Pi can't geolocate) — override via localStorage "kitchen_geo" = "lat,lon"
const [LAT, LON] = (localStorage.getItem("kitchen_geo") || "38.98,-94.67").split(",").map(Number);
// Kitchen Display iCloud public shared album (override via localStorage "kitchen_photos_album")
const PHOTO_ALBUM = localStorage.getItem("kitchen_photos_album") || "B2A5nhQSTtHFQCP";

const state = {
  weather: null,
  events: [],
  brief: null,         // { headline, hits[] } day overview
  weekDinners: null,
  contacts: [],
  photos: [],
  slides: [],
  slideIdx: 0,
  slideSlot: 0,        // which of the two <img> slots is active
  expand: null,        // null | "weather" | "calendar" | "dinner"
  dinnerLoading: false,
  wakeUntil: 0,        // temporary wake from sleep until this timestamp
};
let _lastSleeping = false;
let _lastPeriod = null;

// ── Theme (auto by time / light / dark) ──────────────────────────
const THEME_KEY = "kitchen_theme";          // "auto" | "light" | "dark"
const getThemeMode = () => localStorage.getItem(THEME_KEY) || "auto";
function inWindow(winStr, fallback) {
  const win = winStr || fallback;
  if (!win.includes("-")) return true;
  const toMin = t => { const [h, m] = t.split(":").map(Number); return h*60 + (m||0); };
  const [s, e] = win.split("-");
  const now = new Date(); const cur = now.getHours()*60 + now.getMinutes();
  const sm = toMin(s), em = toMin(e);
  return sm <= em ? (cur >= sm && cur < em) : (cur >= sm || cur < em);  // handles overnight wrap
}
function resolveTheme(mode) {
  if (mode === "light" || mode === "dark") return mode;
  return inWindow(localStorage.getItem("kitchen_day"), "6:00-20:00") ? "light" : "dark";  // auto
}
function applyTheme() { document.documentElement.dataset.theme = resolveTheme(getThemeMode()); }
function themeIcon() { return { auto: "🌗 Auto", light: "☀️ Light", dark: "🌙 Dark" }[getThemeMode()]; }
function cycleTheme() {
  const order = ["auto", "light", "dark"];
  localStorage.setItem(THEME_KEY, order[(order.indexOf(getThemeMode()) + 1) % 3]);
  applyTheme(); render();
}

// ── Sleep / screen-off window ────────────────────────────────────
function isSleeping() {
  if (Date.now() < state.wakeUntil) return false;
  const win = localStorage.getItem("kitchen_sleep") || "";   // off by default (smart plug handles power)
  return win.includes("-") ? inWindow(win, win) : false;
}

// ── helpers ──────────────────────────────────────────────────────
const esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;");
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const tod = () => ymd(new Date());
const weekday = () => new Date().toLocaleDateString("en-US", { weekday: "long" });
const fmt12 = t => { if (!t) return "All day"; const [h,m]=t.split(":").map(Number); return `${h%12||12}:${String(m).padStart(2,"0")} ${h>=12?"PM":"AM"}`; };
const fmtTimeShort = t => { if (!t) return ""; const [h,m]=t.split(":").map(Number); const mm = m ? `:${String(m).padStart(2,"0")}` : ""; return `${h%12||12}${mm}${h>=12?"p":"a"}`; };
const todayDinner = () => state.weekDinners?.days?.[weekday()] || null;
const eventsOn = ds => state.events.filter(e => e.date === ds).sort((a,b)=>(a.time||"")<(b.time||"")?-1:1);
const todayEvents = () => eventsOn(tod());

// 7 day-strings (Sun..Sat) for the week containing the anchor date
function weekDaysFor(anchor) {
  const d = new Date(anchor + "T12:00:00");
  const day = d.getDay();
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() - day + i); return ymd(x); });
}
// 42 Date cells (6 weeks, Sun-aligned) covering the given month
function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return x; });
}


// ── render ───────────────────────────────────────────────────────
function render() {
  const d = todayDinner();

  const macros = d ? [d.protein?`🥩 ${esc(d.protein)}`:"", d.calories?`🔥 ${esc(d.calories)}`:""].filter(Boolean).join(" · ") : "";

  root.innerHTML = `
    <div class="k-header">
      <div class="k-head-clock">
        <div class="k-clock" id="k-clock"></div>
        <div class="k-date">${new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
      </div>
    </div>

    <div class="k-tilerow">
      <div class="k-card k-tile k-tile--weather" data-expand="weather">
        <div class="k-tile__body">${renderWeatherTile()}</div>
      </div>

      <div class="k-card k-tile" data-expand="${d&&d.name?"dinner":""}">
        <div class="k-card__title">🍽️ Tonight's Dinner</div>
        <div class="k-tile__body">
          ${d && d.name
            ? `<div class="k-dinner__name">${esc(d.name)} ${d.freezable?"❄️":""}</div>${macros?`<div class="k-dinner__macros">${macros}</div>`:""}`
            : `<div class="k-empty">No dinner planned — set one in the app.</div>`}
        </div>
        ${d && d.name ? `<div class="k-tile__more">tap for recipe →</div>` : ""}
      </div>

      <div class="k-card k-tile k-tile--extras">${renderExtrasTile()}</div>
    </div>

    <div class="k-card" data-expand="calendar">
      <div class="k-card__title">📅 This Week · tap for month</div>
      ${renderWeekGrid()}
    </div>

    <div class="k-photos" id="k-photos" data-photos>
      <div class="k-slide" id="k-slide-a"></div>
      <div class="k-slide" id="k-slide-b"></div>
      ${state.slides.length ? "" : `<div class="k-photos__placeholder">${PHOTO_ALBUM ? "Loading photos…" : "Add a shared photo album to show pictures here"}</div>`}
    </div>

    <button class="k-themebtn" data-theme-toggle>${themeIcon()}</button>
    ${state.expand ? renderOverlay() : ""}
    ${isSleeping() ? `
      <div class="k-sleep" data-wake>
        <div class="k-sleep__clock" id="k-sleep-clock"></div>
        <div class="k-sleep__hint">tap to wake</div>
      </div>` : ""}
  `;

  updateClock();
  if (state.slides.length) showSlide(state.slideIdx);
  bind();
}

const WITTY = [
  "The Ebberts Command Center",
  "Team Ebby HQ",
  "Mission Control: Ebberts Edition",
  "Where the chaos gets organized",
  "Fueled by BBQ & carpool miles",
  "The Ebberts Family Launchpad",
  "Herding kids & golden retrievers since forever",
];
function wittyPhrase() {
  return WITTY[Math.floor(Date.now() / 86400000) % WITTY.length]; // stable per day
}

function renderWeatherHeader() {
  if (!state.weather) return `<div class="k-weather__desc">…</div>`;
  const w = state.weather;
  const days = (w.daily || []).map(dy => `
    <div class="k-wxday">
      <div class="k-wxday__d">${dy.day}</div>
      <div class="k-wxday__e">${dy.emoji}</div>
      <div class="k-wxday__t">${dy.hi}°<span>/${dy.lo}°</span></div>
      <div class="k-wxday__r">💧${dy.rainPct}%</div>
    </div>`).join("");
  const chips = [
    w.rain ? `<span class="k-wxchip">${w.rain.soon ? "🌧️" : "☀️"} ${esc(w.rain.label)}</span>` : "",
    w.uv ? `<span class="k-wxchip">☀️ UV ${w.uv.value} · ${esc(w.uv.level)}</span>` : "",
  ].filter(Boolean).join("");
  return `
    <div class="k-wxrow">
      <div class="k-wxnow">
        <div class="k-weather__emoji">${w.emoji}</div>
        <div>
          <div class="k-weather__temp">${w.tempF}°</div>
          <div class="k-weather__desc">${esc(w.desc)}</div>
          ${chips ? `<div class="k-wxextra">${chips}</div>` : ""}
        </div>
      </div>
      ${days ? `<div class="k-wx3day">${days}</div>` : ""}
    </div>`;
}

function renderWeatherTile() {
  if (!state.weather) return `<div class="k-empty">Loading weather…</div>`;
  const w = state.weather;
  const chips = [
    w.rain ? `<span class="k-wxchip">${w.rain.soon ? "🌧️" : "☀️"} ${esc(w.rain.label)}</span>` : "",
    w.uv ? `<span class="k-wxchip">☀️ UV ${w.uv.value} · ${esc(w.uv.level)}</span>` : "",
  ].filter(Boolean).join("");
  const days = (w.daily || []).map(dy => `
    <div class="k-wxday k-wxday--tile">
      <div class="k-wxday__d">${dy.day}</div>
      <div class="k-wxday__e">${dy.emoji}</div>
      <div class="k-wxday__t">${dy.hi}°<span>/${dy.lo}°</span></div>
      <div class="k-wxday__r">💧${dy.rainPct}%</div>
    </div>`).join("");
  return `
    <div class="k-wx-tile">
      <div class="k-wx-tile__now">
        <span class="k-wx-tile__emoji">${w.emoji}</span>
        <div>
          <div class="k-wx-tile__temp">${w.tempF}°</div>
          <div class="k-wx-tile__desc">${esc(w.desc)}</div>
          ${chips ? `<div class="k-wxextra">${chips}</div>` : ""}
        </div>
      </div>
      ${days ? `<div class="k-wx-tile__days">${days}</div>` : ""}
    </div>`;
}

const COMING_UP_DAYS = 62;  // ~2 months

// ── US holidays (computed per year) ──────────────────────────────
function nthWeekday(y, m, wd, n) {            // m 0-based, wd 0=Sun, n 1-based
  for (let day = 1, count = 0; day <= 31; day++) {
    const dt = new Date(y, m, day);
    if (dt.getMonth() !== m) break;
    if (dt.getDay() === wd && ++count === n) return dt;
  }
  return null;
}
function lastWeekday(y, m, wd) {
  const last = new Date(y, m + 1, 0).getDate();
  for (let day = last; day >= 1; day--) { const dt = new Date(y, m, day); if (dt.getDay() === wd) return dt; }
  return null;
}
function easter(y) {                          // computus (Gregorian)
  const a=y%19, b=Math.floor(y/100), c=y%100, d=Math.floor(b/4), e=b%4,
        f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30,
        i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7, mm=Math.floor((a+11*h+22*l)/451),
        month=Math.floor((h+l-7*mm+114)/31), day=((h+l-7*mm+114)%31)+1;
  return new Date(y, month-1, day);
}
function holidaysForYear(y) {
  return [
    { name:"New Year's Day", emoji:"🎉", date:new Date(y,0,1) },
    { name:"MLK Day", emoji:"✊", date:nthWeekday(y,0,1,3) },
    { name:"Valentine's Day", emoji:"❤️", date:new Date(y,1,14) },
    { name:"Presidents' Day", emoji:"🇺🇸", date:nthWeekday(y,1,1,3) },
    { name:"St. Patrick's Day", emoji:"☘️", date:new Date(y,2,17) },
    { name:"Easter", emoji:"🐰", date:easter(y) },
    { name:"Mother's Day", emoji:"💐", date:nthWeekday(y,4,0,2) },
    { name:"Memorial Day", emoji:"🇺🇸", date:lastWeekday(y,4,1) },
    { name:"Juneteenth", emoji:"🎉", date:new Date(y,5,19) },
    { name:"Father's Day", emoji:"👔", date:nthWeekday(y,5,0,3) },
    { name:"Independence Day", emoji:"🎆", date:new Date(y,6,4) },
    { name:"Labor Day", emoji:"🛠️", date:nthWeekday(y,8,1,1) },
    { name:"Columbus Day", emoji:"🧭", date:nthWeekday(y,9,1,2) },
    { name:"Halloween", emoji:"🎃", date:new Date(y,9,31) },
    { name:"Veterans Day", emoji:"🎖️", date:new Date(y,10,11) },
    { name:"Thanksgiving", emoji:"🦃", date:nthWeekday(y,10,4,4) },
    { name:"Christmas Eve", emoji:"🎄", date:new Date(y,11,24) },
    { name:"Christmas", emoji:"🎅", date:new Date(y,11,25) },
    { name:"New Year's Eve", emoji:"🎆", date:new Date(y,11,31) },
  ];
}

const whenLabel = days => days === 0 ? "Today 🎉" : days === 1 ? "Tomorrow" : `in ${days}d`;

// Upcoming birthdays (CRM contacts) + US holidays, within COMING_UP_DAYS, merged + sorted
function comingUp() {
  const today = new Date(); today.setHours(0,0,0,0);
  const items = [];

  (state.contacts || []).filter(c => c.birthday).forEach(c => {
    const p = String(c.birthday).split("-");
    if (p.length < 3) return;
    const nx = new Date(today.getFullYear(), +p[1]-1, +p[2]); nx.setHours(0,0,0,0);
    if (nx < today) nx.setFullYear(today.getFullYear()+1);
    const days = Math.round((nx - today) / 86400e3);
    if (days <= COMING_UP_DAYS) items.push({ emoji:"🎂", name:`${c.fname||""} ${c.lname||""}`.trim()||"Birthday", days, label: whenLabel(days) });
  });

  [today.getFullYear(), today.getFullYear()+1].forEach(y => holidaysForYear(y).forEach(h => {
    if (!h.date) return;
    const dt = new Date(h.date); dt.setHours(0,0,0,0);
    const days = Math.round((dt - today) / 86400e3);
    if (days >= 0 && days <= COMING_UP_DAYS) items.push({ emoji:h.emoji, name:h.name, days, label: whenLabel(days) });
  }));

  return items.sort((a,b) => a.days - b.days);
}

function renderExtrasTile() {
  const items = comingUp();
  return `
    <div class="k-card__title">🎉 Coming Up</div>
    <div class="k-extra">
      ${items.length
        ? items.map(it => `<div class="k-extra__row"><span class="k-extra__name">${it.emoji} ${esc(it.name)}</span><span class="k-extra__when">${it.label}</span></div>`).join("")
        : `<div class="k-empty">Nothing in the next 2 months</div>`}
    </div>`;
}

// Two-week grid for the calendar tile — 7 columns × 2 rows, today highlighted
function renderWeekGrid() {
  const start = new Date(weekDaysFor(tod())[0] + "T12:00:00");
  const days = Array.from({ length: 14 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return ymd(x); });
  const t = tod();
  return `<div class="k-weekgrid">${days.map(ds => {
    const evs = eventsOn(ds);
    const dd = new Date(ds + "T12:00:00");
    return `
      <div class="k-wday ${ds===t?"k-wday--today":""}">
        <div class="k-wday__dow">${dd.toLocaleDateString("en-US",{weekday:"short"})}</div>
        <div class="k-wday__num">${dd.getDate()}</div>
        ${evs.map(e => `<div class="k-wevent">${e.allDay?"":`<span class="k-wevent__t">${fmtTimeShort(e.time)} </span>`}${esc(e.title)}</div>`).join("")}
      </div>`;
  }).join("")}</div>`;
}

// Full month grid for the expand overlay
function renderMonthGrid() {
  const now = new Date();
  const cells = monthCells(now.getFullYear(), now.getMonth());
  const t = tod();
  const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return `
    <div class="k-month">
      ${dow.map(d => `<div class="k-mhead">${d}</div>`).join("")}
      ${cells.map(c => {
        const ds = ymd(c);
        const evs = eventsOn(ds);
        return `
          <div class="k-mcell ${c.getMonth()!==now.getMonth()?"k-mcell--out":""} ${ds===t?"k-mcell--today":""}">
            <div class="k-mcell__num">${c.getDate()}</div>
            ${evs.map(e => `<div class="k-mevent">${e.allDay?"":`<span class="k-wevent__t">${fmtTimeShort(e.time)} </span>`}${esc(e.title)}</div>`).join("")}
          </div>`;
      }).join("")}
    </div>`;
}

// ── expand overlay ───────────────────────────────────────────────
function renderOverlay() {
  let title = "", body = "";

  if (state.expand === "weather" && state.weather) {
    const w = state.weather;
    title = `${w.emoji} Weather`;
    const days = (w.daily || []).map(dy =>
      `<div class="k-extra__row"><span class="k-extra__name">${dy.emoji} ${dy.day}</span><span class="k-extra__when">${dy.hi}°/${dy.lo}° · 💧${dy.rainPct}%</span></div>`).join("");
    body = `<div class="k-modal__macros">${w.tempF}°F · ${esc(w.desc)}</div>
            <p class="k-modal__text">Wind ${w.wind} mph · Precip ${w.precip} in.</p>
            ${w.rain ? `<p class="k-modal__text">${w.rain.soon ? `🌧️ ${esc(w.rain.label)}${w.rain.prob?` (${w.rain.prob}% chance)`:""}` : "☀️ No rain expected in the next 12 hours"}</p>` : ""}
            ${w.uv ? `<p class="k-modal__text">☀️ UV index ${w.uv.value} — ${esc(w.uv.level)}: ${esc(w.uv.advice)}</p>` : ""}
            ${days ? `<div class="k-modal__section">Next 3 days</div><div class="k-extra">${days}</div>` : ""}`;
  } else if (state.expand === "calendar") {
    title = "📅 " + new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"});
    body = renderMonthGrid();
  } else if (state.expand === "dinner") {
    const d = todayDinner();
    title = "🍽️ " + esc(d?.name || "Tonight's Dinner");
    body = renderDinnerDetail(d);
  }

  const wide = state.expand === "calendar" ? " k-modal--wide" : "";
  return `
    <div class="k-overlay" data-overlay>
      <div class="k-modal${wide}">
        <div class="k-modal__head">
          <div class="k-modal__title">${title}</div>
          <button class="k-modal__close" data-close>✕</button>
        </div>
        ${body}
      </div>
    </div>`;
}

function renderDinnerDetail(d) {
  if (!d || !d.name) return `<p class="k-modal__text">No dinner planned.</p>`;
  const macros = [d.protein?`🥩 ${esc(d.protein)}`:"", d.calories?`🔥 ${esc(d.calories)}`:""].filter(Boolean).join(" · ");
  const badges = [d.freezable?`<span class="k-badge">❄️ Freezer-friendly</span>`:"", d.servings?`<span class="k-badge">makes ${esc(d.servings)}</span>`:"", d.prepTime?`<span class="k-badge">⏱ ${esc(d.prepTime)}</span>`:""].filter(Boolean).join("");
  const hasSteps = Array.isArray(d.steps) && d.steps.length;
  return `
    ${badges?`<div style="margin-bottom:12px">${badges}</div>`:""}
    ${macros?`<div class="k-modal__macros">${macros}</div>`:""}
    ${d.storage?`<p class="k-modal__text">🧊 ${esc(d.storage)}</p>`:""}
    ${(d.ingredients&&d.ingredients.length)?`<div class="k-modal__section">Ingredients</div><ul>${d.ingredients.map(i=>`<li>${esc(i)}</li>`).join("")}</ul>`:""}
    <div class="k-modal__section">Directions</div>
    ${state.dinnerLoading ? `<div class="k-spin">Writing the recipe…</div>`
      : hasSteps ? `<ol>${d.steps.map(s=>`<li>${esc(s)}</li>`).join("")}</ol>`
      : `<p class="k-modal__text">No directions yet.</p>`}
  `;
}

// ── events ───────────────────────────────────────────────────────
function bind() {
  root.querySelectorAll("[data-expand]").forEach(el =>
    el.addEventListener("click", () => openExpand(el.dataset.expand)));
  const ov = root.querySelector("[data-overlay]");
  if (ov) ov.addEventListener("click", e => { if (e.target === ov) closeExpand(); });
  const close = root.querySelector("[data-close]");
  if (close) close.addEventListener("click", closeExpand);
  const photos = root.querySelector("[data-photos]");
  if (photos) photos.addEventListener("click", advanceSlide);

  const themeBtn = root.querySelector("[data-theme-toggle]");
  if (themeBtn) themeBtn.addEventListener("click", e => { e.stopPropagation(); cycleTheme(); });

  const wake = root.querySelector("[data-wake]");
  if (wake) wake.addEventListener("click", () => { state.wakeUntil = Date.now() + 5 * 60 * 1000; _lastSleeping = false; render(); });
}

function openExpand(kind) {
  if (!kind) return;
  state.expand = kind;
  if (kind === "dinner") { ensureDinnerRecipe(); return; }
  render();
}
function closeExpand() { state.expand = null; render(); }

// Lazy-generate the recipe (ingredients + steps) for tonight's dinner, then cache
async function ensureDinnerRecipe() {
  const d = todayDinner();
  if (d && d.name && !(Array.isArray(d.steps) && d.steps.length)) {
    state.dinnerLoading = true; render();
    const detail = await generateRecipeDetail(d, "family");
    state.dinnerLoading = false;
    if (detail && Array.isArray(detail.steps)) {
      const merged = {
        ...d, steps: detail.steps,
        ingredients: (d.ingredients && d.ingredients.length) ? d.ingredients : (detail.ingredients || []),
        storage: detail.storage || d.storage || "",
        prepTime: detail.prepTime || d.prepTime || "",
        servings: d.servings || detail.servings || "",
        freezable: d.freezable ?? detail.freezable ?? false,
      };
      const days = { ...(state.weekDinners?.days || {}), [weekday()]: merged };
      state.weekDinners = { ...(state.weekDinners||{}), days };
      dbSet(refs.weekDinners(), { id: "weekDinners", days }).catch(()=>{});
    }
  }
  render();
}

// ── photo slideshow ──────────────────────────────────────────────
// Group photos into "slides": two portraits side by side, or one landscape full.
function buildSlides(photos) {
  const slides = [];
  for (let i = 0; i < photos.length; ) {
    const p = photos[i];
    if (p.portrait && photos[i+1] && photos[i+1].portrait) { slides.push([p.url, photos[i+1].url]); i += 2; }
    else { slides.push([p.url]); i += 1; }
  }
  return slides;
}
function showSlide(idx) {
  const slots = [document.getElementById("k-slide-a"), document.getElementById("k-slide-b")];
  if (!slots[0] || !state.slides.length) return;
  const next = slots[state.slideSlot ^ 1];
  const curr = slots[state.slideSlot];
  next.innerHTML = state.slides[idx % state.slides.length].map(u => `<img src="${u}" alt="">`).join("");
  const img = next.querySelector("img");
  const go = () => { next.classList.add("k-slide--on"); curr.classList.remove("k-slide--on"); };
  if (img && !img.complete) { img.onload = go; img.onerror = go; } else go();
  state.slideSlot ^= 1;
}
function advanceSlide() {
  if (!state.slides.length) return;
  state.slideIdx = (state.slideIdx + 1) % state.slides.length;
  showSlide(state.slideIdx);
}

// ── day brief (Team Ebby · Today) ────────────────────────────────
const currentPeriod = () => { const h = new Date().getHours(); return h < 12 ? "morning" : h < 16 ? "midday" : "evening"; };
let _briefBusy = false;

function fallbackBrief(period, evs, w, dinner) {
  const headline = { morning: "Good morning, crew!", midday: "Halfway there", evening: "Evening, Ebberts" }[period];
  const hits = [`${evs.length} event${evs.length===1?"":"s"} ${period==="evening"?"today":"on tap"}`];
  if (w) hits.push(`${w.emoji||""} ${w.tempF}°${w.rain?" · "+w.rain.label:""}`.trim());
  if (dinner) hits.push(`🍽️ ${dinner}`);
  while (hits.length < 3) hits.push("Have a good one 👍");
  return { headline, hits: hits.slice(0, 3) };
}

async function loadBrief() {
  if (_briefBusy) return;
  _briefBusy = true;
  const period = currentPeriod();
  const evs = todayEvents().map(e => ({ time: e.time, title: e.title }));
  const dinner = todayDinner()?.name || null;
  const w = state.weather;
  const weatherStr = w ? `${w.tempF}°, ${w.desc}${w.rain?", "+w.rain.label:""}${w.uv?", UV "+w.uv.value+" "+w.uv.level:""}` : "unknown";
  let tomorrow = null;
  if (period === "evening") {
    const tmr = ymd(new Date(Date.now() + 86400000));
    tomorrow = eventsOn(tmr).map(e => e.title).slice(0, 6).join("; ") || "nothing big";
  }
  let brief = null;
  try { brief = await getDayBrief(period, { events: evs, dinner, weatherStr, tomorrow }); } catch {}
  state.brief = brief || fallbackBrief(period, evs, w, dinner);
  _lastPeriod = period;
  _briefBusy = false;
  render();
}

// ── data loaders ─────────────────────────────────────────────────
async function loadWeather() { state.weather = await fetchWeatherAt(LAT, LON); render(); loadBrief(); }

async function loadCalendar() {
  try { state.events = await fetchIcalEvents(); } catch { /* keep old */ }
  render();
  loadBrief();
}

async function loadPhotos() {
  if (!PHOTO_ALBUM) return;
  try {
    const res = await fetch(`${BRIDGE_URL}/photos?album=${encodeURIComponent(PHOTO_ALBUM)}`);
    const data = await res.json();
    if (Array.isArray(data.photos) && data.photos.length) {
      state.photos = data.photos.slice().sort(() => Math.random() - 0.5);  // shuffle for variety
      state.slides = buildSlides(state.photos);
      state.slideIdx = 0;
      render();
    }
  } catch { /* no photos */ }
}

function updateClock() {
  const t = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const el = document.getElementById("k-clock");
  if (el) el.textContent = t;
  const sleepEl = document.getElementById("k-sleep-clock");
  if (sleepEl) sleepEl.textContent = t;
}

// ── boot ─────────────────────────────────────────────────────────
applyTheme();
subscribeDoc(refs.weekDinners(), doc => { state.weekDinners = doc; render(); });
dbSubscribe(refs.contacts(), docs => { state.contacts = docs; render(); });

render();
loadWeather();
loadCalendar();
loadPhotos();

setInterval(updateClock, 1000);
setInterval(loadWeather, 30 * 60 * 1000);   // 30 min
setInterval(loadCalendar, 15 * 60 * 1000);  // 15 min
setInterval(advanceSlide, 5 * 60 * 1000);   // 5 min
setInterval(loadPhotos, 60 * 60 * 1000);    // refresh list hourly
setInterval(applyTheme, 60 * 1000);         // auto light/dark flips on schedule
// Re-render on day rollover + sleep-window transitions; regenerate brief when the period flips
setInterval(() => {
  const s = isSleeping();
  if (s !== _lastSleeping) { _lastSleeping = s; }
  if (currentPeriod() !== _lastPeriod) { loadBrief(); }
  render();
}, 30 * 1000);
