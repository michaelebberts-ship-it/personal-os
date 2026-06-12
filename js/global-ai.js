/**
 * Global Claude AI assistant — floating ✦ button on every module.
 * Initialized once from app.js; persists across module navigation.
 */

import { callAIChat } from "./ai.js";
import { getState } from "./state.js";
import { refs, dbSet, uid } from "./db.js";
import { getCurrentModule } from "./router.js";

const BRIDGE = localStorage.getItem("os_bridge_url") || "http://localhost:3333";

let _ai = { open: false, busy: false, listening: false, msgs: [], input: "" };
let _navigate = null;   // injected from app.js
let _fabEl = null;
let _sheetEl = null;
let _backdropEl = null;

const _esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function tod() { return new Date().toISOString().slice(0, 10); }

// ── Build context for Claude ───────────────────────────────────
function buildContext() {
  const S = getState();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const dow = today.toLocaleDateString("en-US", { weekday: "long" });
  const currentModule = getCurrentModule();

  const allEvents = [...(S.events || []), ...(S.syncedEvents || [])];
  const upcoming = allEvents
    .filter(e => e.date >= todayStr && e.date <= new Date(today.getTime() + 7*86400000).toISOString().slice(0,10))
    .sort((a,b) => a.date < b.date ? -1 : 1)
    .slice(0, 40)
    .map(e => `${e.date} ${e.time||"all day"}: ${e.title}${e.location ? " @ "+e.location : ""}`)
    .join("\n");

  const reminders = (S.reminders || [])
    .filter(r => !r.completed)
    .slice(0, 20)
    .map(r => `- ${r.title}${r.dueDate ? " (due "+r.dueDate+")" : ""}`)
    .join("\n");

  const contacts = (S.contacts || [])
    .slice(0, 50)
    .map(c => `${c.fname} ${c.lname}${c.phone ? " (phone:"+c.phone+")" : ""}${c.note ? " — "+c.note : ""}`)
    .join("\n");

  const txWeight  = localStorage.getItem("transformation_weight");
  const txProtein = localStorage.getItem(`transformation_protein_${todayStr.replace(/-/g,"")}`);

  const moduleNames = {
    home: "Home Dashboard", calendar: "Calendar", reminders: "Tasks & Reminders",
    crm: "Inner Circle CRM", finances: "Finance", meals: "Meals",
    household: "Household", family: "Family", email: "Email",
    transformation: "Fitness / Transformation",
  };

  return `You are Claude, the personal AI assistant inside the Ebberts Command Center.
Today is ${dow}, ${todayStr}. User: Michael Ebberts.
Currently viewing: ${moduleNames[currentModule] || currentModule} module.

UPCOMING EVENTS (next 7 days):
${upcoming || "No events found"}

ACTIVE REMINDERS:
${reminders || "None"}

CONTACTS (name, phone, background):
${contacts || "None"}

TRANSFORMATION: Weight: ${txWeight||"unknown"}lbs, Protein today: ${txProtein||"0"}g

YOUR CALENDARS: Family (default), Georgie, Ebberts Family, Calendar, John Deere Travel

Respond conversationally. When taking action, append a JSON ACTIONS block at the very end:

ACTIONS:
[{"type":"add_calendar","title":"...","date":"YYYY-MM-DD","time":"HH:mm","endTime":"HH:mm","location":"...","calendar":"Family"},
 {"type":"add_reminder","title":"...","due":"YYYY-MM-DD","time":"HH:mm","list":"Reminders","priority":"none","notes":"..."},
 {"type":"text_contact","contact_name":"First Last","context":"brief reason/content"}]

Only include ACTIONS when taking action — omit for questions.`;
}

// ── Render sheet HTML ──────────────────────────────────────────
function renderSheet() {
  // Remove existing
  document.getElementById("global-ai-backdrop")?.remove();
  document.getElementById("global-ai-sheet")?.remove();

  if (!_ai.open) return;

  const hasMic = typeof SpeechRecognition !== "undefined" || typeof webkitSpeechRecognition !== "undefined";
  const msgs = _ai.msgs.map(m => `
    <div style="display:flex;flex-direction:${m.role==="user"?"row-reverse":"row"};gap:8px;align-items:flex-start;margin-bottom:12px">
      <div style="
        max-width:82%;padding:10px 14px;
        border-radius:${m.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px"};
        background:${m.role==="user"?"var(--accent)":"var(--bg-surface-2)"};
        color:${m.role==="user"?"#000":"var(--text-primary)"};
        font-size:13px;line-height:1.5;white-space:pre-wrap;
      ">${m.html ? m.text : _esc(m.text)}</div>
    </div>
  `).join("");

  const backdrop = document.createElement("div");
  backdrop.id = "global-ai-backdrop";
  backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;backdrop-filter:blur(4px)";
  backdrop.onclick = () => { _ai.open = false; renderSheet(); };

  const sheet = document.createElement("div");
  sheet.id = "global-ai-sheet";
  sheet.style.cssText = `
    position:fixed;bottom:0;left:0;right:0;z-index:1001;
    background:var(--bg-surface);border-radius:20px 20px 0 0;
    border-top:1px solid var(--separator);
    max-height:80dvh;display:flex;flex-direction:column;
    animation:gai-slideUp .25s ease;
  `;

  const moduleName = getCurrentModule();
  sheet.innerHTML = `
    <style>@keyframes gai-slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
    @keyframes gai-pulse{0%,100%{opacity:.3}50%{opacity:1}}</style>
    <div style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--separator);flex-shrink:0">
      <div style="font-size:13px;font-weight:700;color:var(--accent);display:flex;align-items:center;gap:6px">
        ✦ <span style="color:var(--text-primary)">Ask Claude</span>
        <span style="font-size:10px;color:var(--text-tertiary);font-weight:400;margin-left:4px">${moduleName}</span>
      </div>
      <button id="gai-close" style="background:none;border:none;color:var(--text-tertiary);font-size:22px;cursor:pointer;padding:0 4px;line-height:1">×</button>
    </div>
    <div id="gai-msgs" style="flex:1;overflow-y:auto;padding:16px;min-height:80px;max-height:50dvh">
      ${msgs || `<div style="color:var(--text-tertiary);font-size:13px;text-align:center;padding:24px 0">
        Ask anything — add events, text someone, check your schedule.<br>
        <span style="font-size:11px;opacity:.7">"What's on today?" · "Add dentist Friday 2pm" · "Text Lauren on the way home"</span>
      </div>`}
      ${_ai.busy ? `<div style="display:flex;gap:4px;padding:8px 0;align-items:center">
        <div style="width:7px;height:7px;border-radius:50%;background:var(--accent);animation:gai-pulse 1s infinite"></div>
        <div style="width:7px;height:7px;border-radius:50%;background:var(--accent);animation:gai-pulse 1s .2s infinite"></div>
        <div style="width:7px;height:7px;border-radius:50%;background:var(--accent);animation:gai-pulse 1s .4s infinite"></div>
      </div>` : ""}
    </div>
    <div style="padding:12px;border-top:1px solid var(--separator);display:flex;gap:8px;align-items:flex-end;flex-shrink:0">
      <textarea id="gai-input" rows="1"
        placeholder="Ask anything or give a command…"
        style="flex:1;resize:none;background:var(--bg-surface-2);border:1px solid var(--separator);border-radius:12px;padding:10px 12px;font-size:13px;color:var(--text-primary);font-family:inherit;line-height:1.4;max-height:120px;overflow-y:auto"
        ${_ai.busy ? "disabled" : ""}
      >${_esc(_ai.input)}</textarea>
      ${hasMic ? `<button id="gai-mic" style="width:40px;height:40px;border-radius:50%;background:${_ai.listening?"#EF4444":"var(--bg-surface-2)"};border:1px solid var(--separator);font-size:18px;cursor:pointer;flex-shrink:0">${_ai.listening?"🔴":"🎙️"}</button>` : ""}
      <button id="gai-send" ${_ai.busy?"disabled":""} style="width:40px;height:40px;border-radius:50%;background:var(--accent);color:#000;font-size:18px;border:none;cursor:pointer;flex-shrink:0;font-weight:700">↑</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  // Bind
  sheet.querySelector("#gai-close").onclick = () => { _ai.open = false; renderSheet(); };

  const input = sheet.querySelector("#gai-input");
  const send  = sheet.querySelector("#gai-send");
  const mic   = sheet.querySelector("#gai-mic");

  if (input) {
    input.addEventListener("input", e => { _ai.input = e.target.value; autoResize(e.target); });
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(input.value); } });
    setTimeout(() => { input.focus(); }, 80);
  }
  if (send) send.onclick = () => sendMsg(document.getElementById("gai-input")?.value || _ai.input);
  if (mic) mic.onclick = startMic;

  // Scroll to bottom
  const msgs_ = sheet.querySelector("#gai-msgs");
  if (msgs_) msgs_.scrollTop = msgs_.scrollHeight;
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

// ── Send a message ─────────────────────────────────────────────
export async function sendMsg(text, prefill = false) {
  if (!text?.trim() || _ai.busy) return;
  if (!prefill) {
    _ai.msgs.push({ role: "user", text: text.trim() });
  }
  _ai.input = "";
  _ai.busy = true;
  renderSheet();

  try {
    const messages = _ai.msgs.filter(m => !m.html).map(m => ({ role: m.role, content: m.text }));
    const full = await callAIChat(messages, buildContext(), 1024);

    const actionSplit = full.indexOf("\nACTIONS:");
    const replyText   = actionSplit > -1 ? full.slice(0, actionSplit).trim() : full.trim();
    const actionBlock = actionSplit > -1 ? full.slice(actionSplit + 9).trim() : null;

    _ai.msgs.push({ role: "assistant", text: replyText });
    _ai.busy = false;
    renderSheet();

    if (actionBlock) await executeActions(actionBlock);
  } catch (e) {
    _ai.msgs.push({ role: "assistant", text: "Something went wrong: " + e.message });
    _ai.busy = false;
    renderSheet();
  }
}

// ── Execute actions ────────────────────────────────────────────
async function executeActions(actionBlock) {
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
        if (!d.ok) throw new Error();
        showToast(`📅 "${a.title}" added to ${a.calendar||"Family"}`);
      } catch {
        const ev = { id: uid(), title: a.title, date: a.date, time: a.time||"",
          endTime: a.endTime||"", location: a.location||"", calendar: a.calendar||"Family",
          color: "#007AFF", source: "manual" };
        await dbSet(refs.event(ev.id), ev);
        showToast(`📅 "${a.title}" saved`);
      }
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
        showToast(`✓ "${a.title}" added`);
      } catch {
        const rem = { id: uid(), title: a.title, dueDate: a.due||null, completed: false,
          list: a.list||"Reminders", priority: a.priority||"none", notes: a.notes||"", tags: [] };
        await dbSet(refs.reminder(rem.id), rem);
        showToast(`✓ "${a.title}" saved`);
      }
    }

    if (a.type === "text_contact") {
      const { callAI } = await import("./ai.js");
      const contacts = getState().contacts || [];
      const nameLower = (a.contact_name || "").toLowerCase();
      const contact = contacts.find(c =>
        (c.fname + " " + c.lname).toLowerCase() === nameLower
      ) || contacts.find(c =>
        (c.fname + " " + c.lname).toLowerCase().includes(nameLower.split(" ")[0])
      );
      if (!contact) {
        _ai.msgs.push({ role: "assistant", text: `⚠️ Couldn't find "${a.contact_name}" in your contacts.` });
        renderSheet(); continue;
      }
      const draft = await callAI(
        `Write a short casual iMessage from Michael to ${contact.fname} about: ${a.context}. Background: ${contact.note || "friend"}. Easygoing dad energy. 1-2 sentences. Just the message text.`,
        { maxTokens: 120 }
      );
      if (!draft) { renderSheet(); continue; }
      const phone = contact.phone ? String(contact.phone).replace(/\D/g,"") : null;
      const smsLink = phone ? `sms:+${phone.length === 10 ? "1"+phone : phone}?body=${encodeURIComponent(draft)}` : null;
      const note = { id: uid(), date: tod(), text: "Texted: " + draft };
      const fresh = (getState().contacts || []).find(x => x.id === contact.id);
      const updatedNotes = [note, ...((fresh?.contactNotes) || [])];
      await dbSet(refs.contact(contact.id), { ...fresh, contactNotes: updatedNotes, lastContact: tod() });
      const draftEsc = draft.replace(/&/g,"&amp;").replace(/</g,"&lt;");
      _ai.msgs.push({ role: "assistant", html: true, text:
        `<div style="font-size:12px;font-weight:700;color:var(--text-tertiary);margin-bottom:4px">📱 ${contact.fname} ${contact.lname}</div>` +
        `<div style="font-style:italic;line-height:1.6;margin-bottom:8px">"${draftEsc}"</div>` +
        (smsLink ? `<a href="${smsLink}" style="display:inline-block;padding:6px 14px;border-radius:20px;background:var(--color-green);color:#fff;font-size:12px;font-weight:700;text-decoration:none;margin-bottom:6px">📱 Open in Messages</a><br>` : "") +
        `<div style="font-size:11px;color:var(--text-tertiary)">✅ Note logged in CRM</div>`
      });
      renderSheet(); continue;
    }
  }
}

// ── Mic ────────────────────────────────────────────────────────
function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || _ai.listening) return;
  const rec = new SR();
  rec.lang = "en-US"; rec.interimResults = false;
  _ai.listening = true; renderSheet();
  rec.onresult = e => { _ai.listening = false; sendMsg(e.results[0][0].transcript); };
  rec.onerror = rec.onend = () => { _ai.listening = false; renderSheet(); };
  rec.start();
}

// ── Open with a pre-set prompt ─────────────────────────────────
export function openWithPrompt(prompt) {
  _ai.open = true;
  _ai.msgs = [];
  renderSheet();
  setTimeout(() => sendMsg(prompt), 80);
}

// ── Toast ──────────────────────────────────────────────────────
function showToast(msg) {
  const c = document.getElementById("toast-container");
  if (!c) return;
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Init — call once from app.js ───────────────────────────────
export function initGlobalAI(navigateFn) {
  _navigate = navigateFn;

  // Create the persistent FAB
  const fab = document.createElement("button");
  fab.id = "global-ai-fab";
  fab.title = "Ask Claude";
  fab.innerHTML = "✦";
  fab.style.cssText = `
    position:fixed;bottom:calc(var(--bottom-nav-height,0px) + 20px);right:20px;
    width:52px;height:52px;border-radius:50%;
    background:linear-gradient(135deg,#00D4FF,#0080FF);
    color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;
    box-shadow:0 4px 20px rgba(0,212,255,.45);border:none;cursor:pointer;z-index:900;
    transition:transform .15s,box-shadow .15s;font-family:inherit;
  `;
  fab.onmouseover = () => { fab.style.transform = "scale(1.08)"; fab.style.boxShadow = "0 6px 28px rgba(0,212,255,.6)"; };
  fab.onmouseout  = () => { fab.style.transform = "scale(1)";    fab.style.boxShadow = "0 4px 20px rgba(0,212,255,.45)"; };
  fab.onclick = () => { _ai.open = true; renderSheet(); };

  document.body.appendChild(fab);
  _fabEl = fab;
}
