/**
 * Home — Ebberts Command Center dashboard
 * Bento grid of live snapshot tiles. Each tile navigates to its full module.
 */

import { getApiKey, generateRecipeDetail } from "../js/ai.js";
import { getDebrief, getCachedDebrief } from "../js/debrief.js";
import { refs, dbSet, uid } from "../js/db.js";
import { fetchWeatherDetail } from "../js/weather.js";
import { fetchIcalEvents } from "../js/ical.js";
import { openWithPrompt } from "../js/global-ai.js";

let _container = null;
let _ctx = null;
let _unsubscribes = [];
let _dinnerModal = { open: false, loading: false };
let _debrief = { text: null, loading: false, date: null, error: null };
let _wx = null;
let _icalEvents = [];

const BRIDGE = localStorage.getItem("os_bridge_url") || "http://localhost:3333";

// ── Helpers ────────────────────────────────────────────────────
const _esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function tod() { return new Date().toISOString().slice(0, 10); }
function fmt12(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function dbu(b) {
  if (!b) return null;
  const p = b.split("-");
  if (p.length < 3) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const nx = new Date(t.getFullYear(), +p[1] - 1, +p[2]);
  if (nx < t) nx.setFullYear(t.getFullYear() + 1);
  return Math.round((nx - t) / 86400e3);
}
function ini(c) { return ((c.fname || "")[0] + (c.lname || "")[0] || "??").toUpperCase(); }
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ── Debrief ────────────────────────────────────────────────────
async function generateDebrief(todayEvents, reminders) {
  if (!getApiKey()) {
    _debrief = { text: null, loading: false, date: tod(), error: "no_key" };
    render(); return;
  }
  const cached = getCachedDebrief();
  if (cached) {
    _debrief = { text: cached, loading: false, date: tod(), error: null };
    render(); return;
  }
  _debrief = { text: null, loading: true, date: tod(), error: null };
  render();
  const { text, error } = await getDebrief(todayEvents, reminders);
  _debrief = { text, loading: false, date: tod(), error };
  render();
}

// ── Render ──────────────────────────────────────────────────────
function render() {
  if (!_container || !_ctx) return;
  const S = _ctx.state();
  const {
    contacts = [], reminders = [], events = [], syncedEvents = [], syncedReminders = [],
    bills = [], householdTasks = [], familyMembers = [], weekDinners,
  } = S;

  const today = tod();
  const allEvents   = [...events, ...syncedEvents, ..._icalEvents];
  // Deduplicate by title+date in case ical and syncedEvents overlap
  const seen = new Set();
  const todayEvents = allEvents
    .filter(e => {
      const key = `${e.date}|${e.title}`;
      if (e.date !== today || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.time || "99:99") < (b.time || "99:99") ? -1 : 1);

  // Merge Firestore reminders + Apple Reminders (deduplicate by title)
  const firestoreTitles = new Set(reminders.map(r => r.title));
  const mergedReminders = [
    ...reminders,
    ...syncedReminders.filter(r => !firestoreTitles.has(r.title)),
  ];
  const dueRem      = mergedReminders.filter(r => !r.completed && r.dueDate && r.dueDate <= today);
  const upcomingRem = mergedReminders.filter(r => !r.completed && (!r.dueDate || r.dueDate > today)).slice(0, 4);
  const overdueBills = bills.filter(b => !b.paid && b.dueDate <= today);
  const unpaidBills  = bills.filter(b => !b.paid);
  const birthdays   = contacts
    .filter(c => c.birthday)
    .map(c => ({ ...c, days: dbu(c.birthday) }))
    .filter(c => c.days !== null && c.days <= 30)
    .sort((a, b) => a.days - b.days);

  const todayDinner = weekDinners?.days?.[new Date().toLocaleDateString("en-US", { weekday: "long" })];
  const hasApiKey   = !!getApiKey();

  // Hide the module-level top-bar on home (we use the mission strip instead)
  const topBar = document.getElementById("top-bar");
  if (topBar) topBar.classList.add("hidden");

  _container.innerHTML = `
    <div style="padding: var(--space-5); max-width: 1200px; margin: 0 auto;">

      <!-- Greeting row -->
      <div style="margin-bottom: var(--space-5); display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-4);">
        <div>
          <div style="font-family:'Space Grotesk',sans-serif; font-size: 28px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; line-height: 1.1;">
            ${greeting()}, Michael.
          </div>
          <div style="font-size: var(--text-sm); color: var(--text-secondary); margin-top: 4px;">
            ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </div>
        </div>
        <div style="display:flex;gap:var(--space-3);flex-shrink:0;">
          ${statPill("📅", todayEvents.length, "today", "#FF3B30")}
          ${statPill("✓", dueRem.length, "due", "#FF9500")}
          ${statPill("💰", overdueBills.length, "overdue", "#EF4444")}
          ${statPill("🎂", birthdays.filter(b => b.days <= 14).length, "bdays", "#00D4FF")}
        </div>
      </div>

      <!-- Bento grid -->
      <div class="bento">

        <!-- Debrief — spans full width -->
        ${debriefTile(hasApiKey)}

        <!-- Row 1: Schedule (left 8) + Weather (right 4) -->
        <div class="snap-tile bento-8 snap-tile--clickable" data-nav="calendar" style="min-height:280px;">
          ${tileHeader("📅", "Today's Schedule", "Full calendar", "calendar")}
          <div class="snap-tile__body" style="padding:0;">
            ${calendarTileBody(todayEvents)}
          </div>
        </div>

        <div class="snap-tile bento-4" style="min-height:280px;">
          ${tileHeader("🌤", "Weather", "7-day", "weather")}
          <div class="snap-tile__body" style="padding:var(--space-4);">
            ${weatherTileBody()}
          </div>
        </div>

        <!-- Row 2: Tasks (6) + CRM (6) -->
        <div class="snap-tile bento-6 snap-tile--clickable" data-nav="reminders">
          ${tileHeader("✓", "Tasks & Reminders", "All", "reminders")}
          <div class="snap-tile__body" style="padding:0;">
            ${remindersTileBody(dueRem, upcomingRem)}
          </div>
        </div>

        <div class="snap-tile bento-6 snap-tile--clickable" data-nav="crm">
          ${tileHeader("👥", "Inner Circle", "Open", "crm")}
          <div class="snap-tile__body">
            ${crmTileBody(contacts, birthdays)}
          </div>
        </div>

        <!-- Row 3: Finance (4) + Meals (4) + Family (4) -->
        <div class="snap-tile bento-4 snap-tile--clickable" data-nav="finances">
          ${tileHeader("💰", "Finance Snapshot", "Details", "finances")}
          <div class="snap-tile__body">
            ${financeTileBody(unpaidBills, overdueBills)}
          </div>
        </div>

        <div class="snap-tile bento-4 snap-tile--clickable" ${todayDinner ? 'data-open-dinner' : 'data-nav="meals"'}>
          ${tileHeader("🍽️", "Tonight's Dinner", "Meals", "meals")}
          <div class="snap-tile__body">
            ${mealsTileBody(todayDinner)}
          </div>
        </div>

        <div class="snap-tile bento-4 snap-tile--clickable" data-nav="household">
          ${tileHeader("🏠", "Household", "All tasks", "household")}
          <div class="snap-tile__body">
            ${householdTileBody(householdTasks)}
          </div>
        </div>

      </div>

      ${_dinnerModal.open ? renderDinnerModal(weekDinners) : ""}
    </div>
  `;

  bindEvents();
}

// ── Tile builders ───────────────────────────────────────────────

function statPill(icon, count, label, color) {
  if (!count) return "";
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;
      background:${color}18;border:1px solid ${color}30;border-radius:var(--radius-md);
      padding:var(--space-2) var(--space-3);min-width:52px;">
      <div style="font-size:var(--text-lg);font-weight:800;color:${color}">${count}</div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${color};letter-spacing:.06em">${icon} ${label}</div>
    </div>
  `;
}

const TILE_PROMPTS = {
  calendar:  "What does my schedule look like today? Any conflicts or things I should prep for?",
  weather:   "How's the weather this week? Anything I should plan around?",
  reminders: "What tasks need my attention? What's overdue or coming up soon?",
  crm:       "Who should I reach out to? Any birthdays or people I haven't connected with in a while?",
  finances:  "How are my finances looking? Any bills overdue or coming up?",
  meals:     "What's for dinner tonight? Any suggestions or prep I need to do?",
  household: "What household tasks need attention? What's most urgent?",
};

function tileHeader(icon, label, cta, tileKey) {
  const aiBtn = tileKey ? `
    <button class="tile-ai-btn" data-tile-ai="${tileKey}"
      style="background:none;border:1px solid rgba(0,212,255,0.3);color:var(--accent);padding:3px 8px;
        border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit;
        letter-spacing:0.5px;flex-shrink:0;transition:all .15s;"
      onmouseover="this.style.background='rgba(0,212,255,0.1)'"
      onmouseout="this.style.background='none'">✦ AI</button>` : "";
  return `
    <div class="snap-tile__header">
      <div class="snap-tile__title">${icon} ${label}</div>
      <div style="display:flex;align-items:center;gap:8px">${aiBtn}<span class="snap-tile__arrow">→</span></div>
    </div>
  `;
}

function calendarTileBody(todayEvents) {
  // If nothing today, show next upcoming events across all sources
  const S = _ctx ? _ctx.state() : {};
  let displayEvents = todayEvents;
  if (!displayEvents.length) {
    const today = tod();
    const allFuture = [...(S.events || []), ...(S.syncedEvents || []), ..._icalEvents]
      .filter(e => e.date > today)
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || "") < (b.time || "") ? -1 : 1);
    // Deduplicate
    const seen = new Set();
    displayEvents = allFuture.filter(e => {
      const key = `${e.date}|${e.title}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 5);
  }

  if (!displayEvents.length) {
    return `<div style="padding:var(--space-5);text-align:center;color:var(--text-secondary);font-size:var(--text-sm)">🎉 Nothing on the calendar</div>`;
  }

  const today = tod();
  return displayEvents.map(e => {
    const color = e.color || "var(--accent)";
    const isUpcoming = e.date !== today;
    const dateLabel = isUpcoming
      ? new Date(e.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      : (e.time ? fmt12(e.time) : "All day");
    return `
      <div style="display:flex;align-items:center;gap:var(--space-3);padding:10px var(--space-4);border-bottom:1px solid var(--separator);">
        <div style="width:3px;min-height:28px;border-radius:2px;background:${color};flex-shrink:0;align-self:stretch;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:var(--text-sm);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(e.title)}</div>
          <div style="font-size:var(--text-xs);color:var(--text-secondary);">${dateLabel}${e.location ? " · " + _esc(e.location) : ""}</div>
        </div>
        ${isUpcoming ? `<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-tertiary);flex-shrink:0;">${e.date.slice(5)}</div>` : ""}
      </div>
    `;
  }).join("");
}

function remindersTileBody(due, upcoming) {
  if (!due.length && !upcoming.length) {
    return `<div style="padding:var(--space-5);text-align:center;color:var(--text-secondary);font-size:var(--text-sm)">✅ All clear!</div>`;
  }
  const items = [...due.map(r => ({ ...r, _overdue: true })), ...upcoming].slice(0, 6);
  return items.map(r => `
    <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--separator);">
      <div style="width:7px;height:7px;border-radius:50%;background:${r._overdue ? "var(--color-red)" : "var(--color-orange)"};flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;font-size:var(--text-sm);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${_esc(r.title)}
      </div>
      ${r._overdue ? `<span style="font-size:9px;font-weight:700;color:var(--color-red);text-transform:uppercase;">Due</span>` : ""}
    </div>
  `).join("");
}

function crmTileBody(contacts, birthdays) {
  return `
    <div style="display:flex;gap:var(--space-5);align-items:flex-start;">
      <div style="text-align:center;">
        <div style="font-size:36px;font-weight:800;color:var(--accent);line-height:1;">${contacts.length}</div>
        <div style="font-size:var(--text-xs);color:var(--text-secondary);font-weight:600;">People</div>
      </div>
      <div style="flex:1;min-width:0;">
        ${birthdays.length ? `
          <div style="font-size:var(--text-xs);font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.06em;margin-bottom:var(--space-2);">Upcoming 🎂</div>
          ${birthdays.slice(0, 3).map(c => {
            const col = c.days === 0 ? "var(--color-red)" : c.days <= 7 ? "var(--color-orange)" : "var(--accent)";
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-1);">
                <div style="font-size:var(--text-sm);font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(c.fname)} ${_esc(c.lname)}</div>
                <div style="font-size:var(--text-xs);font-weight:700;color:${col};flex-shrink:0;margin-left:var(--space-2);">
                  ${c.days === 0 ? "Today!" : c.days === 1 ? "Tomorrow" : c.days + "d"}
                </div>
              </div>
            `;
          }).join("")}
        ` : `<div style="font-size:var(--text-sm);color:var(--text-secondary);">No birthdays in next 30 days 🎉</div>`}
      </div>
    </div>
  `;
}

function financeTileBody(unpaid, overdue) {
  if (!unpaid.length && !overdue.length) {
    return `<div style="text-align:center;color:var(--text-secondary);font-size:var(--text-sm);">Add bills & budget to get started.</div>`;
  }
  const totalDue = unpaid.reduce((s, b) => s + (b.amount || 0), 0);
  return `
    <div style="display:flex;gap:var(--space-5);align-items:center;">
      <div style="text-align:center;">
        <div style="font-size:28px;font-weight:800;color:${overdue.length ? "var(--color-red)" : "var(--color-green)"};line-height:1;">
          $${totalDue.toFixed(0)}
        </div>
        <div style="font-size:var(--text-xs);color:var(--text-secondary);font-weight:600;">${unpaid.length} pending</div>
      </div>
      ${overdue.length ? `
        <div style="flex:1;min-width:0;">
          <div style="font-size:var(--text-xs);font-weight:700;color:var(--color-red);text-transform:uppercase;letter-spacing:.06em;margin-bottom:var(--space-2);">⚠️ Overdue</div>
          ${overdue.slice(0, 3).map(b => `
            <div style="font-size:var(--text-sm);font-weight:600;color:var(--text-primary);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${_esc(b.name)} — $${b.amount}
            </div>
          `).join("")}
        </div>
      ` : `<div style="font-size:var(--text-sm);color:var(--color-green);font-weight:600;">✅ All current</div>`}
    </div>
  `;
}

function mealsTileBody(dinner) {
  if (!dinner) {
    return `<div style="text-align:center;color:var(--text-secondary);font-size:var(--text-sm);">No dinner planned tonight.<br><span style="color:var(--accent);font-weight:600;">Tap to plan →</span></div>`;
  }
  const macros = [dinner.protein ? `🥩 ${_esc(dinner.protein)}` : "", dinner.calories ? `🔥 ${_esc(dinner.calories)}` : ""].filter(Boolean).join(" · ");
  return `
    <div>
      <div style="font-size:var(--text-lg);font-weight:700;color:var(--text-primary);margin-bottom:4px;">
        ${_esc(dinner.name)} ${dinner.freezable ? "❄️" : ""}
      </div>
      ${macros ? `<div style="font-size:var(--text-xs);color:var(--color-orange);font-weight:600;">${macros}</div>` : ""}
      ${dinner.prepTime ? `<div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:4px;">⏱ ${_esc(dinner.prepTime)}</div>` : ""}
      <div style="font-size:var(--text-xs);color:var(--accent);margin-top:var(--space-2);font-weight:600;">Tap to see recipe →</div>
    </div>
  `;
}

function familyTileBody(members) {
  if (!members.length) {
    return `<div style="text-align:center;color:var(--text-secondary);font-size:var(--text-sm);">Set up your Family OS →</div>`;
  }
  return `
    <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;">
      ${members.map(m => `
        <div style="text-align:center;min-width:48px;">
          <div style="width:40px;height:40px;border-radius:50%;background:${m.color || "#AF52DE"}22;color:${m.color || "#AF52DE"};
            display:flex;align-items:center;justify-content:center;font-size:18px;margin:0 auto var(--space-1);">
            ${m.emoji || m.name[0]}
          </div>
          <div style="font-size:var(--text-xs);font-weight:600;color:var(--text-secondary);">${_esc(m.name)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function weatherTileBody() {
  if (!_wx) {
    return `<div style="text-align:center;color:var(--text-secondary);font-size:var(--text-sm);padding:var(--space-4) 0;">
      <span class="spinner-sm" style="margin-bottom:var(--space-2);display:block;margin:0 auto var(--space-2);"></span>
      Loading weather…
    </div>`;
  }
  const { tempF, desc, emoji, wind, daily = [] } = _wx;
  const dayForecast = daily.slice(1, 5); // skip today, show next 4 days
  return `
    <div>
      <!-- Big temp -->
      <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);">
        <div style="font-size:44px;line-height:1;">${emoji}</div>
        <div>
          <div style="font-family:'Space Grotesk',sans-serif;font-size:52px;font-weight:700;color:var(--text-primary);line-height:1;letter-spacing:-0.03em;">${tempF}°</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-top:2px;">${desc}</div>
        </div>
      </div>
      <!-- Wind -->
      <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--space-4);">
        💨 ${wind} mph
      </div>
      <!-- 4-day forecast -->
      ${dayForecast.length ? `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-2);border-top:1px solid var(--separator);padding-top:var(--space-3);">
          ${dayForecast.map(d => `
            <div style="text-align:center;">
              <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-tertiary);margin-bottom:4px;">${d.day}</div>
              <div style="font-size:18px;margin-bottom:4px;">${d.emoji}</div>
              <div style="font-size:var(--text-xs);font-weight:700;color:var(--text-primary);">${d.hi}°</div>
              <div style="font-size:var(--text-xs);color:var(--text-secondary);">${d.lo}°</div>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function householdTileBody(tasks) {
  const open = tasks.filter(t => !t.done);
  const urgent = open.filter(t => t.priority === "high");
  if (!open.length) {
    return `<div style="text-align:center;color:var(--text-secondary);font-size:var(--text-sm);">✅ No open tasks</div>`;
  }
  return `
    <div style="display:flex;gap:var(--space-4);align-items:center;">
      <div style="text-align:center;">
        <div style="font-size:32px;font-weight:800;color:${urgent.length ? "var(--color-orange)" : "var(--text-primary)"};line-height:1;">${open.length}</div>
        <div style="font-size:var(--text-xs);color:var(--text-secondary);font-weight:600;">open tasks</div>
      </div>
      <div style="flex:1;min-width:0;">
        ${urgent.slice(0, 3).map(t => `
          <div style="font-size:var(--text-sm);font-weight:600;color:var(--color-orange);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            🔧 ${_esc(t.title)}
          </div>
        `).join("")}
        ${!urgent.length ? `<div style="font-size:var(--text-sm);color:var(--text-secondary);">Nothing urgent 👍</div>` : ""}
      </div>
    </div>
  `;
}

function debriefTile(hasApiKey) {
  if (_debrief.loading) {
    return `
      <div class="snap-tile bento-12" style="border-color:var(--accent);background:var(--accent-light);min-height:auto;">
        <div style="padding:var(--space-4);display:flex;align-items:center;gap:var(--space-3);">
          <span class="spinner-sm"></span>
          <span style="font-size:var(--text-sm);color:var(--accent);font-weight:600;">Preparing your daily briefing…</span>
        </div>
      </div>`;
  }
  if (_debrief.error || !_debrief.text) {
    if (!hasApiKey) return apiKeyTile();
    return `
      <div class="snap-tile bento-12" style="min-height:auto;">
        <div style="padding:var(--space-3) var(--space-4);display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);">
          <div style="font-size:var(--text-sm);color:var(--text-secondary);">☀️ Daily debrief — ${_debrief.error === "no_key" ? "add an API key below" : "failed to load"}</div>
          <button class="btn btn-primary btn-sm" id="regen-debrief">↻ Retry</button>
        </div>
      </div>`;
  }

  const html = _debrief.text.split("\n").map(line => {
    const t = line.trim();
    if (!t) return "";
    if (/^[☀️📅✅🌤💬🗓]/.test(t)) {
      return `<span style="font-weight:700;color:var(--text-primary);margin-right:var(--space-4);white-space:nowrap;">${t}</span>`;
    }
    return `<span style="color:var(--text-secondary);font-size:var(--text-sm);">${t}</span>`;
  }).filter(Boolean).join(" &nbsp;·&nbsp; ");

  return `
    <div class="snap-tile bento-12" style="border-color:var(--accent);background:var(--accent-light);min-height:auto;">
      <div style="padding:var(--space-3) var(--space-5);display:flex;align-items:center;gap:var(--space-4);">
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);flex-shrink:0;">☀️ Debrief</div>
        <div style="flex:1;min-width:0;font-size:var(--text-sm);line-height:1.5;overflow:hidden;">${html}</div>
        <button class="btn btn-ghost btn-sm" id="regen-debrief" style="flex-shrink:0;font-size:11px;color:var(--text-tertiary);">↻</button>
      </div>
    </div>`;
}

function apiKeyTile() {
  return `
    <div class="snap-tile bento-12" style="border-color:var(--color-orange);min-height:auto;">
      <div style="padding:var(--space-4) var(--space-5);">
        <div style="font-weight:700;margin-bottom:var(--space-2);">✨ Enable AI features</div>
        <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-3);">
          Add your Anthropic API key to unlock AI-drafted texts, gift ideas, and daily briefings.
        </div>
        <div style="display:flex;gap:var(--space-2);max-width:480px;">
          <input id="api-key-input" class="input" placeholder="sk-ant-…" style="font-size:var(--text-sm);">
          <button class="btn btn-primary" id="save-api-key">Save</button>
        </div>
      </div>
    </div>
  `;
}

// ── Dinner modal (recipe popup) ─────────────────────────────────
function renderDinnerModal(weekDinners) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const d = weekDinners?.days?.[today];
  if (!d) return "";
  const macros = [d.protein ? `🥩 ${_esc(d.protein)}` : "", d.calories ? `🔥 ${_esc(d.calories)}` : ""].filter(Boolean).join(" · ");
  const badges = [
    d.freezable ? `<span class="pill" style="background:#E3F2FD;color:#1565C0">❄️ Freezer-friendly</span>` : "",
    d.servings ? `<span class="pill" style="background:var(--bg-surface-2);color:var(--text-secondary)">makes ${_esc(d.servings)}</span>` : "",
    d.prepTime ? `<span class="pill" style="background:var(--bg-surface-2);color:var(--text-secondary)">⏱ ${_esc(d.prepTime)}</span>` : "",
  ].filter(Boolean).join(" ");
  const hasSteps = Array.isArray(d.steps) && d.steps.length;

  return `
    <div class="modal-overlay">
      <div class="modal" style="max-width:560px">
        <div class="modal-header">
          <h2>${_esc(d.name)}</h2>
          <button class="btn btn-ghost btn-sm" id="dinner-close">✕</button>
        </div>
        <div class="modal-body">
          ${badges ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">${badges}</div>` : ""}
          ${macros ? `<div style="font-size:var(--text-sm);font-weight:700;color:var(--color-orange);">${macros}</div>` : ""}
          ${d.storage ? `<div style="font-size:var(--text-sm);color:var(--text-secondary);">🧊 ${_esc(d.storage)}</div>` : ""}
          ${(d.ingredients && d.ingredients.length) ? `
            <div class="section-title" style="margin-bottom:var(--space-2)">Ingredients</div>
            <ul style="margin:0;padding-left:1.1rem;font-size:var(--text-sm);line-height:1.7">
              ${d.ingredients.map(i => `<li>${_esc(i)}</li>`).join("")}
            </ul>
          ` : ""}
          <div class="section-title" style="margin-bottom:var(--space-2)">Directions</div>
          ${_dinnerModal.loading ? `
            <div style="display:flex;align-items:center;gap:var(--space-2);color:var(--text-secondary);font-size:var(--text-sm);">
              <span class="spinner-sm"></span> Writing the recipe…
            </div>
          ` : hasSteps ? `
            <ol style="margin:0;padding-left:1.2rem;font-size:var(--text-sm);line-height:1.7">
              ${d.steps.map(s => `<li style="margin-bottom:6px">${_esc(s)}</li>`).join("")}
            </ol>
          ` : `<div style="font-size:var(--text-sm);color:var(--text-tertiary)">No directions yet.</div>`}
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm" data-nav="meals">🍽️ Plan meals</button>
          <button class="btn btn-primary" id="dinner-done">Done</button>
        </div>
      </div>
    </div>
  `;
}

async function openDinnerModal() {
  _dinnerModal.open = true;
  _dinnerModal.loading = false;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const wd = _ctx.state().weekDinners;
  const d = wd?.days?.[today];
  if (d && !(Array.isArray(d.steps) && d.steps.length)) {
    _dinnerModal.loading = true; render();
    const detail = await generateRecipeDetail(d, "family");
    if (detail && Array.isArray(detail.steps)) {
      const merged = { ...d, steps: detail.steps,
        ingredients: (d.ingredients && d.ingredients.length) ? d.ingredients : (detail.ingredients || []),
        storage: detail.storage || d.storage || "", prepTime: detail.prepTime || d.prepTime || "",
        servings: d.servings || detail.servings || "", freezable: d.freezable ?? detail.freezable ?? false };
      const days = { ...(wd.days || {}), [today]: merged };
      const { setState } = await import("../js/state.js");
      setState({ weekDinners: { ...wd, days } });
      dbSet(refs.weekDinners(), { id: "weekDinners", days }).catch(() => {});
    }
    _dinnerModal.loading = false; render();
  } else { render(); }
}

// ── (AI assistant moved to js/global-ai.js) ────────────────────
function _unused_renderAiSheet() {
  if (!_ai.open) return "";
  const hasMic = typeof SpeechRecognition !== "undefined" || typeof webkitSpeechRecognition !== "undefined";
  const msgs = _ai.msgs.map(m => `
    <div style="display:flex;flex-direction:${m.role==="user"?"row-reverse":"row"};gap:8px;align-items:flex-start;margin-bottom:12px">
      <div style="
        max-width:82%;padding:10px 14px;border-radius:${m.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px"};
        background:${m.role==="user"?"var(--accent)":"var(--bg-surface-2)"};
        color:${m.role==="user"?"#000":"var(--text-primary)"};
        font-size:var(--text-sm);line-height:1.5;white-space:pre-wrap;
      ">${m.html ? m.text : _esc(m.text)}</div>
    </div>
  `).join("");

  return `
    <div id="ai-sheet-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;backdrop-filter:blur(4px)"></div>
    <div id="ai-sheet" style="
      position:fixed;bottom:0;left:0;right:0;z-index:1001;
      background:var(--bg-surface);border-radius:20px 20px 0 0;
      border-top:1px solid var(--separator);
      max-height:80dvh;display:flex;flex-direction:column;
      animation:slideUp .25s ease;
    ">
      <style>@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}</style>
      <!-- Handle -->
      <div style="padding:12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--separator)">
        <div style="font-size:13px;font-weight:700;color:var(--accent);display:flex;align-items:center;gap:6px">
          ✦ <span style="color:var(--text-primary)">Ask Claude</span>
        </div>
        <button id="ai-close" style="background:none;border:none;color:var(--text-tertiary);font-size:20px;cursor:pointer;padding:0 4px">×</button>
      </div>
      <!-- Messages -->
      <div id="ai-msgs" style="flex:1;overflow-y:auto;padding:16px;min-height:80px;max-height:50dvh">
        ${msgs || `<div style="color:var(--text-tertiary);font-size:var(--text-sm);text-align:center;padding:24px 0">
          Ask me anything about your week, or tell me what to add.<br>
          <span style="font-size:11px;opacity:.7">"What's on this week?" · "Add dentist Friday 2pm" · "Remind me to call Dad" · "How's my protein today?"</span>
        </div>`}
        ${_ai.busy ? `<div style="display:flex;gap:4px;padding:8px 0;align-items:center">
          <div style="width:7px;height:7px;border-radius:50%;background:var(--accent);animation:pulse 1s infinite"></div>
          <div style="width:7px;height:7px;border-radius:50%;background:var(--accent);animation:pulse 1s .2s infinite"></div>
          <div style="width:7px;height:7px;border-radius:50%;background:var(--accent);animation:pulse 1s .4s infinite"></div>
          <style>@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}</style>
        </div>` : ""}
      </div>
      <!-- Input -->
      <div style="padding:12px;border-top:1px solid var(--separator);display:flex;gap:8px;align-items:flex-end">
        <textarea id="ai-input" rows="1"
          placeholder="Ask anything or give a command…"
          style="flex:1;resize:none;background:var(--bg-surface-2);border:1px solid var(--separator);border-radius:12px;padding:10px 12px;font-size:var(--text-sm);color:var(--text-primary);line-height:1.4;max-height:120px;overflow-y:auto"
          ${_ai.busy ? "disabled" : ""}
        >${_esc(_ai.input)}</textarea>
        ${hasMic ? `<button id="ai-mic" style="width:40px;height:40px;border-radius:50%;background:${_ai.listening?"#EF4444":"var(--bg-surface-2)"};border:1px solid var(--separator);font-size:18px;cursor:pointer;flex-shrink:0">${_ai.listening?"🔴":"🎙️"}</button>` : ""}
        <button id="ai-send" ${_ai.busy?"disabled":""} style="width:40px;height:40px;border-radius:50%;background:var(--accent);color:#000;font-size:18px;border:none;cursor:pointer;flex-shrink:0;font-weight:700">↑</button>
      </div>
    </div>
  `;
}

function _unused_buildContext() {
  const S = _ctx.state();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const dow = today.toLocaleDateString("en-US", { weekday: "long" });
  const allEvents = [...(S.events || []), ..._icalEvents];

  // Next 7 days of events
  const upcoming = allEvents
    .filter(e => e.date >= todayStr && e.date <= new Date(today.getTime() + 7*86400000).toISOString().slice(0,10))
    .sort((a,b) => a.date < b.date ? -1 : 1)
    .slice(0, 40)
    .map(e => `${e.date} ${e.time||"all day"}: ${e.title}${e.location ? " @ "+e.location : ""}`)
    .join("\n");

  // Due reminders
  const reminders = (S.reminders || [])
    .filter(r => !r.completed)
    .slice(0, 20)
    .map(r => `- ${r.title}${r.due ? " (due "+r.due+")" : ""}${r.list ? " ["+r.list+"]" : ""}`)
    .join("\n");

  // Contacts
  const contacts = (S.contacts || [])
    .slice(0, 50)
    .map(c => `${c.fname} ${c.lname}${c.phone ? " (phone:"+c.phone+")" : ""}${c.note ? " — "+c.note : ""}`)
    .join("\n");

  // Transformation
  const txWeight = localStorage.getItem("transformation_weight");
  const txKey = todayStr.replace(/-/g,"");
  const txProtein = localStorage.getItem(`transformation_protein_${txKey}`);

  return `You are Claude, the personal assistant inside the Ebberts Command Center app.
Today is ${dow}, ${todayStr}. The user is Michael Ebberts.

UPCOMING EVENTS (next 7 days):
${upcoming || "No events found"}

ACTIVE REMINDERS:
${reminders || "None"}

CONTACTS (name, phone, background):
${contacts || "None"}

TRANSFORMATION: Current weight: ${txWeight||"unknown"}lbs, Protein today: ${txProtein||"0"}g

YOUR CALENDARS: Family (default), Georgie (George's events), Ebberts Family, Calendar, John Deere Travel

Respond conversationally and helpfully. When the user wants to DO something, include a JSON actions array at the very end of your response in this exact format — nothing after it:

ACTIONS:
[{"type":"add_calendar","title":"...","date":"YYYY-MM-DD","time":"HH:mm","endTime":"HH:mm","location":"...","calendar":"Family"},
 {"type":"add_reminder","title":"...","due":"YYYY-MM-DD","time":"HH:mm","list":"Reminders","priority":"none","notes":"..."},
 {"type":"text_contact","contact_name":"First Last","context":"brief reason/content for the text"}]

- "add_calendar" for events, "add_reminder" for tasks. Add emojis to reminder titles.
- "text_contact" when the user wants to text someone from their contacts — I will draft the message, show an iMessage link, and log a note. Use the contact's full name from the CONTACTS list.
- Only include the ACTIONS block when taking action — omit it for pure questions.`;
}

async function _unused_sendToAI(text) {
  if (!text.trim() || _ai.busy) return;
  _ai.msgs.push({ role: "user", text: text.trim() });
  _ai.input = "";
  _ai.busy = true;
  renderSheet();

  try {
    const { callAIChat } = await import("../js/ai.js");
    const messages = _ai.msgs.filter(m => !m.html).map(m => ({ role: m.role, content: m.text }));
    const full = await callAIChat(messages, buildContext(), 1024);

    // Split reply from actions block
    const actionSplit = full.indexOf("\nACTIONS:");
    const replyText = actionSplit > -1 ? full.slice(0, actionSplit).trim() : full.trim();
    const actionBlock = actionSplit > -1 ? full.slice(actionSplit + 9).trim() : null;

    _ai.msgs.push({ role: "assistant", text: replyText });
    _ai.busy = false;
    renderSheet();

    if (actionBlock) await executeActions(actionBlock);
  } catch(e) {
    _ai.msgs.push({ role: "assistant", text: "Something went wrong: " + e.message });
    _ai.busy = false;
    renderSheet();
  }
}

async function _unused_executeActions(actionBlock) {
  let actions;
  try { actions = JSON.parse(actionBlock); } catch { return; }
  if (!Array.isArray(actions)) return;

  for (const a of actions) {
    if (a.type === "add_calendar") {
      try {
        const r = await fetch(`${BRIDGE}/calendar/add`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(a),
        });
        const d = await r.json();
        if (!d.ok) throw new Error("bridge failed");
        showToast(`📅 "${a.title}" added to ${a.calendar||"Family"}`);
      } catch {
        // Fallback: save to Firestore manual events
        const ev = { id: uid(), title: a.title, date: a.date, time: a.time||"",
          endTime: a.endTime||"", location: a.location||"", calendar: a.calendar||"Family",
          color: "#007AFF", source: "manual" };
        await dbSet(refs.event(ev.id), ev);
        showToast(`📅 "${a.title}" saved (syncs to Calendar when Mac is reachable)`);
      }
    }
    if (a.type === "text_contact") {
      const { callAI } = await import("../js/ai.js");
      const contacts = _ctx.state().contacts || [];
      const nameLower = (a.contact_name || "").toLowerCase();
      const contact = contacts.find(c =>
        (c.fname + " " + c.lname).toLowerCase() === nameLower
      ) || contacts.find(c =>
        (c.fname + " " + c.lname).toLowerCase().includes(nameLower.split(" ")[0])
      );
      if (!contact) {
        _ai.msgs.push({ role: "assistant", text: `⚠️ Couldn't find a contact matching "${a.contact_name}".` });
        renderSheet(); continue;
      }
      const draft = await callAI(
        `Write a short casual iMessage from Michael to ${contact.fname} about: ${a.context}. Background: ${contact.note || "friend"}. Easygoing dad energy. 1-2 sentences. Just the message text.`,
        { maxTokens: 120 }
      );
      if (!draft) { renderSheet(); continue; }
      const phone = contact.phone ? String(contact.phone).replace(/\D/g,"") : null;
      const smsLink = phone ? `sms:+${phone}?body=${encodeURIComponent(draft)}` : null;
      const contactId = contact.id;
      // Log note in Firestore immediately
      const note = { id: uid(), date: tod(), text: "Texted: " + draft };
      const fresh = contacts.find(x => x.id === contactId);
      const updatedNotes = [note, ...((fresh?.contactNotes) || [])];
      await dbSet(refs.contact(contactId), { ...fresh, contactNotes: updatedNotes, lastContact: tod() });
      // Show result in chat as HTML card
      const draftEsc = draft.replace(/&/g,"&amp;").replace(/</g,"&lt;");
      _ai.msgs.push({ role: "assistant", html: true, text:
        `<div style="font-size:12px;font-weight:700;color:var(--text-tertiary);margin-bottom:4px">📱 ${contact.fname} ${contact.lname}</div>` +
        `<div style="font-style:italic;line-height:1.6;margin-bottom:8px">"${draftEsc}"</div>` +
        (smsLink ? `<a href="${smsLink}" style="display:inline-block;padding:6px 14px;border-radius:20px;background:var(--color-green);color:#fff;font-size:12px;font-weight:700;text-decoration:none;margin-bottom:6px">📱 Open in Messages</a><br>` : "") +
        `<div style="font-size:11px;color:var(--text-tertiary)">✅ Note logged in CRM</div>`
      });
      renderSheet(); continue;
    }
    if (a.type === "add_reminder") {
      try {
        const r = await fetch(`${BRIDGE}/reminders/add`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: a.title, due: a.due||"", time: a.time||"",
            list: a.list||"Reminders", priority: a.priority||"none", notes: a.notes||"" }),
        });
        const d = await r.json();
        if (!d.ok) throw new Error();
        showToast(`✓ "${a.title}" added to Reminders`);
      } catch {
        // Fallback: save to Firestore
        const rem = { id: uid(), title: a.title, due: a.due||null, completed: false,
          list: a.list||"Reminders", priority: a.priority||"none", notes: a.notes||"", tags: [] };
        await dbSet(refs.reminder(rem.id), rem);
        showToast(`✓ "${a.title}" saved`);
      }
    }
  }
}


// ── Event binding ───────────────────────────────────────────────
function bindEvents() {
  if (!_container) return;

  _container.querySelectorAll("[data-tile-ai]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const prompt = TILE_PROMPTS[btn.dataset.tileAi];
      if (prompt) openWithPrompt(prompt);
    });
  });

  _container.querySelectorAll("[data-nav]").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();
      _ctx.navigate(el.dataset.nav);
    });
  });

  _container.querySelectorAll("[data-open-dinner]").forEach(el => {
    el.addEventListener("click", e => { e.stopPropagation(); openDinnerModal(); });
  });

  const dinnerClose = _container.querySelector("#dinner-close, #dinner-done");
  if (dinnerClose) dinnerClose.addEventListener("click", () => { _dinnerModal.open = false; render(); });
  const dinnerDone = _container.querySelector("#dinner-done");
  if (dinnerDone) dinnerDone.addEventListener("click", () => { _dinnerModal.open = false; render(); });

  const regenBtn = _container.querySelector("#regen-debrief");
  if (regenBtn) {
    regenBtn.addEventListener("click", () => {
      localStorage.removeItem(`debrief_${tod()}`);
      const S = _ctx.state();
      const all = [...(S.events || []), ...(S.syncedEvents || [])];
      generateDebrief(all.filter(e => e.date === tod()), S.reminders || []);
    });
  }

  const saveBtn = _container.querySelector("#save-api-key");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const key = _container.querySelector("#api-key-input")?.value?.trim();
      if (key) {
        import("../js/ai.js").then(ai => {
          ai.setApiKey(key);
          showToast("API key saved ✓");
          _debrief.date = null;
          const S = _ctx.state();
          const all = [...(S.events || []), ...(S.syncedEvents || [])];
          generateDebrief(all.filter(e => e.date === tod()), S.reminders || []);
        });
      }
    });
  }
}

function showToast(msg) {
  const c = document.getElementById("toast-container");
  if (!c) return;
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Module exports ──────────────────────────────────────────────
export async function init(container, ctx) {
  _container = container;
  _ctx = ctx;

  const { subscribe } = await import("../js/state.js");
  const u = subscribe(state => {
    render();
    if (_debrief.date !== tod() && !_debrief.loading && getApiKey()) {
      const all = [...(state.events || []), ...(state.syncedEvents || [])];
      generateDebrief(all.filter(e => e.date === tod()), state.reminders || []);
    }
  });
  _unsubscribes.push(u);

  render();

  // Fetch calendar events from bridge (same source the Calendar module uses)
  fetchIcalEvents().then(evs => {
    if (!evs || !evs.length) return;
    _icalEvents = evs;
    render();
  }).catch(() => {});

  // Fetch weather (geolocation) — re-render when it arrives
  fetchWeatherDetail().then(wx => {
    if (!wx) return;
    _wx = wx;
    render();
    // Also update mission strip weather
    const icon = document.getElementById("ms-weather-icon");
    const temp = document.getElementById("ms-weather-temp");
    if (icon) icon.textContent = wx.emoji;
    if (temp) temp.textContent = `${wx.tempF}° ${wx.desc}`;
  });

  if (getApiKey() && _debrief.date !== tod()) {
    const S = ctx.state();
    const all = [...(S.events || []), ...(S.syncedEvents || [])];
    generateDebrief(all.filter(e => e.date === tod()), S.reminders || []);
  }
}

export function cleanup() {
  const topBar = document.getElementById("top-bar");
  if (topBar) topBar.classList.remove("hidden");

  _unsubscribes.forEach(u => u?.());
  _unsubscribes = [];
  _dinnerModal = { open: false, loading: false };
  _wx = null;
  _icalEvents = [];
  _container = null;
  _ctx = null;
}
