/**
 * Home — Ebberts Command Center dashboard
 * Bento grid of live snapshot tiles. Each tile navigates to its full module.
 */

import { getApiKey, generateRecipeDetail } from "../js/ai.js";
import { getDebrief, getCachedDebrief } from "../js/debrief.js";
import { refs, dbSet } from "../js/db.js";
import { fetchWeatherDetail } from "../js/weather.js";
import { fetchIcalEvents } from "../js/ical.js";

let _container = null;
let _ctx = null;
let _unsubscribes = [];
let _dinnerModal = { open: false, loading: false };
let _debrief = { text: null, loading: false, date: null, error: null };
let _wx = null;
let _icalEvents = [];

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
          ${tileHeader("📅", "Today's Schedule", "Full calendar")}
          <div class="snap-tile__body" style="padding:0;">
            ${calendarTileBody(todayEvents)}
          </div>
        </div>

        <div class="snap-tile bento-4" style="min-height:280px;">
          ${tileHeader("🌤", "Weather", "7-day")}
          <div class="snap-tile__body" style="padding:var(--space-4);">
            ${weatherTileBody()}
          </div>
        </div>

        <!-- Row 2: Tasks (6) + CRM (6) -->
        <div class="snap-tile bento-6 snap-tile--clickable" data-nav="reminders">
          ${tileHeader("✓", "Tasks & Reminders", "All")}
          <div class="snap-tile__body" style="padding:0;">
            ${remindersTileBody(dueRem, upcomingRem)}
          </div>
        </div>

        <div class="snap-tile bento-6 snap-tile--clickable" data-nav="crm">
          ${tileHeader("👥", "Inner Circle", "Open")}
          <div class="snap-tile__body">
            ${crmTileBody(contacts, birthdays)}
          </div>
        </div>

        <!-- Row 3: Finance (4) + Meals (4) + Family (4) -->
        <div class="snap-tile bento-4 snap-tile--clickable" data-nav="finances">
          ${tileHeader("💰", "Finance Snapshot", "Details")}
          <div class="snap-tile__body">
            ${financeTileBody(unpaidBills, overdueBills)}
          </div>
        </div>

        <div class="snap-tile bento-4 snap-tile--clickable" ${todayDinner ? 'data-open-dinner' : 'data-nav="meals"'}>
          ${tileHeader("🍽️", "Tonight's Dinner", "Meals")}
          <div class="snap-tile__body">
            ${mealsTileBody(todayDinner)}
          </div>
        </div>

        <div class="snap-tile bento-4 snap-tile--clickable" data-nav="household">
          ${tileHeader("🏠", "Household", "All tasks")}
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

function tileHeader(icon, label, cta) {
  return `
    <div class="snap-tile__header">
      <div class="snap-tile__title">${icon} ${label}</div>
      <span class="snap-tile__arrow">→</span>
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

// ── Event binding ───────────────────────────────────────────────
function bindEvents() {
  if (!_container) return;

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
