/**
 * Home Module — Morning Brief
 * Aggregates data from all other modules into one daily view.
 */

import { getApiKey, generateRecipeDetail } from "../js/ai.js";
import { getDebrief, getCachedDebrief } from "../js/debrief.js";
import { refs, dbSet } from "../js/db.js";

let _container = null;
let _ctx = null;
let _unsubscribes = [];
let _dinnerModal = { open: false, loading: false };

let _debrief = {
  text: null,
  loading: false,
  date: null,   // YYYY-MM-DD the debrief was generated for
  error: null,
};

// ── Debrief generator (shared logic in js/debrief.js) ───────────
async function generateDebrief(todayEvents, reminders) {
  if (!getApiKey()) {
    _debrief = { text: null, loading: false, date: tod(), error: "no_key" };
    render();
    return;
  }
  const cached = getCachedDebrief();
  if (cached) {
    _debrief = { text: cached, loading: false, date: tod(), error: null };
    render();
    return;
  }
  _debrief = { text: null, loading: true, date: tod(), error: null };
  render();

  const { text, error } = await getDebrief(todayEvents, reminders);
  _debrief = { text, loading: false, date: tod(), error };
  render();
}

// ── Helpers ────────────────────────────────────────────────────
function tod() { return new Date().toISOString().slice(0, 10); }
function fmt12(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2,"0")} ${h >= 12 ? "PM" : "AM"}`;
}
function daysSince(d) { if (!d) return 999; return Math.floor((Date.now() - new Date(d).getTime()) / 86400e3); }
function dbu(b) {
  if (!b) return null;
  const p = b.split("-");
  if (p.length < 3) return null;
  const t = new Date(); t.setHours(0,0,0,0);
  const nx = new Date(t.getFullYear(), +p[1]-1, +p[2]);
  if (nx < t) nx.setFullYear(t.getFullYear() + 1);
  return Math.round((nx - t) / 86400e3);
}
function ini(c) { return ((c.fname||"")[0] + (c.lname||"")[0] || "??").toUpperCase(); }
function nudgeList(contacts) {
  return contacts
    .filter(c => daysSince(c.lastContact) >= (c.nudgeDays || 30) * 0.8)
    .sort((a, b) => (daysSince(b.lastContact) / b.nudgeDays) - (daysSince(a.lastContact) / a.nudgeDays));
}
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
function todayLabel() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// ── Render ──────────────────────────────────────────────────────
function render() {
  if (!_container || !_ctx) return;
  const state = _ctx.state();
  const { contacts, reminders, events, icalEvents = [], bills, householdTasks, familyMembers, weekDinners } = state;

  const nudges = nudgeList(contacts);
  const birthdays = contacts
    .filter(c => c.birthday)
    .map(c => ({ ...c, dbu: dbu(c.birthday) }))
    .filter(c => c.dbu !== null && c.dbu <= 14)
    .sort((a, b) => a.dbu - b.dbu);

  const todayReminders = reminders.filter(r => !r.completed && r.dueDate <= tod());
  const allEvents      = [...events, ...icalEvents];
  const todayEvents    = allEvents.filter(e => e.date === tod()).sort((a,b) => (a.time||"") < (b.time||"") ? -1 : 1);
  const overdueBills   = bills.filter(b => !b.paid && b.dueDate <= tod());
  const openTasks      = householdTasks.filter(t => !t.done);
  const hasApiKey      = !!getApiKey();

  _container.innerHTML = `
    <div class="module-content">

      <!-- ── Greeting ─────────────────────────────────────── -->
      <div style="margin-bottom: var(--space-5)">
        <div style="font-size: var(--text-3xl); font-weight: 800; color: var(--text-primary); line-height: 1.1">
          ${greeting()}, Michael.
        </div>
        <div style="font-size: var(--text-md); color: var(--text-secondary); margin-top: var(--space-1)">
          ${todayLabel()}
        </div>
      </div>

      <!-- ── Stat bar ──────────────────────────────────────── -->
      <div class="stat-grid" style="margin-bottom: var(--space-5)">
        ${statCard("👥", contacts.length, "Contacts")}
        ${tonightStatCard(weekDinners)}
        ${statCard("🎂", birthdays.length, "Bdays soon", birthdays.length > 0 ? "var(--color-crm)" : null)}
        ${statCard("⏰", todayReminders.length, "Reminders due", todayReminders.length > 0 ? "var(--color-red)" : null)}
        ${statCard("📅", todayEvents.length, "Events today")}
        ${statCard("💰", overdueBills.length, "Bills due", overdueBills.length > 0 ? "var(--color-red)" : null)}
      </div>

      <!-- ── Main cards ─────────────────────────────────────── -->
      <div style="display: flex; flex-direction: column; gap: var(--space-4)">

        ${debriefCard()}
        ${nudgesCard(nudges)}
        ${birthdaysCard(birthdays)}
        ${todayEventsCard(todayEvents, reminders)}
        ${financePulseCard(bills, overdueBills)}
        ${familyCard(familyMembers)}
        ${householdCard(openTasks)}
        ${!hasApiKey ? apiKeyPrompt() : ""}

      </div>

      ${_dinnerModal.open ? renderDinnerModal(weekDinners) : ""}
    </div>
  `;

  bindEvents();
}

// ── Card builders ───────────────────────────────────────────────

const _esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;");

// Compact stat-grid card for tonight's dinner — tap to pop the full recipe
function tonightStatCard(weekDinners) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const d = weekDinners?.days?.[today];
  if (!d || !d.name) {
    return `
      <div class="stat-card" style="cursor:pointer" data-plan-dinner>
        <div class="stat-card__icon">🍽️</div>
        <div class="stat-card__value" style="font-size:var(--text-md);line-height:1.2;color:var(--text-tertiary)">Not set</div>
        <div class="stat-card__label">Tonight's dinner</div>
      </div>
    `;
  }
  return `
    <div class="stat-card" style="cursor:pointer" data-open-dinner-modal>
      <div class="stat-card__icon">🍽️</div>
      <div class="stat-card__value" style="font-size:var(--text-md);line-height:1.2">${_esc(d.name)} ${d.freezable?"❄️":""}</div>
      <div class="stat-card__label">Tonight's dinner</div>
    </div>
  `;
}

// Full recipe popup, shown on Home
function renderDinnerModal(weekDinners) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const d = weekDinners?.days?.[today];
  if (!d) return "";
  const macros = [d.protein?`🥩 ${_esc(d.protein)}`:"", d.calories?`🔥 ${_esc(d.calories)}`:""].filter(Boolean).join(" · ");
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
          <h2 style="font-size:var(--text-lg)">${_esc(d.name)}</h2>
          <button class="btn btn-ghost btn-sm" id="dinner-modal-close">✕</button>
        </div>
        <div class="modal-body">
          ${badges?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--space-2)">${badges}</div>`:""}
          ${macros?`<div style="font-size:var(--text-sm);font-weight:700;color:var(--color-orange);margin-bottom:var(--space-3)">${macros}</div>`:""}
          ${d.storage?`<div style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-3)">🧊 ${_esc(d.storage)}</div>`:""}

          ${(d.ingredients&&d.ingredients.length)?`
            <div class="section-title" style="margin-bottom:var(--space-2)">Ingredients</div>
            <ul style="margin:0 0 var(--space-4) 0;padding-left:1.1rem;font-size:var(--text-sm);line-height:1.7">
              ${d.ingredients.map(i=>`<li>${_esc(i)}</li>`).join("")}
            </ul>
          `:""}

          <div class="section-title" style="margin-bottom:var(--space-2)">Directions</div>
          ${_dinnerModal.loading ? `
            <div style="display:flex;align-items:center;gap:var(--space-2);color:var(--text-secondary);font-size:var(--text-sm);padding:var(--space-3) 0">
              <span class="spinner-sm"></span> Writing the recipe…
            </div>
          ` : hasSteps ? `
            <ol style="margin:0;padding-left:1.2rem;font-size:var(--text-sm);line-height:1.7">
              ${d.steps.map(s=>`<li style="margin-bottom:6px">${_esc(s)}</li>`).join("")}
            </ol>
          ` : `<div style="font-size:var(--text-sm);color:var(--text-tertiary)">No directions yet.</div>`}
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm" data-plan-dinner>🍽️ Change</button>
          <button class="btn btn-primary" id="dinner-modal-done">Done</button>
        </div>
      </div>
    </div>
  `;
}

// Open the recipe popup; lazy-generate directions (and persist) if missing
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
      const merged = {
        ...d, steps: detail.steps,
        ingredients: (d.ingredients && d.ingredients.length) ? d.ingredients : (detail.ingredients || []),
        storage: detail.storage || d.storage || "",
        prepTime: detail.prepTime || d.prepTime || "",
        servings: d.servings || detail.servings || "",
        freezable: d.freezable ?? detail.freezable ?? false,
      };
      const days = { ...(wd.days || {}), [today]: merged };
      const { setState } = await import("../js/state.js");
      setState({ weekDinners: { ...wd, days } });   // optimistic — render shows steps now
      dbSet(refs.weekDinners(), { id: "weekDinners", days }).catch(() => {});  // persist (cache)
    }
    _dinnerModal.loading = false; render();
  } else {
    render();
  }
}

function debriefCard() {
  if (_debrief.loading) {
    return `
      <div class="card" style="border:1.5px solid var(--accent);background:var(--accent-light)">
        <div style="padding:var(--space-5);text-align:center">
          <div style="font-size:var(--text-sm);color:var(--accent);font-weight:600;animation:pulse 1.5s infinite">
            ☀️ Command Central is preparing today's briefing…
          </div>
        </div>
      </div>`;
  }
  if (_debrief.error) {
    const msg = _debrief.error === "no_key"
      ? "☀️ Daily debrief requires an Anthropic API key — add it below."
      : "☀️ Debrief failed — check your API key or network, then retry.";
    return `
      <div class="card" style="border:1.5px solid var(--separator)">
        <div style="padding:var(--space-4);display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)">
          <div style="font-size:var(--text-sm);color:var(--text-secondary)">${msg}</div>
          <button class="btn btn-primary btn-sm" id="regen-debrief">↻ Retry</button>
        </div>
      </div>`;
  }
  if (!_debrief.text) return "";

  // Render debrief text — preserve line breaks, bold section headers
  const html = _debrief.text
    .split("\n")
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      // Section headers start with an emoji
      if (/^[☀️📅✅🌤💬]/.test(trimmed)) {
        return `<div style="font-weight:700;font-size:var(--text-sm);margin-top:var(--space-3);margin-bottom:var(--space-1);color:var(--text-primary)">${trimmed}</div>`;
      }
      return `<div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.6;padding-left:var(--space-3)">${trimmed}</div>`;
    })
    .join("");

  return `
    <div class="card" style="border:1.5px solid var(--accent);background:var(--accent-light)">
      <div style="padding:var(--space-4)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2)">
          <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)">Daily Debrief</div>
          <button class="btn btn-ghost btn-sm" id="regen-debrief" style="font-size:11px;color:var(--text-tertiary)">↻ Refresh</button>
        </div>
        ${html}
      </div>
    </div>`;
}

function statCard(icon, value, label, accentColor) {
  return `
    <div class="stat-card">
      <div class="stat-card__icon">${icon}</div>
      <div class="stat-card__value" style="${accentColor ? `color: ${accentColor}` : ""}">
        ${value}
      </div>
      <div class="stat-card__label">${label}</div>
    </div>
  `;
}

function nudgesCard(nudges) {
  if (!nudges.length) return "";
  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">👋 Reach out</div>
        <button class="btn btn-ghost btn-sm" data-nav="crm">See all →</button>
      </div>
      ${nudges.slice(0, 4).map(c => {
        const days = daysSince(c.lastContact);
        const ratio = days / (c.nudgeDays || 30);
        const [col, bg] = ratio >= 1.5 ? ["var(--color-red)", "var(--color-red-bg)"]
                        : ratio >= 0.8 ? ["var(--color-orange)", "var(--color-orange-bg)"]
                        : ["var(--color-green)", "var(--color-green-bg)"];
        return `
          <div class="list-row list-row--clickable" data-open-contact="${c.id}">
            <div class="avatar avatar-md" style="background:${c.color}22;color:${c.color}">${ini(c)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:var(--text-md)">${c.fname} ${c.lname}</div>
              <span class="pill" style="background:${bg};color:${col}">
                ${days === 999 ? "Never contacted" : days + "d ago"}
              </span>
            </div>
            <button class="btn btn-sm" style="background:var(--color-green);color:#fff" data-open-contact="${c.id}">
              Text 💬
            </button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function birthdaysCard(birthdays) {
  if (!birthdays.length) return "";
  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">🎂 Upcoming birthdays</div>
        <button class="btn btn-ghost btn-sm" data-nav="crm">All →</button>
      </div>
      ${birthdays.map(c => {
        const isToday = c.dbu === 0;
        const col = isToday ? "var(--color-red)" : c.dbu <= 7 ? "var(--color-orange)" : "var(--color-crm)";
        return `
          <div class="list-row list-row--clickable" data-open-contact="${c.id}">
            <div class="avatar avatar-md" style="background:${c.color}22;color:${c.color}">${ini(c)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700">${c.fname} ${c.lname}</div>
              <div style="font-size:var(--text-sm);color:var(--text-secondary)">
                ${new Date(c.birthday + "T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric"})}
              </div>
            </div>
            <div style="font-weight:800;color:${col};font-size:var(--text-sm)">
              ${isToday ? "🎉 Today!" : c.dbu === 1 ? "Tomorrow" : "In " + c.dbu + "d"}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function todayEventsCard(events, reminders) {
  const dueReminders = reminders.filter(r => !r.completed && r.dueDate <= tod());
  if (!events.length && !dueReminders.length) {
    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">📅 Today's schedule</div>
          <button class="btn btn-ghost btn-sm" data-nav="calendar">Calendar →</button>
        </div>
        <div style="padding: var(--space-5); text-align: center;">
          <div style="font-size: 28px; margin-bottom: var(--space-2)">🎉</div>
          <div style="color: var(--text-secondary); font-size: var(--text-sm)">
            Nothing scheduled — clear day!
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">📅 Today</div>
        <button class="btn btn-ghost btn-sm" data-nav="calendar">Calendar →</button>
      </div>
      ${events.map(e => `
        <div class="list-row">
          <div style="width:4px;height:36px;border-radius:2px;background:${e.color||"var(--accent)"};flex-shrink:0"></div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:var(--text-sm)">${e.title}</div>
            <div style="font-size:var(--text-xs);color:var(--text-secondary)">
              ${e.time ? fmt12(e.time) : "All day"}${e.location ? " · " + e.location : ""}
            </div>
          </div>
        </div>
      `).join("")}
      ${dueReminders.slice(0,3).map(r => `
        <div class="list-row">
          <div style="width:4px;height:36px;border-radius:2px;background:var(--color-orange);flex-shrink:0"></div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:var(--text-sm)">⏰ ${r.title}</div>
            <div style="font-size:var(--text-xs);color:var(--color-orange)">Reminder due</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function financePulseCard(bills, overdueBills) {
  if (!bills.length) {
    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">💰 Finances</div>
          <button class="btn btn-ghost btn-sm" data-nav="finances">Set up →</button>
        </div>
        <div style="padding: var(--space-4); text-align:center; color: var(--text-secondary); font-size: var(--text-sm)">
          Track bills, subscriptions, and budget here.
          <br><br>
          <button class="btn btn-primary btn-sm" data-nav="finances">Get started</button>
        </div>
      </div>
    `;
  }
  const unpaid = bills.filter(b => !b.paid);
  const totalDue = unpaid.reduce((s, b) => s + (b.amount || 0), 0);
  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">💰 Finance pulse</div>
        <button class="btn btn-ghost btn-sm" data-nav="finances">Details →</button>
      </div>
      <div style="padding: var(--space-4); display: flex; gap: var(--space-4)">
        <div style="flex:1; text-align:center">
          <div style="font-size:var(--text-2xl);font-weight:800;color:${overdueBills.length > 0 ? "var(--color-red)" : "var(--text-primary)"}">
            $${totalDue.toFixed(0)}
          </div>
          <div style="font-size:var(--text-xs);color:var(--text-secondary)">${unpaid.length} bills pending</div>
        </div>
        ${overdueBills.length > 0 ? `
          <div style="flex:1; text-align:center">
            <div style="font-size:var(--text-2xl);font-weight:800;color:var(--color-red)">${overdueBills.length}</div>
            <div style="font-size:var(--text-xs);color:var(--color-red)">Overdue</div>
          </div>
        ` : ""}
      </div>
      ${overdueBills.slice(0,2).map(b => `
        <div class="list-row" style="padding-top:var(--space-2);padding-bottom:var(--space-2)">
          <span style="font-size:14px">⚠️</span>
          <div style="flex:1;font-size:var(--text-sm)">
            <span style="font-weight:600">${b.name}</span>
            <span style="color:var(--color-red)"> — $${b.amount} overdue</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function familyCard(members) {
  if (!members.length) {
    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">👨‍👩‍👧‍👦 Family OS</div>
          <button class="btn btn-ghost btn-sm" data-nav="family">Set up →</button>
        </div>
        <div style="padding: var(--space-4); color: var(--text-secondary); font-size: var(--text-sm); text-align:center">
          Add your family members — wife, kids, pets —
          <br>and manage schedules in one place.
          <br><br>
          <button class="btn btn-primary btn-sm" data-nav="family">Set up Family OS</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">👨‍👩‍👧‍👦 Family</div>
        <button class="btn btn-ghost btn-sm" data-nav="family">Details →</button>
      </div>
      <div style="display:flex;gap:var(--space-3);padding:var(--space-4);flex-wrap:wrap">
        ${members.map(m => `
          <div style="text-align:center;min-width:56px">
            <div class="avatar avatar-md" style="margin:0 auto var(--space-1);background:${m.color||"#007AFF"}22;color:${m.color||"#007AFF"}">
              ${m.emoji || m.name[0]}
            </div>
            <div style="font-size:var(--text-xs);font-weight:600;color:var(--text-secondary)">${m.name}</div>
            ${m.note ? `<div style="font-size:10px;color:var(--text-tertiary)">${m.note}</div>` : ""}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function householdCard(tasks) {
  const urgent = tasks.filter(t => t.priority === "high" || t.overdue);
  if (!tasks.length) return "";
  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">🏠 Household</div>
        <button class="btn btn-ghost btn-sm" data-nav="household">All tasks →</button>
      </div>
      ${urgent.slice(0,3).map(t => `
        <div class="list-row">
          <span>🔧</span>
          <div style="flex:1;font-size:var(--text-sm)">
            <div style="font-weight:600">${t.title}</div>
            ${t.dueDate ? `<div style="font-size:var(--text-xs);color:var(--color-orange)">Due ${t.dueDate}</div>` : ""}
          </div>
        </div>
      `).join("")}
      ${!urgent.length ? `
        <div style="padding:var(--space-4);text-align:center;color:var(--text-secondary);font-size:var(--text-sm)">
          ${tasks.length} tasks — nothing urgent 👍
        </div>
      ` : ""}
    </div>
  `;
}

function apiKeyPrompt() {
  return `
    <div class="card" style="border: 1.5px solid var(--color-orange)">
      <div style="padding: var(--space-4)">
        <div style="font-weight:700;margin-bottom:var(--space-2)">✨ Enable AI features</div>
        <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-3)">
          Add your Anthropic API key to unlock AI-drafted texts, gift ideas, and morning briefs.
        </div>
        <div style="display:flex;gap:var(--space-2)">
          <input id="api-key-input" class="input" placeholder="sk-ant-..." style="font-size:var(--text-sm)">
          <button class="btn btn-primary" id="save-api-key">Save</button>
        </div>
      </div>
    </div>
  `;
}

// ── Event binding ───────────────────────────────────────────────
function bindEvents() {
  if (!_container) return;

  // Navigate to module
  _container.querySelectorAll("[data-nav]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      _ctx.navigate(btn.dataset.nav);
    });
  });

  // Tonight's dinner → pop the full recipe right here on Home
  _container.querySelectorAll("[data-open-dinner-modal]").forEach(el => {
    el.addEventListener("click", e => { e.stopPropagation(); openDinnerModal(); });
  });
  const dinnerClose = _container.querySelector("#dinner-modal-close");
  if (dinnerClose) dinnerClose.addEventListener("click", () => { _dinnerModal.open = false; render(); });
  const dinnerDone = _container.querySelector("#dinner-modal-done");
  if (dinnerDone) dinnerDone.addEventListener("click", () => { _dinnerModal.open = false; render(); });

  // Plan / change tonight's dinner → Meals "This Week" view
  _container.querySelectorAll("[data-plan-dinner]").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();
      _dinnerModal.open = false;
      sessionStorage.setItem("meals_view", "week");
      _ctx.navigate("meals");
    });
  });

  // Debrief refresh
  const regenBtn = _container.querySelector("#regen-debrief");
  if (regenBtn) {
    regenBtn.addEventListener("click", () => {
      localStorage.removeItem(`debrief_${tod()}`);
      const state = _ctx.state();
      const allEvents = [...(state.events||[]), ...(state.icalEvents||[])];
      const todayEv = allEvents.filter(e => e.date === tod()).sort((a,b) => (a.time||"") < (b.time||"") ? -1 : 1);
      generateDebrief(todayEv, state.reminders || []);
    });
  }

  // Save API key
  const saveBtn = _container.querySelector("#save-api-key");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const key = _container.querySelector("#api-key-input")?.value?.trim();
      if (key) {
        import("../js/ai.js").then(ai => {
          ai.setApiKey(key);
          showToast("API key saved ✓");
          const state = _ctx.state();
          const allEvents = [...(state.events||[]), ...(state.icalEvents||[])];
          const todayEv = allEvents.filter(e => e.date === tod()).sort((a,b) => (a.time||"") < (b.time||"") ? -1 : 1);
          _debrief.date = null; // force regeneration
          generateDebrief(todayEv, state.reminders || []);
        });
      }
    });
  }

  // Open contact detail — navigate to CRM module with contact pre-selected
  _container.querySelectorAll("[data-open-contact]").forEach(el => {
    el.addEventListener("click", () => {
      const id = el.dataset.openContact;
      // Store the pending contact ID and navigate
      sessionStorage.setItem("crm_open_contact", id);
      _ctx.navigate("crm");
    });
  });
}

function showToast(msg) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Module exports ──────────────────────────────────────────────
export async function init(container, ctx) {
  _container = container;
  _ctx = ctx;

  const { subscribe } = await import("../js/state.js");
  const u = subscribe(state => {
    render();
    // Trigger debrief once icalEvents arrive (if not already generated today)
    if (_debrief.date !== tod() && !_debrief.loading && state.icalEvents?.length >= 0 && getApiKey()) {
      const allEvents = [...(state.events||[]), ...(state.icalEvents||[])];
      const todayEv = allEvents.filter(e => e.date === tod()).sort((a,b) => (a.time||"") < (b.time||"") ? -1 : 1);
      generateDebrief(todayEv, state.reminders || []);
    }
  });
  _unsubscribes.push(u);

  render();

  // Generate debrief immediately if API key exists
  if (getApiKey() && _debrief.date !== tod()) {
    const state = ctx.state();
    const allEvents = [...(state.events||[]), ...(state.icalEvents||[])];
    const todayEv = allEvents.filter(e => e.date === tod()).sort((a,b) => (a.time||"") < (b.time||"") ? -1 : 1);
    generateDebrief(todayEv, state.reminders || []);
  }
}

export function cleanup() {
  _unsubscribes.forEach(u => u?.());
  _unsubscribes = [];
  _dinnerModal = { open: false, loading: false };
  _container = null;
  _ctx = null;
}
