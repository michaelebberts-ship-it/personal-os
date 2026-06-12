/**
 * Calendar Module
 * Shows events fetched directly from iCloud public webcal feed + manually-added events.
 */

import { refs, dbSet, dbDelete, uid } from "../js/db.js";
import { fetchIcalEvents } from "../js/ical.js";

const REFRESH_MS = 5 * 60 * 1000;

let _container = null;
let _ctx = null;
let _stateUnsub = null;
let _refreshTimer = null;

let _local = {
  view: "week",
  selectedDate: new Date().toISOString().slice(0, 10),
  showAddEvent: false,
  pickedColor: "#FF3B30",
  icalEvents: [],
  icalLastFetch: null,
  icalError: null,
  icalLoading: false,
};

const tod = () => new Date().toISOString().slice(0, 10);
const escH = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;");
const fmt12 = t => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2,"0")} ${ampm}`;
};
const EVENT_COLORS = ["#FF3B30","#007AFF","#34C759","#FF9500","#AF52DE","#5AC8FA","#FF2D55","#FF6B35"];

// ── Date helpers ────────────────────────────────────────────────
function weekDays(anchor) {
  const d = new Date(anchor + "T12:00:00");
  const day = d.getDay();
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() - day + i);
    return x.toISOString().slice(0, 10);
  });
}

function fmtWeekRange(anchor) {
  const days = weekDays(anchor);
  const fmt = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(days[0])} – ${fmt(days[6])}`;
}

function fmtLastSync(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function calendarColor(calName) {
  if (!calName) return "#FF3B30";
  const lower = calName.toLowerCase();
  if (lower.includes("family") || lower.includes("shared")) return "#34C759";
  if (lower.includes("work"))   return "#007AFF";
  if (lower.includes("sport") || lower.includes("soccer") || lower.includes("football")) return "#FF9500";
  return "#FF3B30";
}

// ── iCal fetch + parse ──────────────────────────────────────────
async function fetchIcal() {
  _local.icalLoading = true;
  _local.icalError = null;
  render();
  try {
    _local.icalEvents = await fetchIcalEvents();
    _local.icalLastFetch = new Date().toISOString();
    _local.icalError = null;
    // Share with global state so other modules (Home) can read today's events
    const { setState } = await import("../js/state.js");
    setState({ icalEvents: _local.icalEvents, calLastSync: _local.icalLastFetch });
  } catch (e) {
    // Bridge unreachable (e.g. on iPhone) — load from Firestore sync/calendar
    const bridgeDown = e.name === 'AbortError' || e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('Load failed');
    if (bridgeDown) {
      try {
        const fsRes = await fetch(`https://firestore.googleapis.com/v1/projects/inner-circle-crm/databases/(default)/documents/users/owner-inner-circle-crm/sync/calendar?key=AIzaSyDINHNV1Ze3QfhXwBPwe22LnUe-xxnU-n4`);
        if (fsRes.ok) {
          const doc = await fsRes.json();
          const raw = doc.fields?.data?.stringValue || '';
          _local.icalEvents = raw.split('\n').filter(Boolean).map((line, i) => {
            const [title, date, time, endTime, location, calendar] = line.split('|||');
            return { id: `fs_ev_${i}_${date}`, title: title||'', date: date||'', time: time||'', endTime: endTime||'', location: location||'', calendar: calendar||'iCloud', source: 'apple' };
          });
          _local.icalLastFetch = doc.fields?.lastSync?.timestampValue || null;
        }
      } catch { /* silent */ }
    } else {
      _local.icalError = e.message;
    }
  } finally {
    _local.icalLoading = false;
    render();
  }
}

// ── Render ──────────────────────────────────────────────────────
function render() {
  if (!_container || !_ctx) return;
  const { events } = _ctx.state();
  const allEvents = [...events, ..._local.icalEvents];

  _container.innerHTML = `
    <div class="module-content">
      ${renderHeader()}
      ${renderWeek(allEvents)}
      ${_local.showAddEvent ? renderAddModal() : ""}
    </div>
  `;

  bindEvents();
}

// ── Header with sync status ─────────────────────────────────────
function renderHeader() {
  const ago = fmtLastSync(_local.icalLastFetch);
  let statusEl;
  if (_local.icalLoading) {
    statusEl = `<div style="font-size:var(--text-xs);color:var(--text-secondary)">Loading…</div>`;
  } else if (_local.icalError) {
    statusEl = `<div style="font-size:var(--text-xs);color:var(--color-red);font-weight:600" title="${escH(_local.icalError)}">⚠️ Sync error</div>`;
  } else if (_local.icalLastFetch) {
    statusEl = `<div style="display:flex;align-items:center;gap:6px;font-size:var(--text-xs);color:var(--text-secondary)">
      <span style="width:7px;height:7px;border-radius:50%;background:var(--color-green);flex-shrink:0"></span>
      Synced ${ago}
      <button class="btn btn-ghost btn-sm" id="refresh-cal" style="padding:0 4px;font-size:11px">↻</button>
    </div>`;
  } else {
    statusEl = `<div style="font-size:var(--text-xs);color:var(--text-secondary)">Connecting…</div>`;
  }
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);gap:var(--space-3)">
      <div style="display:flex;gap:var(--space-2)">
        <button class="btn btn-sm btn-primary" data-view="week">📅 Week</button>
      </div>
      ${statusEl}
    </div>
  `;
}

// ── Week view ───────────────────────────────────────────────────
function renderWeek(allEvents) {
  const days     = weekDays(_local.selectedDate);
  const today    = tod();
  const evOnDay  = iso => allEvents.filter(e => e.date === iso)
                                    .sort((a,b) => (a.time||"00:00") < (b.time||"00:00") ? -1 : 1);

  return `
    <!-- Week navigator -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3)">
      <button class="btn btn-secondary btn-sm" id="prev-week">‹</button>
      <div style="font-weight:700;font-size:var(--text-md)">${fmtWeekRange(_local.selectedDate)}</div>
      <button class="btn btn-secondary btn-sm" id="next-week">›</button>
    </div>

    <!-- Day strip -->
    <div class="card" style="margin-bottom:var(--space-4)">
      <div style="display:grid;grid-template-columns:repeat(7,1fr)">
        ${days.map(iso => {
          const d       = new Date(iso + "T12:00:00");
          const isToday = iso === today;
          const isSel   = iso === _local.selectedDate;
          const count   = evOnDay(iso).length;
          return `
            <div class="day-btn" data-date="${iso}" style="
              padding:var(--space-2) 4px;
              text-align:center;
              cursor:pointer;
              border-right:1px solid var(--separator);
              background:${isSel ? "var(--accent-light)" : "transparent"};
              transition:background .1s;
            ">
              <div style="font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">
                ${d.toLocaleDateString("en-US",{weekday:"short"})}
              </div>
              <div style="
                width:28px;height:28px;border-radius:50%;
                margin:3px auto 4px;
                display:flex;align-items:center;justify-content:center;
                font-size:var(--text-sm);font-weight:700;
                background:${isToday ? "var(--accent)" : "transparent"};
                color:${isToday ? "#fff" : "var(--text-primary)"};
              ">${d.getDate()}</div>
              ${count ? `<div style="width:6px;height:6px;border-radius:50%;background:var(--accent);margin:0 auto"></div>` : ""}
            </div>
          `;
        }).join("")}
      </div>

      <!-- Selected day events -->
      <div style="padding:var(--space-3);border-top:1px solid var(--separator)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3)">
          <div style="font-weight:700;font-size:var(--text-md)">
            ${new Date(_local.selectedDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
            ${_local.selectedDate===today ? " <span style='color:var(--accent);font-size:var(--text-sm)'>· Today</span>" : ""}
          </div>
          <button class="btn btn-primary btn-sm" id="add-event-btn">+ Event</button>
        </div>

        ${evOnDay(_local.selectedDate).length
          ? evOnDay(_local.selectedDate).map(e => renderEventRow(e)).join("")
          : `<div style="text-align:center;padding:var(--space-4);color:var(--text-secondary);font-size:var(--text-sm)">
               Nothing scheduled
             </div>`
        }
      </div>
    </div>

    <!-- Upcoming 7 days at a glance -->
    <div class="section-title" style="margin-bottom:var(--space-3)">Next 7 days</div>
    <div class="card">
      ${days.filter(d => d >= today).flatMap(iso => evOnDay(iso)).length
        ? days.filter(d => d >= today).flatMap(iso => evOnDay(iso).map(e => ({...e, _iso: iso}))).slice(0, 10).map(e => `
            <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--separator)">
              <div style="width:40px;text-align:center;flex-shrink:0">
                <div style="font-size:10px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase">
                  ${new Date(e.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"})}
                </div>
                <div style="font-size:var(--text-lg);font-weight:800;line-height:1">
                  ${new Date(e.date+"T12:00:00").getDate()}
                </div>
              </div>
              <div style="width:3px;height:36px;border-radius:2px;background:${e.color||calendarColor(e.calendar)};flex-shrink:0"></div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:var(--text-sm)">${escH(e.title)}</div>
                <div style="font-size:var(--text-xs);color:var(--text-secondary)">
                  ${e.time ? fmt12(e.time) : "All day"}${e.endTime ? " – "+fmt12(e.endTime) : ""}${e.location ? " · "+escH(e.location) : ""}
                  ${e.source==="apple" ? " <span style='color:var(--text-tertiary)'>· 🍎</span>" : ""}
                </div>
              </div>
            </div>
          `).join("")
        : `<div style="padding:var(--space-5);text-align:center;color:var(--text-secondary);font-size:var(--text-sm)">
             No events coming up.
           </div>`
      }
    </div>
  `;
}

function renderEventRow(e) {
  const color = e.color || calendarColor(e.calendar);
  return `
    <div style="display:flex;align-items:flex-start;gap:var(--space-2);padding:var(--space-2) 0;border-bottom:1px solid var(--separator)">
      <div style="width:3px;min-height:40px;border-radius:2px;background:${color};flex-shrink:0;margin-top:2px"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:var(--text-sm)">${escH(e.title)}</div>
        <div style="font-size:var(--text-xs);color:var(--text-secondary)">
          ${e.time ? fmt12(e.time) : "All day"}${e.endTime ? " – "+fmt12(e.endTime) : ""}
          ${e.location ? " · "+escH(e.location) : ""}
          ${e.calendar ? ` · <span style="color:${color}">${escH(e.calendar)}</span>` : ""}
          ${e.source==="apple" ? " · 🍎" : ""}
        </div>
      </div>
      ${e.source!=="apple" ? `<button class="btn" style="font-size:11px;color:var(--text-tertiary)" data-del-event="${e.id}">✕</button>` : ""}
    </div>
  `;
}

// ── Setup guide (retired — now using direct iCal feed) ──────────
function renderSetupGuide() {
  const SYNC_URL = `https://firestore.googleapis.com/v1/projects/inner-circle-crm/databases/(default)/documents/users/owner-inner-circle-crm/sync/calendar?key=AIzaSyDINHNV1Ze3QfhXwBPwe22LnUe-xxnU-n4`;

  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">

      <!-- Status banner -->
      ${_ctx.state().calLastSync
        ? `<div style="background:var(--color-green-bg);border:1.5px solid var(--color-green);border-radius:var(--radius-lg);padding:var(--space-4);display:flex;align-items:center;gap:var(--space-3)">
             <span style="font-size:24px">✅</span>
             <div>
               <div style="font-weight:700">Apple Calendar is connected</div>
               <div style="font-size:var(--text-sm);color:var(--text-secondary)">
                 Last synced: ${fmtLastSync(_ctx.state().calLastSync)}
               </div>
             </div>
           </div>`
        : `<div style="background:var(--color-orange-bg);border:1.5px solid var(--color-orange);border-radius:var(--radius-lg);padding:var(--space-4);display:flex;align-items:center;gap:var(--space-3)">
             <span style="font-size:24px">📅</span>
             <div>
               <div style="font-weight:700">Not connected yet</div>
               <div style="font-size:var(--text-sm);color:var(--text-secondary)">
                 Follow the steps below to sync your Apple Calendar.
               </div>
             </div>
           </div>`
      }

      <!-- How it works -->
      <div class="card">
        <div class="card-header"><div class="card-title">How it works</div></div>
        <div style="padding:var(--space-4);font-size:var(--text-sm);color:var(--text-secondary);line-height:1.8">
          You'll create one Apple Shortcut. It reads your Personal and Family calendars, then sends the events to this app via the internet (Firebase). Set it to run automatically 4× a day — no tapping required.
          <br><br>
          <strong>Setup time:</strong> ~10 minutes &nbsp;·&nbsp; <strong>Works on:</strong> iPhone or Mac
        </div>
      </div>

      <!-- Step 1 -->
      ${step(1, "Open Shortcuts on your iPhone (or Mac)", `
        Tap the <strong>Shortcuts</strong> app. Tap <strong>+</strong> in the top-right to create a new Shortcut.
        Name it <strong>"Sync Calendar to OS"</strong>.
      `)}

      <!-- Step 2 -->
      ${step(2, `Add action: "Find Calendar Events"`, `
        Tap <strong>Add Action</strong> → search for <strong>"Find Calendar Events"</strong>.
        Configure it:<br>
        <ul style="margin:var(--space-2) 0 0 var(--space-4);display:flex;flex-direction:column;gap:6px">
          <li>Calendar: tap and select <strong>Personal</strong> and <strong>Family</strong></li>
          <li>Start Date: <strong>is after</strong> → <em>Current Date</em></li>
          <li>End Date: <strong>is before</strong> → <em>Date · 14 days from now</em></li>
          <li>Limit: <strong>50</strong></li>
          <li>Sort by: <strong>Start Date</strong></li>
        </ul>
      `)}

      <!-- Step 3 -->
      ${step(3, `Add a "Repeat with each" loop`, `
        Tap <strong>Add Action</strong> → search <strong>"Repeat with each"</strong>. Select it. Inside the loop, add a <strong>Text</strong> action and type exactly this — tapping the variables (shown in blue) from the calendar event:
        <div style="
          margin:var(--space-3) 0;
          background:var(--bg-surface-2);
          border-radius:var(--radius-md);
          padding:var(--space-3) var(--space-4);
          font-family:monospace;
          font-size:12px;
          line-height:1.9;
          white-space:pre-wrap;
          word-break:break-all;
          color:var(--text-primary);
        ">[Repeat Item → Title]|||[Repeat Item → Start Date → Date (yyyy-MM-dd)]|||[Repeat Item → Start Date → Time (HH:mm)]|||[Repeat Item → End Date → Time (HH:mm)]|||[Repeat Item → Location]|||[Repeat Item → Calendar]</div>
        Then: <strong>Add Action</strong> → <strong>"Add to Variable"</strong> → name it <strong>Lines</strong>.
      `)}

      <!-- Step 4 -->
      ${step(4, `Combine the lines`, `
        After the loop ends, add action: <strong>"Combine Text"</strong>.<br>
        Set the input to variable <strong>Lines</strong>.<br>
        Separator: <strong>New Lines</strong>.
      `)}

      <!-- Step 5 -->
      ${step(5, `Clean up quotes`, `
        Add action: <strong>"Replace Text"</strong>.<br>
        Find: <code style="background:var(--bg-surface-2);padding:1px 5px;border-radius:4px">"</code> (double quote)<br>
        Replace: <code style="background:var(--bg-surface-2);padding:1px 5px;border-radius:4px">'</code> (single quote)<br>
        This prevents the one edge case where a quote in an event title could break the sync.
      `)}

      <!-- Step 6 -->
      ${step(6, `Build the request body`, `
        Add another <strong>Text</strong> action. Type this exactly (the [Replace Text] part will be the blue variable from Step 5):
        <div style="
          margin:var(--space-3) 0;
          background:var(--bg-surface-2);
          border-radius:var(--radius-md);
          padding:var(--space-3) var(--space-4);
          font-family:monospace;
          font-size:11px;
          line-height:1.9;
          white-space:pre-wrap;
          word-break:break-all;
          color:var(--text-primary);
        ">{"fields":{"data":{"stringValue":"[Replace Text]"},"lastSync":{"stringValue":"[Current Date → ISO 8601]"}}}</div>
      `)}

      <!-- Step 7 -->
      ${step(7, `Send to Firebase`, `
        Add action: <strong>"Get Contents of URL"</strong>. Configure:<br>
        <div style="margin:var(--space-3) 0;display:flex;flex-direction:column;gap:var(--space-2)">
          <div style="font-size:var(--text-sm)"><strong>URL:</strong></div>
          <div style="
            background:var(--bg-surface-2);
            border-radius:var(--radius-md);
            padding:var(--space-3);
            font-family:monospace;
            font-size:10px;
            word-break:break-all;
            line-height:1.6;
          ">${escH(SYNC_URL)}</div>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:var(--text-sm)">
            <div><strong>Method:</strong> PATCH</div>
            <div><strong>Request Body Type:</strong> File</div>
            <div><strong>File:</strong> [Text from Step 6]</div>
          </div>
          <div style="font-size:var(--text-sm)"><strong>Add Header:</strong></div>
          <div style="background:var(--bg-surface-2);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);font-size:var(--text-sm)">
            Key: <code>Content-Type</code> &nbsp; Value: <code>application/json</code>
          </div>
        </div>
        Tap <strong>Run</strong> to test it — your calendar events should appear in the Week view within seconds.
      `)}

      <!-- Step 8 -->
      ${step(8, `Automate it (4× daily)`, `
        Go to the <strong>Automation</strong> tab in Shortcuts → <strong>+</strong> → <strong>Time of Day</strong>.<br>
        Set times: <strong>7:00 AM, 12:00 PM, 5:00 PM, 9:00 PM</strong>.<br>
        Select your <strong>"Sync Calendar to OS"</strong> shortcut.<br>
        Turn off <strong>"Ask Before Running"</strong> so it runs silently in the background.
        <br><br>
        Repeat this for each of the 4 times. Done — it'll stay current all day.
      `)}

      <!-- Copy URL button -->
      <div class="card">
        <div style="padding:var(--space-4)">
          <div style="font-weight:700;margin-bottom:var(--space-2)">📋 Sync URL (copy this for Step 7)</div>
          <div style="
            background:var(--bg-surface-2);
            border-radius:var(--radius-md);
            padding:var(--space-3);
            font-family:monospace;
            font-size:10px;
            word-break:break-all;
            line-height:1.6;
            margin-bottom:var(--space-3);
            color:var(--text-secondary);
          ">${escH(SYNC_URL)}</div>
          <button class="btn btn-primary btn-sm w-full" id="copy-cal-url">📋 Copy URL</button>
        </div>
      </div>

    </div>
  `;
}

function step(n, title, body) {
  return `
    <div class="card">
      <div style="padding:var(--space-4)">
        <div style="display:flex;align-items:flex-start;gap:var(--space-3)">
          <div style="
            width:28px;height:28px;border-radius:50%;
            background:var(--accent);color:#fff;
            display:flex;align-items:center;justify-content:center;
            font-size:var(--text-sm);font-weight:800;flex-shrink:0;
          ">${n}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:var(--text-md);margin-bottom:var(--space-2)">${title}</div>
            <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.8">${body}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Add event modal ─────────────────────────────────────────────
function renderAddModal() {
  return `
    <div class="modal-overlay" id="event-modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <h2>Add event</h2>
          <button class="btn btn-ghost btn-sm" id="close-event-modal">✕</button>
        </div>
        <div class="modal-body">
          <div><div class="section-label">Title</div><input id="ev-title" class="input" placeholder="Event name"></div>
          <div><div class="section-label">Date</div><input id="ev-date" class="input" type="date" value="${_local.selectedDate}"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div><div class="section-label">Start time</div><input id="ev-time" class="input" type="time"></div>
            <div><div class="section-label">End time</div><input id="ev-end" class="input" type="time"></div>
          </div>
          <div><div class="section-label">Location</div><input id="ev-loc" class="input" placeholder="Where?"></div>
          <div>
            <div class="section-label">Color</div>
            <div style="display:flex;gap:var(--space-2);flex-wrap:wrap" id="color-picker">
              ${EVENT_COLORS.map(c => `
                <button
                  class="color-swatch"
                  data-color="${c}"
                  style="width:26px;height:26px;border-radius:50%;background:${c};border:3px solid ${_local.pickedColor===c?"var(--bg-surface)":"transparent"};outline:2px solid ${_local.pickedColor===c?c:"transparent"}">
                </button>
              `).join("")}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-add-event">Cancel</button>
          <button class="btn btn-primary" id="confirm-add-event">Add</button>
        </div>
      </div>
    </div>
  `;
}

// ── Event binding ───────────────────────────────────────────────
function bindEvents() {
  if (!_container) return;
  const $ = id => document.getElementById(id);
  const on = (id, ev, fn) => { const el=$(id); if(el) el.addEventListener(ev, fn); };

  // View tabs
  _container.querySelectorAll("[data-view]").forEach(btn =>
    btn.addEventListener("click", () => { _local.view = btn.dataset.view; render(); })
  );

  // Week nav
  on("prev-week", "click", () => {
    const d = new Date(_local.selectedDate + "T12:00:00");
    d.setDate(d.getDate() - 7);
    _local.selectedDate = d.toISOString().slice(0, 10);
    render();
  });
  on("next-week", "click", () => {
    const d = new Date(_local.selectedDate + "T12:00:00");
    d.setDate(d.getDate() + 7);
    _local.selectedDate = d.toISOString().slice(0, 10);
    render();
  });

  // Day selection
  _container.querySelectorAll(".day-btn").forEach(btn =>
    btn.addEventListener("click", () => { _local.selectedDate = btn.dataset.date; render(); })
  );

  // Add event
  on("add-event-btn", "click", () => { _local.showAddEvent = true; render(); setTimeout(() => $("ev-title")?.focus(), 50); });
  on("close-event-modal", "click", () => { _local.showAddEvent = false; render(); });
  on("cancel-add-event", "click", () => { _local.showAddEvent = false; render(); });

  _container.querySelectorAll(".color-swatch").forEach(btn =>
    btn.addEventListener("click", () => { _local.pickedColor = btn.dataset.color; render(); })
  );

  on("confirm-add-event", "click", async () => {
    const title = $("ev-title")?.value?.trim();
    if (!title) return;
    const ev = {
      id: uid(), title,
      date: $("ev-date")?.value || tod(),
      time: $("ev-time")?.value || "",
      endTime: $("ev-end")?.value || "",
      location: $("ev-loc")?.value?.trim() || "",
      color: _local.pickedColor,
      source: "manual",
    };
    await dbSet(refs.event(ev.id), ev);
    _local.showAddEvent = false;
    render();
  });

  // Delete manual event
  _container.querySelectorAll("[data-del-event]").forEach(btn =>
    btn.addEventListener("click", async () => await dbDelete(refs.event(btn.dataset.delEvent)))
  );

  on("refresh-cal", "click", () => fetchIcal());
}

function showToast(msg) {
  const c = document.getElementById("toast-container");
  if (!c) return;
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Module lifecycle ────────────────────────────────────────────
export async function init(container, ctx) {
  _container = container;
  _ctx = ctx;
  const { subscribe } = await import("../js/state.js");
  _stateUnsub = subscribe(() => render());
  render();
  fetchIcal();
  _refreshTimer = setInterval(fetchIcal, REFRESH_MS);
}

export function cleanup() {
  _stateUnsub?.();
  _stateUnsub = null;
  _container = null;
  _ctx = null;
  clearInterval(_refreshTimer);
  _refreshTimer = null;
}
