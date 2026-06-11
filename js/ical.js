/**
 * iCal fetch + parse (with RRULE/recurring expansion).
 * Shared by the Calendar module and the Kitchen kiosk.
 * Fetches through the local bridge proxy (iCloud doesn't send CORS headers).
 */

import { BRIDGE_URL } from "./config.js";

// Get events from the proxy. Two modes:
//   1. Local Mac bridge (serve_os.py) exposes /calendar-events — parses iCal
//      server-side and returns JSON. Used on a weak client (Pi Zero) that froze
//      while parsing in-browser.
//   2. Cloudflare Worker (kitchen kiosk on a Fire TV etc.) only passes the raw
//      .ics through at /ical; we parse it client-side here. A Fire TV 4K handles
//      the parse fine, unlike the Pi Zero.
// We try /calendar-events first and fall back to /ical + parseIcal on 404.
export async function fetchIcalEvents() {
  const fetchJson = async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`${BRIDGE_URL}/calendar-events`, { signal: ctrl.signal });
      if (res.status === 404) return null; // proxy doesn't parse server-side → fall back
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data.events) ? data.events : [];
    } finally {
      clearTimeout(t);
    }
  };

  const fetchRaw = async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`${BRIDGE_URL}/ical`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseIcal(await res.text());
    } finally {
      clearTimeout(t);
    }
  };

  try {
    const events = await fetchJson();
    if (events !== null) return events;
  } catch (e) {
    // /calendar-events errored (e.g. worker has no such route) — try raw .ics.
  }
  return fetchRaw();
}

// ── iCal date parser ────────────────────────────────────────────
function parseDt(s) {
  if (!s) return null;
  const isUtc = s.endsWith("Z");
  if (isUtc) {
    const raw = s.slice(0, -1);
    const d = new Date(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(9,11)}:${raw.slice(11,13)}:00Z`);
    return {
      date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`,
      time: `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`,
      allDay: false,
      jsDate: d,
    };
  }
  const raw = s.replace(/[TZ]/g,"").replace(/[-:]/g,"");
  const allDay = !s.includes("T");
  const yr = raw.slice(0,4), mo = raw.slice(4,6), dy = raw.slice(6,8);
  const hr = raw.slice(8,10)||"00", mn = raw.slice(10,12)||"00";
  const jsDate = new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:00`);
  return { date:`${yr}-${mo}-${dy}`, time: allDay ? "" : `${hr}:${mn}`, allDay, jsDate };
}

// ── RRULE expander ───────────────────────────────────────────────
function expandRRule(baseEvent, rruleStr, exdateSet) {
  // Cover the whole visible range: from a week before the start of the current
  // month (the month grid shows leading days + past days of this week) through
  // ~120 days out. Otherwise recurring instances earlier than "today" never show.
  const today = new Date(); today.setHours(0,0,0,0);
  const winStart = new Date(today.getFullYear(), today.getMonth(), 1);
  winStart.setDate(winStart.getDate() - 7); winStart.setHours(0,0,0,0);
  const winEnd = new Date(today); winEnd.setDate(winEnd.getDate() + 120);

  const p = {};
  rruleStr.split(";").forEach(part => { const [k,v] = part.split("="); p[k]=v; });

  const freq     = p.FREQ;
  const interval = parseInt(p.INTERVAL||"1");
  const count    = p.COUNT ? parseInt(p.COUNT) : null;
  const until    = p.UNTIL ? parseDt(p.UNTIL)?.jsDate : null;
  const byDays   = p.BYDAY ? p.BYDAY.split(",").map(d => ({SU:0,MO:1,TU:2,WE:3,TH:4,FR:5,SA:6})[d.replace(/[-+\d]/g,"")]) : null;

  const advance = d => {
    const n = new Date(d);
    if (freq==="DAILY")   n.setDate(n.getDate() + interval);
    else if (freq==="WEEKLY")  n.setDate(n.getDate() + 7*interval);
    else if (freq==="MONTHLY") n.setMonth(n.getMonth() + interval);
    else if (freq==="YEARLY")  n.setFullYear(n.getFullYear() + interval);
    else return null;
    return n;
  };

  const results = [];
  let cur = new Date(baseEvent._jsDate || winStart);
  // Fast-forward to the window (only safe when not COUNT-limited) so long-running
  // recurrences don't burn the iteration budget before reaching the visible range.
  if (count === null) {
    let guard = 0;
    while (cur < winStart && guard++ < 6000) {
      const next = advance(cur);
      if (!next || +next === +cur) break;
      cur = next;
    }
  }
  let n = 0;

  while (cur <= winEnd) {
    if ((count !== null && n >= count) || (until && cur > until)) break;

    const candidateDates = byDays && freq==="WEEKLY"
      ? byDays.map(dow => { const d=new Date(cur); d.setDate(d.getDate()-d.getDay()+dow); return d; })
      : [cur];

    for (const cd of candidateDates) {
      if (cd < winStart || cd > winEnd) continue;
      const dateStr = `${cd.getFullYear()}-${String(cd.getMonth()+1).padStart(2,"0")}-${String(cd.getDate()).padStart(2,"0")}`;
      if (!exdateSet.has(dateStr)) {
        results.push({ ...baseEvent, id: `${baseEvent.id}_${dateStr}`, date: dateStr });
      }
    }

    const next = advance(cur);
    if (!next || +next === +cur) break;
    cur = next;
    n++;
    if (n > 500) break;
  }
  return results;
}

export function parseIcal(text) {
  // Unfold iCal lines (CRLF + whitespace = continuation)
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\r\n/g, "\n");
  const events = [];
  const blocks = unfolded.split("BEGIN:VEVENT");

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const get = key => {
      const m = block.match(new RegExp(`${key}[^:\n]*:([^\n]+)`));
      return m ? m[1].trim() : "";
    };
    const getAll = key => {
      const re = new RegExp(`${key}[^:\n]*:([^\n]+)`, "g");
      const vals = []; let m;
      while ((m = re.exec(block)) !== null) vals.push(m[1].trim());
      return vals;
    };

    const title    = get("SUMMARY").replace(/\\,/g,",").replace(/\\n/g," ").replace(/\\;/g,";");
    const location = get("LOCATION").replace(/\\,/g,",");
    const dtstart  = get("DTSTART");
    const dtend    = get("DTEND");
    const rrule    = get("RRULE");
    const uid      = get("UID");

    if (!title || !dtstart) continue;

    const start  = parseDt(dtstart);
    const end    = dtend ? parseDt(dtend) : null;

    const exdateSet = new Set(
      getAll("EXDATE").flatMap(v => v.split(",")).map(v => parseDt(v)?.date).filter(Boolean)
    );

    const baseEvent = {
      id: uid || `ev-${i}`,
      title,
      date: start.date,
      time: start.allDay ? "" : start.time,
      endTime: end && !end.allDay ? end.time : "",
      location,
      calendar: "iCloud",
      source: "apple",
      allDay: start.allDay,
      _jsDate: start.jsDate,
    };

    if (rrule) {
      events.push(...expandRRule(baseEvent, rrule, exdateSet));
    } else {
      events.push(baseEvent);
    }
  }

  return events.map(({ _jsDate, ...e }) => e);
}
