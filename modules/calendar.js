/**
 * Calendar Module — Week | 3-Day time grid | Month
 * Person colors: Dad=Green, Mom=Pink, George=Maroon, Ella=Light Purple,
 *                JD Travel=JD Green, Family=Blue
 */

import { refs, dbSet, dbDelete, uid } from "../js/db.js";
import { fetchIcalEvents } from "../js/ical.js";
import { callAIJson } from "../js/ai.js";

const REFRESH_MS = 5 * 60 * 1000;
const HOUR_H     = 56;   // px per hour in time grid
const DAY_START  = 6;    // 6 AM
const DAY_END    = 22;   // 10 PM

let _container   = null;
let _ctx         = null;
let _stateUnsub  = null;
let _refreshTimer = null;

const BRIDGE = (localStorage.getItem("os_bridge_url") || "http://localhost:3333");

// ── Person / category color system ──────────────────────────────
const C = {
  DAD:    "#34C759",   // Apple green
  MOM:    "#FF375F",   // Pink
  GEORGE: "#8B0000",   // Maroon
  ELLA:   "#C77DFF",   // Light purple
  JD:     "#366B2A",   // John Deere green
  FAMILY: "#007AFF",   // Blue
};

const LEGEND = [
  { label: "Dad",       color: C.DAD    },
  { label: "Mom",       color: C.MOM    },
  { label: "George",    color: C.GEORGE },
  { label: "Ella",      color: C.ELLA   },
  { label: "JD Travel", color: C.JD     },
  { label: "Family",    color: C.FAMILY },
];

function eventColor(e) {
  if (e.color && e.source !== "apple") return e.color;
  const cal   = (e.calendar || "").toLowerCase();
  const title = (e.title    || "").toLowerCase();
  if (cal.includes("john deere") || cal.includes("jd") || cal.includes("travel")) return C.JD;
  if (cal.includes("ella"))                                                         return C.ELLA;
  if (cal.includes("george") || cal.includes("georgie"))                            return C.GEORGE;
  if (cal.includes("mom") || cal.includes("jill"))                                  return C.MOM;
  if (cal.includes("personal") || cal.includes("michael") || cal.includes("dad"))  return C.DAD;
  if (cal.includes("family") || cal.includes("shared") || cal.includes("ebberts")) return C.FAMILY;
  return C.FAMILY;
}

// ── Local state ──────────────────────────────────────────────────
let _local = {
  view:         "week",
  selectedDate: new Date().toISOString().slice(0, 10),
  showAddEvent: false,
  pickedColor:  "#FF3B30",
  icalEvents:   [],
  icalLastFetch: null,
  icalError:    null,
  icalLoading:  false,
  nlOpen:       false,
  nlText:       "",
  nlBusy:       false,
  nlPreview:    null,
  nlListening:  false,
};

// ── Helpers ──────────────────────────────────────────────────────
const tod  = () => new Date().toISOString().slice(0, 10);
const escH = s  => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmt12 = t => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const timeToMin = t => {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

function weekDays(anchor) {
  const d   = new Date(anchor + "T12:00:00");
  const day = d.getDay();
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() - day + i);
    return x.toISOString().slice(0, 10);
  });
}

function threeDayDays(anchor) {
  const d = new Date(anchor + "T12:00:00");
  return Array.from({ length: 3 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

function fmtWeekRange(anchor) {
  const days = weekDays(anchor);
  const fmt  = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(days[0])} – ${fmt(days[6])}`;
}

function fmtLastSync(iso) {
  if (!iso) return null;
  const d    = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function hasConflict(dayEvents) {
  const timed = dayEvents.filter(e => e.time).sort((a, b) => (a.time < b.time ? -1 : 1));
  for (let i = 0; i < timed.length - 1; i++) {
    const endI = timed[i].endTime ? timeToMin(timed[i].endTime) : timeToMin(timed[i].time) + 60;
    if (timeToMin(timed[i + 1].time) < endI) return true;
  }
  return false;
}

function layoutEvents(timedEvents) {
  const evs = timedEvents.map(e => ({
    ...e,
    _s: timeToMin(e.time),
    _e: e.endTime ? timeToMin(e.endTime) : timeToMin(e.time) + 60,
    _col: 0,
    _numCols: 1,
  })).sort((a, b) => a._s - b._s);

  // Group overlapping events, then assign columns within each group
  const groups = [];
  evs.forEach(ev => {
    let placed = false;
    for (const g of groups) {
      if (g.some(o => o._s < ev._e && ev._s < o._e)) {
        g.push(ev);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([ev]);
  });

  groups.forEach(g => {
    const cols = [];
    g.sort((a, b) => a._s - b._s).forEach(ev => {
      let col = 0;
      while (cols[col] && cols[col]._e > ev._s) col++;
      cols[col] = ev;
      ev._col = col;
      ev._numCols = 0; // set after
    });
    const n = cols.length;
    g.forEach(ev => ev._numCols = n);
  });

  return evs;
}

// ── iCal fetch ───────────────────────────────────────────────────
async function fetchIcal() {
  _local.icalLoading = true;
  _local.icalError   = null;
  render();
  try {
    _local.icalEvents    = await fetchIcalEvents();
    _local.icalLastFetch = new Date().toISOString();
    _local.icalError     = null;
    const { setState } = await import("../js/state.js");
    setState({ icalEvents: _local.icalEvents, calLastSync: _local.icalLastFetch });
  } catch (e) {
    const bridgeDown = e.name === "AbortError" ||
      e.message.includes("Failed to fetch") ||
      e.message.includes("NetworkError") ||
      e.message.includes("Load failed");
    if (bridgeDown) {
      try {
        const fsRes = await fetch(
          `https://firestore.googleapis.com/v1/projects/inner-circle-crm/databases/(default)/documents/users/owner-inner-circle-crm/sync/calendar?key=AIzaSyDINHNV1Ze3QfhXwBPwe22LnUe-xxnU-n4`
        );
        if (fsRes.ok) {
          const doc = await fsRes.json();
          const raw = doc.fields?.data?.stringValue || "";
          _local.icalEvents = raw.split("\n").filter(Boolean).map((line, i) => {
            const [title, date, time, endTime, location, calendar] = line.split("|||");
            return { id: `fs_ev_${i}_${date}`, title: title||"", date: date||"", time: time||"", endTime: endTime||"", location: location||"", calendar: calendar||"iCloud", source: "apple" };
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

// ── Top-level render ─────────────────────────────────────────────
function render() {
  if (!_container || !_ctx) return;
  const { events } = _ctx.state();
  const allEvents  = [...events, ..._local.icalEvents];

  _container.innerHTML = `
    <div class="module-content">
      ${renderHeader()}
      ${renderLegend()}
      ${_local.nlOpen ? renderNLPanel() : ""}
      ${_local.view === "3day"  ? renderThreeDay(allEvents)  :
        _local.view === "month" ? renderMonth(allEvents)      :
                                  renderWeek(allEvents)}
      ${_local.showAddEvent ? renderAddModal() : ""}
    </div>
  `;

  bindEvents();
  if (_local.view === "3day") scrollToNow();
}

function scrollToNow() {
  const grid = _container.querySelector("#time-grid");
  if (!grid) return;
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes() - DAY_START * 60;
  grid.scrollTop = Math.max(0, (mins / 60) * HOUR_H - 80);
}

// ── Header ───────────────────────────────────────────────────────
function renderHeader() {
  const ago = fmtLastSync(_local.icalLastFetch);
  let statusEl;
  if (_local.icalLoading) {
    statusEl = `<div style="font-size:var(--text-xs);color:var(--text-secondary)">Loading…</div>`;
  } else if (_local.icalError) {
    statusEl = `<div style="font-size:var(--text-xs);color:var(--color-red,#FF3B30);font-weight:600" title="${escH(_local.icalError)}">⚠️ Sync error</div>`;
  } else if (_local.icalLastFetch) {
    statusEl = `<div style="display:flex;align-items:center;gap:6px;font-size:var(--text-xs);color:var(--text-secondary)">
      <span style="width:7px;height:7px;border-radius:50%;background:var(--color-green);flex-shrink:0"></span>
      Synced ${ago}
      <button class="btn btn-ghost btn-sm" id="refresh-cal" style="padding:0 4px;font-size:11px">↻</button>
    </div>`;
  } else {
    statusEl = `<div style="font-size:var(--text-xs);color:var(--text-secondary)">Connecting…</div>`;
  }

  const VIEWS = [
    { key: "week",  label: "Week"  },
    { key: "3day",  label: "3 Day" },
    { key: "month", label: "Month" },
  ];

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);gap:var(--space-3);flex-wrap:wrap">
      <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
        <div style="display:flex;border:1px solid var(--separator);border-radius:var(--radius-md);overflow:hidden">
          ${VIEWS.map(v => `
            <button class="btn" data-view="${v.key}" style="
              padding:5px 12px;font-size:12px;font-weight:600;border-radius:0;border:none;
              background:${_local.view === v.key ? "var(--accent)" : "transparent"};
              color:${_local.view === v.key ? "#fff" : "var(--text-primary)"};
              border-right:1px solid var(--separator)
            ">${v.label}</button>
          `).join("")}
        </div>
        <button class="btn btn-secondary btn-sm" id="cal-today">Today</button>
        <button class="btn btn-sm ${_local.nlOpen ? "btn-primary" : "btn-secondary"}" id="cal-nl-toggle">✦ Claude</button>
      </div>
      ${statusEl}
    </div>
  `;
}

function renderLegend() {
  return `
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:var(--space-3)">
      ${LEGEND.map(({ label, color }) => `
        <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-secondary)">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
          ${label}
        </div>
      `).join("")}
    </div>
  `;
}

// ── Week view ────────────────────────────────────────────────────
function renderWeek(allEvents) {
  const days    = weekDays(_local.selectedDate);
  const today   = tod();
  const evOnDay = iso => allEvents
    .filter(e => e.date === iso)
    .sort((a, b) => (a.time || "00:00") < (b.time || "00:00") ? -1 : 1);

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3)">
      <button class="btn btn-secondary btn-sm" id="prev-period">‹</button>
      <div style="font-weight:700;font-size:var(--text-md)">${fmtWeekRange(_local.selectedDate)}</div>
      <button class="btn btn-secondary btn-sm" id="next-period">›</button>
    </div>

    <div class="card" style="margin-bottom:var(--space-4)">
      <div style="display:grid;grid-template-columns:repeat(7,1fr)">
        ${days.map(iso => {
          const d        = new Date(iso + "T12:00:00");
          const isToday  = iso === today;
          const isSel    = iso === _local.selectedDate;
          const dayEvs   = evOnDay(iso);
          const conflict = hasConflict(dayEvs);
          return `
            <div class="day-btn" data-date="${iso}" style="
              padding:var(--space-2) 4px;text-align:center;cursor:pointer;
              border-right:1px solid var(--separator);
              background:${isSel ? "var(--accent-light)" : "transparent"};transition:background .1s
            ">
              <div style="font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">
                ${d.toLocaleDateString("en-US", { weekday: "short" })}
              </div>
              <div style="width:28px;height:28px;border-radius:50%;margin:3px auto 4px;
                display:flex;align-items:center;justify-content:center;
                font-size:var(--text-sm);font-weight:700;
                background:${isToday ? "var(--accent)" : "transparent"};
                color:${isToday ? "#fff" : "var(--text-primary)"}">
                ${d.getDate()}
              </div>
              <div style="display:flex;justify-content:center;gap:2px;min-height:8px;flex-wrap:wrap">
                ${dayEvs.slice(0, 4).map(ev =>
                  `<div style="width:6px;height:6px;border-radius:50%;background:${eventColor(ev)}"></div>`
                ).join("")}
              </div>
              ${conflict ? `<div style="font-size:9px;margin-top:2px" title="Schedule conflict">⚠️</div>` : ""}
            </div>
          `;
        }).join("")}
      </div>

      <div style="padding:var(--space-3);border-top:1px solid var(--separator)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3)">
          <div style="font-weight:700;font-size:var(--text-md)">
            ${new Date(_local.selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            ${_local.selectedDate === today ? ` <span style="color:var(--accent);font-size:var(--text-sm)">· Today</span>` : ""}
          </div>
          <button class="btn btn-primary btn-sm" id="add-event-btn">+ Event</button>
        </div>
        ${evOnDay(_local.selectedDate).length
          ? evOnDay(_local.selectedDate).map(e => renderEventRow(e)).join("")
          : `<div style="text-align:center;padding:var(--space-4);color:var(--text-secondary);font-size:var(--text-sm)">Nothing scheduled</div>`
        }
      </div>
    </div>

    <div class="section-title" style="margin-bottom:var(--space-3)">Upcoming</div>
    <div class="card">
      ${(() => {
        const upcoming = days.filter(d => d >= today).flatMap(iso => evOnDay(iso).map(e => ({ ...e, _iso: iso }))).slice(0, 10);
        if (!upcoming.length) return `<div style="padding:var(--space-5);text-align:center;color:var(--text-secondary);font-size:var(--text-sm)">No events coming up.</div>`;
        return upcoming.map(e => `
          <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--separator)">
            <div style="width:40px;text-align:center;flex-shrink:0">
              <div style="font-size:10px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase">
                ${new Date(e.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}
              </div>
              <div style="font-size:var(--text-lg);font-weight:800;line-height:1">
                ${new Date(e.date + "T12:00:00").getDate()}
              </div>
            </div>
            <div style="width:3px;height:36px;border-radius:2px;background:${eventColor(e)};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:var(--text-sm)">${escH(e.title)}</div>
              <div style="font-size:var(--text-xs);color:var(--text-secondary)">
                ${e.time ? fmt12(e.time) : "All day"}${e.endTime ? " – " + fmt12(e.endTime) : ""}
                ${e.location ? " · " + escH(e.location) : ""}
              </div>
            </div>
          </div>
        `).join("");
      })()}
    </div>
  `;
}

// ── 3-Day time-grid view ─────────────────────────────────────────
function renderThreeDay(allEvents) {
  const days    = threeDayDays(_local.selectedDate);
  const today   = tod();
  const hours   = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);

  const now      = new Date();
  const nowMins  = now.getHours() * 60 + now.getMinutes();
  const nowTop   = ((nowMins - DAY_START * 60) / 60) * HOUR_H;
  const showNow  = nowMins >= DAY_START * 60 && nowMins < DAY_END * 60;

  const fmtRange = () => {
    const fmt = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(days[0])} – ${fmt(days[2])}`;
  };

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3)">
      <button class="btn btn-secondary btn-sm" id="prev-period">‹</button>
      <div style="font-weight:700;font-size:var(--text-md)">${fmtRange()}</div>
      <button class="btn btn-secondary btn-sm" id="next-period">›</button>
    </div>

    <div id="time-grid" style="
      overflow-y:auto;
      max-height:calc(100vh - 300px);
      min-height:400px;
      border:1px solid var(--separator);
      border-radius:var(--radius-lg);
      background:var(--bg-surface);
    ">
      <div style="display:flex;position:relative">

        <!-- Time gutter -->
        <div style="width:40px;flex-shrink:0;border-right:1px solid var(--separator)">
          <!-- header spacer -->
          <div style="height:48px;border-bottom:1px solid var(--separator);background:var(--bg-surface-2)"></div>
          ${hours.map(h => `
            <div style="height:${HOUR_H}px;border-bottom:1px solid var(--separator);box-sizing:border-box;
              padding:3px 4px 0;font-size:9px;color:var(--text-tertiary);text-align:right;line-height:1">
              ${h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`}
            </div>
          `).join("")}
        </div>

        <!-- Day columns -->
        ${days.map(iso => {
          const d         = new Date(iso + "T12:00:00");
          const isToday   = iso === today;
          const dayEvs    = allEvents.filter(e => e.date === iso);
          const allDayEvs = dayEvs.filter(e => !e.time);
          const timedEvs  = layoutEvents(dayEvs.filter(e => !!e.time));
          const conflict  = hasConflict(dayEvs);

          return `
            <div style="flex:1;min-width:0;border-right:1px solid var(--separator);position:relative">
              <!-- Sticky day header -->
              <div style="
                position:sticky;top:0;z-index:3;
                height:48px;border-bottom:1px solid var(--separator);
                display:flex;flex-direction:column;align-items:center;justify-content:center;
                background:${isToday ? "var(--accent-light)" : "var(--bg-surface-2)"}
              ">
                <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase">
                  ${d.toLocaleDateString("en-US", { weekday: "short" })}
                </div>
                <div style="
                  width:24px;height:24px;border-radius:50%;
                  background:${isToday ? "var(--accent)" : "transparent"};
                  color:${isToday ? "#fff" : "var(--text-primary)"};
                  display:flex;align-items:center;justify-content:center;
                  font-size:13px;font-weight:700
                ">${d.getDate()}</div>
                ${conflict ? `<div style="position:absolute;top:4px;right:6px;font-size:10px" title="Conflict">⚠️</div>` : ""}
              </div>

              ${allDayEvs.length ? `
                <div style="padding:3px 4px;border-bottom:1px solid var(--separator);background:var(--bg-surface-2)">
                  ${allDayEvs.map(ev => `
                    <div style="font-size:9px;background:${eventColor(ev)}20;border-left:2px solid ${eventColor(ev)};
                      border-radius:2px;padding:2px 4px;margin-bottom:2px;
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary)">
                      ${escH(ev.title)}
                    </div>
                  `).join("")}
                </div>
              ` : ""}

              <!-- Hour grid + events -->
              <div style="position:relative">
                ${hours.map(h => `
                  <div style="height:${HOUR_H}px;
                    border-bottom:1px solid ${h % 2 === 0 ? "var(--separator)" : "rgba(128,128,128,0.1)"};
                    box-sizing:border-box">
                  </div>
                `).join("")}

                <!-- Current time line -->
                ${isToday && showNow ? `
                  <div style="position:absolute;left:0;right:0;top:${nowTop}px;height:2px;
                    background:var(--color-red,#FF3B30);z-index:3;pointer-events:none">
                    <div style="position:absolute;left:-1px;top:-4px;width:9px;height:9px;
                      border-radius:50%;background:var(--color-red,#FF3B30)"></div>
                  </div>
                ` : ""}

                <!-- Timed events -->
                ${timedEvs.map(ev => {
                  const top    = ((ev._s - DAY_START * 60) / 60) * HOUR_H;
                  const height = Math.max(((ev._e - ev._s) / 60) * HOUR_H - 2, 20);
                  const color  = eventColor(ev);
                  const pct    = 100 / (ev._numCols || 1);
                  return `
                    <div style="
                      position:absolute;
                      top:${top}px;
                      left:calc(${ev._col * pct}% + 1px);
                      width:calc(${pct}% - 3px);
                      height:${height}px;
                      background:${color}20;
                      border-left:3px solid ${color};
                      border-radius:4px;
                      padding:2px 4px;
                      overflow:hidden;
                      box-sizing:border-box;
                      z-index:1;
                      cursor:default;
                    " title="${escH(ev.title)} — ${fmt12(ev.time)}${ev.endTime ? "–" + fmt12(ev.endTime) : ""}${ev.location ? "\n📍 " + ev.location : ""}">
                      <div style="font-size:10px;font-weight:700;color:${color};line-height:1.2;
                        overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                        ${escH(ev.title)}
                      </div>
                      ${height > 30 ? `<div style="font-size:9px;color:var(--text-secondary)">${fmt12(ev.time)}${ev.endTime ? "–" + fmt12(ev.endTime) : ""}</div>` : ""}
                    </div>
                  `;
                }).join("")}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

// ── Month view ───────────────────────────────────────────────────
function renderMonth(allEvents) {
  const anchor      = new Date(_local.selectedDate + "T12:00:00");
  const year        = anchor.getFullYear();
  const month       = anchor.getMonth();
  const today       = tod();
  const firstDay    = new Date(year, month, 1);
  const startDow    = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startDow; i++) {
    cells.push({ iso: new Date(year, month, 1 - startDow + i).toISOString().slice(0, 10), current: false });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ iso: new Date(year, month, i).toISOString().slice(0, 10), current: true });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ iso: new Date(year, month + 1, cells.length - startDow - daysInMonth + 1).toISOString().slice(0, 10), current: false });
  }

  const weeks     = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const monthName = anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3)">
      <button class="btn btn-secondary btn-sm" id="prev-period">‹</button>
      <div style="font-weight:700;font-size:var(--text-md)">${monthName}</div>
      <button class="btn btn-secondary btn-sm" id="next-period">›</button>
    </div>

    <div class="card" style="overflow:hidden;margin-bottom:var(--space-4)">
      <!-- Day-of-week header -->
      <div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--separator);background:var(--bg-surface-2)">
        ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d =>
          `<div style="text-align:center;padding:6px 2px;font-size:10px;font-weight:700;color:var(--text-secondary)">${d}</div>`
        ).join("")}
      </div>

      ${weeks.map(week => `
        <div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--separator)">
          ${week.map(({ iso, current }) => {
            const d        = new Date(iso + "T12:00:00");
            const isToday  = iso === today;
            const isSel    = iso === _local.selectedDate;
            const dayEvs   = allEvents.filter(e => e.date === iso);
            const conflict = hasConflict(dayEvs);
            return `
              <div class="day-btn" data-date="${iso}" style="
                min-height:72px;padding:4px;
                border-right:1px solid var(--separator);
                background:${isSel ? "var(--accent-light)" : "transparent"};
                cursor:pointer;box-sizing:border-box;vertical-align:top
              ">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
                  <div style="
                    width:20px;height:20px;border-radius:50%;
                    background:${isToday ? "var(--accent)" : "transparent"};
                    color:${isToday ? "#fff" : current ? "var(--text-primary)" : "var(--text-tertiary)"};
                    display:flex;align-items:center;justify-content:center;
                    font-size:11px;font-weight:${isToday ? "800" : "600"}
                  ">${d.getDate()}</div>
                  ${conflict ? `<span style="font-size:9px" title="Schedule conflict">⚠️</span>` : ""}
                </div>
                ${dayEvs.slice(0, 3).map(ev => `
                  <div style="
                    font-size:9px;
                    background:${eventColor(ev)}20;
                    border-left:2px solid ${eventColor(ev)};
                    border-radius:2px;padding:1px 3px;margin-bottom:2px;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                    color:var(--text-primary);line-height:1.4
                  " title="${escH(ev.title)}">${escH(ev.title)}</div>
                `).join("")}
                ${dayEvs.length > 3
                  ? `<div style="font-size:9px;color:var(--text-tertiary);padding-left:2px">+${dayEvs.length - 3}</div>`
                  : ""}
              </div>
            `;
          }).join("")}
        </div>
      `).join("")}
    </div>

    <!-- Selected day detail panel -->
    ${renderDayDetail(allEvents)}
  `;
}

function renderDayDetail(allEvents) {
  const today  = tod();
  const dayEvs = allEvents
    .filter(e => e.date === _local.selectedDate)
    .sort((a, b) => (a.time || "00:00") < (b.time || "00:00") ? -1 : 1);

  return `
    <div class="card">
      <div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--separator);
        display:flex;align-items:center;justify-content:space-between">
        <div style="font-weight:700;font-size:var(--text-sm)">
          ${new Date(_local.selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          ${_local.selectedDate === today ? ` <span style="color:var(--accent);font-size:var(--text-xs)">· Today</span>` : ""}
        </div>
        <button class="btn btn-primary btn-sm" id="add-event-btn">+ Event</button>
      </div>
      ${dayEvs.length
        ? dayEvs.map(e => renderEventRow(e)).join("")
        : `<div style="padding:var(--space-4);text-align:center;color:var(--text-secondary);font-size:var(--text-sm)">Nothing scheduled</div>`
      }
    </div>
  `;
}

// ── Event row (shared) ───────────────────────────────────────────
function renderEventRow(e) {
  const color = eventColor(e);
  return `
    <div style="display:flex;align-items:flex-start;gap:var(--space-2);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--separator)">
      <div style="width:3px;min-height:40px;border-radius:2px;background:${color};flex-shrink:0;margin-top:2px"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:var(--text-sm)">${escH(e.title)}</div>
        <div style="font-size:var(--text-xs);color:var(--text-secondary)">
          ${e.time ? fmt12(e.time) : "All day"}${e.endTime ? " – " + fmt12(e.endTime) : ""}
          ${e.location ? " · " + escH(e.location) : ""}
          ${e.calendar ? ` · <span style="color:${color}">${escH(e.calendar)}</span>` : ""}
          ${e.source === "apple" ? " · 🍎" : ""}
        </div>
      </div>
      ${e.source !== "apple"
        ? `<button class="btn" style="font-size:11px;color:var(--text-tertiary)" data-del-event="${e.id}">✕</button>`
        : ""}
    </div>
  `;
}

// ── Add event modal ──────────────────────────────────────────────
const EVENT_COLORS = ["#FF3B30","#007AFF","#34C759","#FF9500","#AF52DE","#5AC8FA","#FF2D55","#FF6B35"];

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
                <button class="color-swatch" data-color="${c}" style="
                  width:26px;height:26px;border-radius:50%;background:${c};
                  border:3px solid ${_local.pickedColor === c ? "var(--bg-surface)" : "transparent"};
                  outline:2px solid ${_local.pickedColor === c ? c : "transparent"}">
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

// ── Claude NL panel ──────────────────────────────────────────────
function renderNLPanel() {
  const p     = _local.nlPreview;
  const hasMic = typeof SpeechRecognition !== "undefined" || typeof webkitSpeechRecognition !== "undefined";
  return `
    <div class="card" style="margin-bottom:var(--space-4);border-color:var(--accent);border-width:1.5px">
      <div style="padding:var(--space-3) var(--space-4)">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-bottom:var(--space-2)">
          ✦ Add with Claude
        </div>
        ${!p ? `
          <div style="display:flex;gap:var(--space-2);align-items:flex-start">
            <textarea id="cal-nl-input" rows="2"
              placeholder="e.g. dentist Thursday at 2pm, George baseball Saturday 9am at Liberty Park…"
              style="flex:1;resize:none;background:var(--bg-surface-2);border:1px solid var(--separator);
                border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);
                font-size:var(--text-sm);color:var(--text-primary);line-height:1.5"
              ${_local.nlBusy ? "disabled" : ""}>${escH(_local.nlText)}</textarea>
            <div style="display:flex;flex-direction:column;gap:var(--space-2)">
              ${hasMic ? `<button class="btn btn-secondary btn-sm" id="cal-nl-mic" title="Speak" style="font-size:16px;padding:6px 8px">${_local.nlListening ? "🔴" : "🎙️"}</button>` : ""}
              <button class="btn btn-primary btn-sm" id="cal-nl-parse" ${_local.nlBusy ? "disabled" : ""} style="white-space:nowrap">
                ${_local.nlBusy ? "…" : "→"}
              </button>
            </div>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:var(--space-2)">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2)">
              <div><label style="font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">Title</label><input class="input" id="cal-p-title" value="${escH(p.title)}" style="font-size:var(--text-sm)"></div>
              <div><label style="font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">Calendar</label><input class="input" id="cal-p-calendar" value="${escH(p.calendar)}" style="font-size:var(--text-sm)"></div>
              <div><label style="font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">Date</label><input class="input" id="cal-p-date" type="date" value="${escH(p.date)}" style="font-size:var(--text-sm)"></div>
              <div><label style="font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">Start time</label><input class="input" id="cal-p-time" type="time" value="${escH(p.time)}" style="font-size:var(--text-sm)"></div>
              <div><label style="font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">End time</label><input class="input" id="cal-p-end" type="time" value="${escH(p.endTime)}" style="font-size:var(--text-sm)"></div>
              <div><label style="font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">Location</label><input class="input" id="cal-p-loc" value="${escH(p.location)}" style="font-size:var(--text-sm)"></div>
            </div>
            <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-1)">
              <button class="btn btn-ghost btn-sm" id="cal-nl-cancel">Cancel</button>
              <button class="btn btn-primary btn-sm" id="cal-nl-confirm" ${_local.nlBusy ? "disabled" : ""}>
                ${_local.nlBusy ? "Adding…" : "Add to Calendar ✓"}
              </button>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

async function parseCalNL(text) {
  text = (text || "").trim();
  if (!text || _local.nlBusy) return;
  _local.nlText    = text;
  _local.nlBusy    = true;
  _local.nlPreview = null;
  render();

  const today    = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const dow      = today.toLocaleDateString("en-US", { weekday: "long" });

  const prompt = `Extract a calendar event from this text into JSON. Today is ${dow}, ${todayStr}.
Text: "${text}"
Return ONLY a JSON object (no markdown) with these keys:
- title: short event title (required)
- date: "YYYY-MM-DD" (required, resolve relative dates like "tomorrow", "next Friday", "this Saturday")
- time: start time as "HH:mm" 24-hour, or "" if not mentioned
- endTime: end time as "HH:mm" 24-hour, or "" if not mentioned
- location: location string, or ""
- calendar: best match from: "Family" (default), "Georgie" (George's events), "Ella" (Ella's events), "Ebberts Family", "Calendar", "John Deere Travel" (work travel)
- notes: any extra detail, or ""`;

  const parsed = await callAIJson(prompt, null, { maxTokens: 300 });
  _local.nlBusy = false;

  if (!parsed?.title || !parsed?.date) {
    render();
    alert("Couldn't parse that into an event. Try rephrasing.");
    return;
  }
  _local.nlPreview = {
    title:    parsed.title || "",
    date:     parsed.date  || todayStr,
    time:     parsed.time  || "",
    endTime:  parsed.endTime || "",
    location: parsed.location || "",
    calendar: parsed.calendar || "Family",
    notes:    parsed.notes || "",
  };
  render();
}

async function confirmCalNL() {
  if (_local.nlBusy) return;
  const $  = id => document.getElementById(id);
  const payload = {
    title:    $("cal-p-title")?.value?.trim()    || "",
    date:     $("cal-p-date")?.value             || "",
    time:     $("cal-p-time")?.value             || "",
    endTime:  $("cal-p-end")?.value              || "",
    location: $("cal-p-loc")?.value?.trim()      || "",
    calendar: $("cal-p-calendar")?.value?.trim() || "Family",
    notes:    _local.nlPreview?.notes || "",
  };
  if (!payload.title || !payload.date) { alert("Title and date are required."); return; }

  _local.nlBusy = true;
  render();

  try {
    const res  = await fetch(`${BRIDGE}/calendar/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "add failed");
    _local.nlBusy    = false;
    _local.nlPreview = null;
    _local.nlText    = "";
    _local.nlOpen    = false;
    render();
    showToast("Event added to Apple Calendar ✓");
    setTimeout(() => fetchIcal(), 2000);
  } catch {
    // Bridge unreachable — save to Firestore
    const ev = {
      id:       uid(),
      title:    payload.title,
      date:     payload.date,
      time:     payload.time,
      endTime:  payload.endTime,
      location: payload.location,
      calendar: payload.calendar,
      color:    "#007AFF",
      source:   "manual",
    };
    await dbSet(refs.event(ev.id), ev);
    _local.nlBusy    = false;
    _local.nlPreview = null;
    _local.nlText    = "";
    _local.nlOpen    = false;
    render();
    showToast("Saved ✓ (will sync to Apple Calendar when Mac is reachable)");
  }
}

// ── Navigation helpers ───────────────────────────────────────────
function navigate(dir) {
  const d = new Date(_local.selectedDate + "T12:00:00");
  if (_local.view === "month") {
    d.setMonth(d.getMonth() + dir);
    d.setDate(1);
  } else if (_local.view === "3day") {
    d.setDate(d.getDate() + dir * 3);
  } else {
    d.setDate(d.getDate() + dir * 7);
  }
  _local.selectedDate = d.toISOString().slice(0, 10);
  render();
}

// ── Event binding ────────────────────────────────────────────────
function bindEvents() {
  if (!_container) return;
  const $  = id => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

  // View tabs
  _container.querySelectorAll("[data-view]").forEach(btn =>
    btn.addEventListener("click", () => { _local.view = btn.dataset.view; render(); })
  );

  // Today button
  on("cal-today", "click", () => { _local.selectedDate = tod(); render(); });

  // Prev / next (unified, view-aware)
  on("prev-period", "click", () => navigate(-1));
  on("next-period", "click", () => navigate(1));

  // Day selection (week strip + month grid)
  _container.querySelectorAll(".day-btn").forEach(btn =>
    btn.addEventListener("click", () => { _local.selectedDate = btn.dataset.date; render(); })
  );

  // Add event
  on("add-event-btn",     "click", () => { _local.showAddEvent = true;  render(); setTimeout(() => $("ev-title")?.focus(), 50); });
  on("close-event-modal", "click", () => { _local.showAddEvent = false; render(); });
  on("cancel-add-event",  "click", () => { _local.showAddEvent = false; render(); });

  _container.querySelectorAll(".color-swatch").forEach(btn =>
    btn.addEventListener("click", () => { _local.pickedColor = btn.dataset.color; render(); })
  );

  on("confirm-add-event", "click", async () => {
    const title = $("ev-title")?.value?.trim();
    if (!title) return;
    const ev = {
      id:       uid(),
      title,
      date:     $("ev-date")?.value  || tod(),
      time:     $("ev-time")?.value  || "",
      endTime:  $("ev-end")?.value   || "",
      location: $("ev-loc")?.value?.trim() || "",
      color:    _local.pickedColor,
      source:   "manual",
    };
    await dbSet(refs.event(ev.id), ev);
    _local.showAddEvent = false;
    render();
  });

  // Delete manual event
  _container.querySelectorAll("[data-del-event]").forEach(btn =>
    btn.addEventListener("click", async () => await dbDelete(refs.event(btn.dataset.delEvent)))
  );

  // Refresh
  on("refresh-cal", "click", () => fetchIcal());

  // Claude NL
  on("cal-nl-toggle", "click", () => {
    _local.nlOpen    = !_local.nlOpen;
    _local.nlPreview = null;
    _local.nlText    = "";
    render();
    setTimeout(() => $("cal-nl-input")?.focus(), 50);
  });
  on("cal-nl-input",   "input",   e  => { _local.nlText = e.target.value; });
  on("cal-nl-parse",   "click",   () => parseCalNL($("cal-nl-input")?.value || _local.nlText));
  on("cal-nl-input",   "keydown", e  => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); parseCalNL($("cal-nl-input")?.value || _local.nlText); } });
  on("cal-nl-cancel",  "click",   () => { _local.nlPreview = null; _local.nlText = ""; render(); });
  on("cal-nl-confirm", "click",   () => confirmCalNL());

  // Mic
  on("cal-nl-mic", "click", () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || _local.nlListening) return;
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
    _local.nlListening = true; render();
    rec.onresult = e => {
      const t = e.results[0][0].transcript;
      _local.nlListening = false;
      _local.nlText      = t;
      render();
      parseCalNL(t);
    };
    rec.onerror = rec.onend = () => { _local.nlListening = false; render(); };
    rec.start();
  });
}

// ── Toast ────────────────────────────────────────────────────────
function showToast(msg) {
  const c = document.getElementById("toast-container");
  if (!c) return;
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Module lifecycle ─────────────────────────────────────────────
export async function init(container, ctx) {
  _container = container;
  _ctx       = ctx;
  const { subscribe } = await import("../js/state.js");
  _stateUnsub  = subscribe(() => render());
  render();
  fetchIcal();
  _refreshTimer = setInterval(fetchIcal, REFRESH_MS);
}

export function cleanup() {
  _stateUnsub?.();
  _stateUnsub   = null;
  _container    = null;
  _ctx          = null;
  clearInterval(_refreshTimer);
  _refreshTimer = null;
}
