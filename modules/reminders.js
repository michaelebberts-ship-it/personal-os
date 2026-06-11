/**
 * Reminders Module — grouped by category / list
 * Data from Apple Reminders via sync script, plus manual entries.
 */

import { refs, dbSet, dbUpdate, dbDelete, uid } from "../js/db.js";
import { callAIJson, hasApiKey } from "../js/ai.js";

let _container = null;
let _ctx = null;
let _stateUnsub = null;

let _local = {
  view: "today",     // "today" | "categories" | "all" | "setup"
  showAdd: false,
  addList: "Reminders",
  nlText: "",        // natural-language reminder input
  nlBusy: false,     // parsing or saving in progress
  nlPreview: null,   // parsed {title, due, time, priority, list, notes} awaiting confirm
};

const tod = () => new Date().toISOString().slice(0, 10);
const escH = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;");

// Map your actual list names → display categories
const LIST_MAP = {
  "Reminders":   { label: "General",     icon: "📋", color: "#636366" },
  "Before Work": { label: "Morning",     icon: "🌅", color: "#FF9500" },
  "Family":      { label: "Family",      icon: "👨‍👩‍👧‍👦", color: "#AF52DE" },
  "Groceries":   { label: "Groceries",   icon: "🛒", color: "#34C759" },
  "Todo List":   { label: "To-Do",       icon: "✅", color: "#007AFF" },
  "Todo":        { label: "To-Do",       icon: "✅", color: "#007AFF" },
};

// Smart auto-category by content keywords — catches household/pet/kids items
// living in the catch-all "Reminders" list
function smartCategory(r) {
  const t = (r.title + " " + (r.notes||"")).toLowerCase();
  const tags = (r.tags||"").toLowerCase();

  if (tags.includes("dog") || tags.includes("pet"))   return { label:"Pets",      icon:"🐾", color:"#FF9500" };
  if (tags.includes("medication") || tags.includes("med")) return { label:"Health",   icon:"💊", color:"#FF3B30" };
  if (/lawn|fertilize|sprinkler|garden|mow|yard|grass|weed/.test(t)) return { label:"Yard",    icon:"🌿", color:"#34C759" };
  if (/drain|clean|repair|fix|replace|smoker|auger|gutter|filter|hvac/.test(t)) return { label:"Home",   icon:"🏠", color:"#5AC8FA" };
  if (/george|eagle scout|merit badge|baseball|soccer|sport|athletefit|training/.test(t)) return { label:"Kids",   icon:"🧒", color:"#007AFF" };
  if (/patty|birthday|anniversary|gift|present/.test(t)) return { label:"Events",  icon:"🎉", color:"#FF2D55" };
  if (/grocery|groceries|milk|food|buy|pick up|store/.test(t)) return { label:"Groceries", icon:"🛒", color:"#34C759" };
  if (/morning|before work|coffee|breakfast|workout/.test(t)) return { label:"Morning",  icon:"🌅", color:"#FF9500" };

  const mapped = LIST_MAP[r.list];
  return mapped || { label: r.list||"General", icon:"📋", color:"#636366" };
}

const isOverdue  = r => !r.completed && r.dueDate && r.dueDate < tod();
const isDueToday = r => !r.completed && r.dueDate === tod();

function fmtDue(dueDate) {
  if (!dueDate) return "";
  const d = new Date(dueDate + "T12:00:00");
  const today = tod();
  const diff = Math.round((d - new Date(today + "T12:00:00")) / 86400e3);
  if (diff < -1)  return `${Math.abs(diff)}d overdue`;
  if (diff === -1) return "Yesterday";
  if (diff === 0)  return "Today";
  if (diff === 1)  return "Tomorrow";
  if (diff < 7)   return `${diff}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// "15:00" → "3:00 PM"
function fmtTime(hhmm) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtLastSync(iso) {
  if (!iso) return null;
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Render ──────────────────────────────────────────────────────
function render() {
  if (!_container || !_ctx) return;
  const { reminders, syncedReminders, remLastSync } = _ctx.state();

  // Merge, deduplicate by title+dueDate
  const seen = new Set();
  const all = [...reminders, ...syncedReminders].filter(r => {
    const key = `${r.title}|${r.dueDate}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).filter(r => !r.completed);

  const overdue = all.filter(isOverdue).sort((a,b) => a.dueDate < b.dueDate ? -1 : 1);
  const dueToday = all.filter(isDueToday);
  const upcoming = all.filter(r => !isOverdue(r) && !isDueToday(r));
  const isSynced = !!remLastSync;

  _container.innerHTML = `
    <div class="module-content">

      ${renderHeader(remLastSync, isSynced, overdue.length, dueToday.length, all.length)}

      ${renderNLBox()}

      ${_local.view === "today"      ? renderToday(overdue, dueToday, upcoming) : ""}
      ${_local.view === "categories" ? renderCategories(all) : ""}
      ${_local.view === "all"        ? renderAll(all) : ""}
      ${_local.view === "setup"      ? renderSetup() : ""}

      ${_local.showAdd ? renderAddModal() : ""}
    </div>
  `;
  bindEvents();
}

// ── Header ──────────────────────────────────────────────────────
function renderHeader(remLastSync, isSynced, overdueCount, todayCount, total) {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);gap:var(--space-2);flex-wrap:wrap">
      <div style="display:flex;gap:var(--space-2);overflow-x:auto">
        ${[
          { id:"today",      label:`📌 Today ${todayCount+overdueCount > 0 ? `<span class="badge">${todayCount+overdueCount}</span>` : ""}` },
          { id:"categories", label:"🗂️ Categories" },
          { id:"all",        label:`📋 All ${total}` },
          { id:"setup",      label: isSynced ? "⚙️ Sync" : "🔗 Connect" },
        ].map(v => `
          <button class="btn btn-sm ${_local.view===v.id?"btn-primary":"btn-secondary"}" data-view="${v.id}" style="flex-shrink:0;white-space:nowrap">
            ${v.label}
          </button>
        `).join("")}
      </div>
      ${isSynced
        ? `<div style="display:flex;align-items:center;gap:6px;font-size:var(--text-xs);color:var(--text-secondary);flex-shrink:0">
             <span style="width:7px;height:7px;border-radius:50%;background:var(--color-green)"></span>
             ${fmtLastSync(remLastSync)}
           </div>`
        : `<div style="font-size:var(--text-xs);color:var(--color-orange);font-weight:600;flex-shrink:0">⚠️ Not synced</div>`
      }
    </div>
  `;
}

// ── Natural-language add box ─────────────────────────────────────
function renderNLBox() {
  if (!hasApiKey()) {
    return `
      <div class="card" style="margin-bottom:var(--space-4)">
        <div style="padding:var(--space-3) var(--space-4);font-size:var(--text-sm);color:var(--text-secondary)">
          💬 Add a Claude API key in Settings to create reminders in plain English.
        </div>
      </div>
    `;
  }

  const p = _local.nlPreview;
  const lists = Object.keys(LIST_MAP);

  return `
    <div class="card" style="margin-bottom:var(--space-4)">
      <div style="padding:var(--space-3) var(--space-4)">
        <div style="display:flex;gap:var(--space-2);align-items:flex-start">
          <textarea id="nl-input" rows="1" class="input"
            placeholder='Describe a reminder — e.g. "call the vet next Tuesday at 3pm, high priority"'
            style="flex:1;resize:vertical;min-height:38px"
            ${_local.nlBusy ? "disabled" : ""}>${escH(_local.nlText)}</textarea>
          <button class="btn btn-primary btn-sm" id="nl-parse" style="flex-shrink:0;align-self:stretch" ${_local.nlBusy ? "disabled" : ""}>
            ${_local.nlBusy && !p ? "Thinking…" : "✨ Add"}
          </button>
        </div>

        ${p ? `
          <div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--separator)">
            <div style="font-size:var(--text-xs);font-weight:700;color:var(--text-secondary);margin-bottom:var(--space-2)">Review before adding to Apple Reminders</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2)">
              <div style="grid-column:1 / -1"><div class="section-label">Title</div><input id="nl-title" class="input" value="${escH(p.title||"")}"></div>
              <div><div class="section-label">Due date</div><input id="nl-due" class="input" type="date" value="${escH(p.due||"")}"></div>
              <div><div class="section-label">Time</div><input id="nl-time" class="input" type="time" value="${escH(p.time||"")}"></div>
              <div>
                <div class="section-label">List</div>
                <select id="nl-list" class="input select">
                  ${lists.map(l => `<option value="${l}" ${(p.list||"Reminders")===l?"selected":""}>${LIST_MAP[l].icon} ${LIST_MAP[l].label}</option>`).join("")}
                </select>
              </div>
              <div>
                <div class="section-label">Priority</div>
                <select id="nl-priority" class="input select">
                  ${["none","medium","high"].map(pr => `<option value="${pr}" ${(p.priority||"none")===pr?"selected":""}>${({none:"None",medium:"🟡 Medium",high:"🔴 High"})[pr]}</option>`).join("")}
                </select>
              </div>
              <div style="grid-column:1 / -1"><div class="section-label">Notes</div><input id="nl-notes" class="input" value="${escH(p.notes||"")}"></div>
            </div>
            <div style="display:flex;gap:var(--space-2);margin-top:var(--space-3);justify-content:flex-end">
              <button class="btn btn-secondary btn-sm" id="nl-cancel" ${_local.nlBusy ? "disabled" : ""}>Cancel</button>
              <button class="btn btn-primary btn-sm" id="nl-confirm" ${_local.nlBusy ? "disabled" : ""}>${_local.nlBusy ? "Adding…" : "✓ Add to Reminders"}</button>
            </div>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

// ── Today view ──────────────────────────────────────────────────
function renderToday(overdue, dueToday, upcoming) {
  const urgentItems = [...overdue, ...dueToday];

  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">

      ${urgentItems.length ? `
        <div class="card">
          <div class="card-header">
            <div class="card-title">
              ${overdue.length ? `🚨 ${overdue.length} overdue · ` : ""}📌 ${dueToday.length} due today
            </div>
            <button class="btn btn-primary btn-sm" id="add-rem-btn">+ Add</button>
          </div>
          ${urgentItems.map(r => reminderRow(r, true)).join("")}
        </div>
      ` : `
        <div class="card">
          <div style="padding:var(--space-5);text-align:center">
            <div style="font-size:32px;margin-bottom:var(--space-2)">🎉</div>
            <div style="font-weight:700;margin-bottom:var(--space-1)">All clear for today</div>
            <div style="font-size:var(--text-sm);color:var(--text-secondary)">Nothing overdue or due today.</div>
          </div>
          <div style="padding:0 var(--space-4) var(--space-4)">
            <button class="btn btn-secondary btn-sm w-full" id="add-rem-btn">+ Add reminder</button>
          </div>
        </div>
      `}

      ${upcoming.length ? `
        <div class="section-title" style="margin-bottom:var(--space-2)">Coming up</div>
        <div class="card">
          ${upcoming.slice(0, 8).map(r => reminderRow(r, false)).join("")}
          ${upcoming.length > 8 ? `
            <div style="padding:var(--space-3);text-align:center">
              <button class="btn btn-ghost btn-sm" data-view="all">See all ${upcoming.length} →</button>
            </div>
          ` : ""}
        </div>
      ` : ""}

    </div>
  `;
}

// ── Categories view ─────────────────────────────────────────────
function renderCategories(all) {
  // Group by smart category
  const groups = {};
  all.forEach(r => {
    const cat = smartCategory(r);
    const key = cat.label;
    if (!groups[key]) groups[key] = { ...cat, items: [] };
    groups[key].items.push(r);
  });

  // Sort groups: overdue first, then by count
  const sorted = Object.values(groups).sort((a, b) => {
    const aOver = a.items.filter(isOverdue).length;
    const bOver = b.items.filter(isOverdue).length;
    if (aOver !== bOver) return bOver - aOver;
    return b.items.length - a.items.length;
  });

  if (!sorted.length) {
    return `
      <div class="empty-state">
        <div class="empty-state__icon">🗂️</div>
        <div class="empty-state__title">No reminders synced yet</div>
        <div class="empty-state__body">
          <button class="btn btn-primary btn-sm" data-view="setup">Set up Apple Reminders sync →</button>
        </div>
      </div>
    `;
  }

  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-3)">
      ${sorted.map(group => {
        const overdueCount = group.items.filter(isOverdue).length;
        const todayCount   = group.items.filter(isDueToday).length;
        return `
          <details open>
            <summary style="
              display:flex;align-items:center;gap:var(--space-3);
              padding:var(--space-3) var(--space-4);
              background:var(--bg-surface);
              border-radius:var(--radius-lg);
              cursor:pointer;
              list-style:none;
              box-shadow:var(--shadow-sm);
            ">
              <span style="font-size:20px">${group.icon}</span>
              <span style="font-weight:700;flex:1">${group.label}</span>
              ${overdueCount ? `<span class="badge" style="background:var(--color-red)">${overdueCount} overdue</span>` : ""}
              ${todayCount && !overdueCount ? `<span class="badge" style="background:var(--color-orange)">${todayCount} today</span>` : ""}
              <span style="font-size:var(--text-xs);color:var(--text-tertiary)">${group.items.length}</span>
            </summary>
            <div class="card" style="margin-top:4px;border-radius:var(--radius-md) var(--radius-md) var(--radius-lg) var(--radius-lg)">
              ${group.items
                .sort((a,b) => {
                  const ao = isOverdue(a) ? 0 : isDueToday(a) ? 1 : 2;
                  const bo = isOverdue(b) ? 0 : isDueToday(b) ? 1 : 2;
                  return ao - bo || (a.dueDate||"9") < (b.dueDate||"9") ? -1 : 1;
                })
                .map(r => reminderRow(r, true))
                .join("")}
            </div>
          </details>
        `;
      }).join("")}
      <button class="btn btn-secondary btn-sm w-full" id="add-rem-btn">+ Add reminder</button>
    </div>
  `;
}

// ── All view ─────────────────────────────────────────────────────
function renderAll(all) {
  const sorted = [...all].sort((a,b) => {
    const ao = isOverdue(a) ? 0 : isDueToday(a) ? 1 : a.dueDate ? 2 : 3;
    const bo = isOverdue(b) ? 0 : isDueToday(b) ? 1 : b.dueDate ? 2 : 3;
    return ao - bo || (a.dueDate||"9") < (b.dueDate||"9") ? -1 : 1;
  });

  return `
    <div class="card" style="margin-bottom:var(--space-4)">
      ${sorted.length
        ? sorted.map(r => reminderRow(r, true)).join("")
        : `<div class="empty-state"><div class="empty-state__icon">✅</div><div class="empty-state__title">Nothing here</div></div>`
      }
    </div>
    <button class="btn btn-secondary btn-sm w-full" id="add-rem-btn">+ Add reminder</button>
  `;
}

// ── Reminder row ─────────────────────────────────────────────────
function reminderRow(r, showCat) {
  const overdue   = isOverdue(r);
  const today     = isDueToday(r);
  const dueFmt    = fmtDue(r.dueDate);
  const timeFmt   = fmtTime(r.dueTime);
  const dueLabel  = [dueFmt, timeFmt].filter(Boolean).join(", ");
  const dueColor  = overdue ? "var(--color-red)" : today ? "var(--color-orange)" : "var(--text-tertiary)";
  const cat       = showCat ? smartCategory(r) : null;
  const pIcon     = { high:"🔴", medium:"🟡" }[r.priority] || "";
  const isApple   = r.source === "apple";

  return `
    <div class="list-row" style="${overdue?"background:var(--color-red-bg)20":""}">
      ${isApple
        ? `<input type="checkbox" data-complete-apple="${r.id}" style="width:18px;height:18px;cursor:pointer;accent-color:var(--color-green);flex-shrink:0;margin-top:1px">`
        : `<input type="checkbox" data-toggle-rem="${r.id}" style="width:18px;height:18px;cursor:pointer;accent-color:var(--color-green);flex-shrink:0;margin-top:1px">`
      }
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:var(--text-sm)">${escH(r.title)}</div>
        ${r.notes ? `<div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escH(r.notes)}</div>` : ""}
        <div style="display:flex;align-items:center;gap:var(--space-2);margin-top:3px;flex-wrap:wrap">
          ${dueLabel ? `<span style="font-size:var(--text-xs);font-weight:700;color:${dueColor}">${dueLabel}</span>` : ""}
          ${r.recurrence ? `<span style="font-size:var(--text-xs);font-weight:600;color:${dueColor}">↻ ${escH(r.recurrence)}</span>` : ""}
          ${cat ? `<span style="font-size:var(--text-xs);color:var(--text-tertiary)">${cat.icon}</span>` : ""}
          ${r.tags ? r.tags.split(",").filter(Boolean).map(t =>
            `<span class="pill" style="background:var(--bg-surface-2);color:var(--text-secondary)">#${escH(t.trim())}</span>`
          ).join("") : ""}
          ${pIcon ? `<span style="font-size:11px">${pIcon}</span>` : ""}
        </div>
      </div>
      ${!isApple ? `<button class="btn" style="font-size:11px;color:var(--text-tertiary)" data-del-rem="${r.id}">✕</button>` : ""}
    </div>
  `;
}

// ── Add modal ────────────────────────────────────────────────────
function renderAddModal() {
  const lists = Object.keys(LIST_MAP);
  return `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <h2>Add reminder</h2>
          <button class="btn btn-ghost btn-sm" id="close-rem-modal">✕</button>
        </div>
        <div class="modal-body">
          <div><div class="section-label">Title</div><input id="rem-title" class="input" placeholder="What to remember?"></div>
          <div><div class="section-label">Due date</div><input id="rem-due" class="input" type="date"></div>
          <div>
            <div class="section-label">List</div>
            <select id="rem-list" class="input select">
              ${lists.map(l => `<option value="${l}" ${_local.addList===l?"selected":""}>${LIST_MAP[l].icon} ${LIST_MAP[l].label} (${l})</option>`).join("")}
            </select>
          </div>
          <div>
            <div class="section-label">Priority</div>
            <select id="rem-priority" class="input select">
              <option value="none">None</option>
              <option value="medium">🟡 Medium</option>
              <option value="high">🔴 High</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-add-rem">Cancel</button>
          <button class="btn btn-primary" id="confirm-add-rem">Add</button>
        </div>
      </div>
    </div>
  `;
}

// ── Setup guide ──────────────────────────────────────────────────
function renderSetup() {
  const SYNC_URL = `https://firestore.googleapis.com/v1/projects/inner-circle-crm/databases/(default)/documents/users/owner-inner-circle-crm/sync/reminders?key=AIzaSyDINHNV1Ze3QfhXwBPwe22LnUe-xxnU-n4`;
  const { remLastSync } = _ctx.state();
  return `
    <div class="card">
      <div style="padding:var(--space-4)">
        ${remLastSync
          ? `<div style="font-weight:700;color:var(--color-green);margin-bottom:var(--space-3)">✅ Apple Reminders connected · ${fmtLastSync(remLastSync)}</div>`
          : `<div style="font-weight:700;color:var(--color-orange);margin-bottom:var(--space-3)">⚠️ Not synced yet</div>`
        }
        <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-3)">
          The sync script on your Mac handles this automatically. If you see 0 reminders, run:
        </div>
        <div style="background:var(--bg-surface-2);border-radius:var(--radius-md);padding:var(--space-3);font-family:monospace;font-size:var(--text-sm);margin-bottom:var(--space-3)">
          python3 ~/Desktop/personal-os/mac-sync/sync_to_os.py
        </div>
        <div style="font-size:var(--text-sm);color:var(--text-secondary)">
          Syncs automatically at 7am, 12pm, 5pm, 9pm.
        </div>
      </div>
    </div>
  `;
}

// ── Event binding ────────────────────────────────────────────────
function bindEvents() {
  if (!_container) return;
  const $ = id => document.getElementById(id);
  const on = (id, ev, fn) => { const el=$(id); if(el) el.addEventListener(ev,fn); };

  _container.querySelectorAll("[data-view]").forEach(btn =>
    btn.addEventListener("click", () => { _local.view = btn.dataset.view; render(); })
  );

  // Natural-language add box
  on("nl-input", "input", (e) => { _local.nlText = e.target.value; });   // no re-render → keep focus
  on("nl-parse", "click", () => parseNL($("nl-input")?.value || _local.nlText));
  on("nl-cancel", "click", () => { _local.nlPreview = null; _local.nlText = ""; render(); });
  on("nl-confirm", "click", () => confirmNL($));

  on("add-rem-btn", "click", () => { _local.showAdd = true; render(); setTimeout(() => $("rem-title")?.focus(), 50); });
  on("close-rem-modal", "click", () => { _local.showAdd = false; render(); });
  on("cancel-add-rem", "click", () => { _local.showAdd = false; render(); });

  on("confirm-add-rem", "click", async () => {
    const title = $("rem-title")?.value?.trim();
    if (!title) return;
    const r = {
      id: uid(), title,
      dueDate:  $("rem-due")?.value || "",
      list:     $("rem-list")?.value || "Reminders",
      priority: $("rem-priority")?.value || "none",
      completed: false,
      source:    "manual",
    };
    _local.addList = r.list;
    await dbSet(refs.reminder(r.id), r);
    _local.showAdd = false;
    render();
  });

  _container.querySelectorAll("[data-toggle-rem]").forEach(cb =>
    cb.addEventListener("change", async () =>
      await dbUpdate(refs.reminder(cb.dataset.toggleRem), { completed: cb.checked })
    )
  );

  _container.querySelectorAll("[data-complete-apple]").forEach(cb =>
    cb.addEventListener("change", async () => {
      const id = cb.dataset.completeApple;
      cb.disabled = true;
      const { getState, setState } = await import("../js/state.js");
      try {
        const res = await fetch(`${BRIDGE}/reminders/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error("bridge failed");
        // Optimistically drop it from state so it disappears immediately
        const synced = getState().syncedReminders.filter(r => r.id !== id);
        setState({ syncedReminders: synced });
      } catch (e) {
        cb.checked = false;
        cb.disabled = false;
        alert("Couldn't complete reminder — is the bridge running?");
      }
    })
  );

  _container.querySelectorAll("[data-del-rem]").forEach(btn =>
    btn.addEventListener("click", async () => await dbDelete(refs.reminder(btn.dataset.delRem)))
  );
}

// ── Bridge fetch ─────────────────────────────────────────────────
const BRIDGE = "http://localhost:3333";
let _refreshTimer = null;
const REFRESH_MS = 5 * 60 * 1000;

async function fetchBridgeReminders() {
  try {
    const res = await fetch(`${BRIDGE}/reminders`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.reminders)) return;

    const { setState } = await import("../js/state.js");
    const synced = data.reminders.map(r => ({
      id: r.id,                              // EventKit calendarItemIdentifier
      title: r.title,
      list: r.list,
      dueDate: r.due ? r.due.slice(0, 10) : "",
      dueTime: r.time || "",                 // "HH:mm" or ""
      priority: r.priority || "none",
      recurrence: r.recurrence || "",        // human-readable, e.g. "Every 6 months"
      notes: r.notes || "",
      tags: Array.isArray(r.tags) ? r.tags.join(",") : (r.tags || ""),
      completed: false,
      source: "apple",
    }));
    // Bridge is reachable → it owns reminder data on desktop (see app.js guard)
    window.__remBridgeActive = true;
    setState({ syncedReminders: synced, remLastSync: new Date().toISOString() });
  } catch (e) {
    // bridge not running — silent fail
  }
}

// Parse free text → structured reminder via Claude, then show editable preview
async function parseNL(text) {
  text = (text || "").trim();
  if (!text || _local.nlBusy) return;
  _local.nlText = text;
  _local.nlBusy = true;
  _local.nlPreview = null;
  render();

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const dow = today.toLocaleDateString("en-US", { weekday: "long" });
  const lists = Object.keys(LIST_MAP);

  const prompt = `Extract a single reminder from this text into JSON. Today is ${dow}, ${todayStr}.
Text: "${text}"
Return ONLY a JSON object (no markdown, no commentary) with these keys:
- title: a short reminder title (string, required)
- due: due date as "YYYY-MM-DD", or null if no date is mentioned
- time: time as "HH:mm" in 24-hour format, or null if no specific time is mentioned
- priority: "high", "medium", or "none"
- list: the best match from [${lists.join(", ")}], default "Reminders"
- notes: any extra detail worth keeping, otherwise ""
Resolve relative dates like "tomorrow", "next Tuesday", "in 3 days" against today's date.`;

  const parsed = await callAIJson(prompt, null, { maxTokens: 300 });
  _local.nlBusy = false;

  if (!parsed || !parsed.title) {
    render();
    alert("Couldn't parse that into a reminder. Try rephrasing, or check your API key / the bridge.");
    return;
  }
  _local.nlPreview = {
    title: parsed.title || "",
    due: parsed.due || "",
    time: parsed.time || "",
    priority: ["high", "medium", "none"].includes(parsed.priority) ? parsed.priority : "none",
    list: lists.includes(parsed.list) ? parsed.list : "Reminders",
    notes: parsed.notes || "",
  };
  render();
}

// Confirm the previewed reminder → create in Apple Reminders via the bridge
async function confirmNL($) {
  if (_local.nlBusy) return;
  const payload = {
    title: $("nl-title")?.value?.trim() || "",
    due: $("nl-due")?.value || "",
    time: $("nl-time")?.value || "",
    priority: $("nl-priority")?.value || "none",
    list: $("nl-list")?.value || "Reminders",
    notes: $("nl-notes")?.value?.trim() || "",
  };
  if (!payload.title) { alert("A title is required."); return; }

  _local.nlBusy = true;
  render();
  try {
    const res = await fetch(`${BRIDGE}/reminders/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error("add failed");
    _local.nlBusy = false;
    _local.nlPreview = null;
    _local.nlText = "";
    render();
    fetchBridgeReminders();   // refresh so the new reminder shows with full data
  } catch (e) {
    _local.nlBusy = false;
    render();
    alert("Couldn't add the reminder — is the bridge running?");
  }
}

// ── Lifecycle ────────────────────────────────────────────────────
export async function init(container, ctx) {
  _container = container;
  _ctx = ctx;
  const { subscribe } = await import("../js/state.js");
  _stateUnsub = subscribe(() => render());
  render();
  fetchBridgeReminders();
  _refreshTimer = setInterval(fetchBridgeReminders, REFRESH_MS);
}

export function cleanup() {
  _stateUnsub?.();
  _stateUnsub = null;
  clearInterval(_refreshTimer);
  _refreshTimer = null;
  _container = null;
  _ctx = null;
}
