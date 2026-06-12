/**
 * CRM Module — Inner Circle Contacts
 * Reads/writes the same Firebase collection as the standalone CRM.
 */

import { refs, dbSet, dbUpdate, dbDelete, uid } from "../js/db.js";
import { draftText, generateGiftIdeas, getApiKey } from "../js/ai.js";
import { COLORS, TAG_META, GROUPS } from "../js/config.js";

let _container = null;
let _ctx = null;
let _state = {
  view: "grid",           // "grid" | "birthdays"
  group: "all",
  search: "",
  detail: null,           // contact being viewed
  showAdd: false,
  showEdit: false,
  addColor: COLORS[0],
  addTags: [],
  editColor: COLORS[0],
  editTags: [],
  draftText: null,
  draftLoading: false,
  noteAdding: false,
  giftAdding: false,
  giftGenerating: false,
  addOccasion: "🎂 Birthday",
  showApiKey: false,
  // Quick Text
  showQt: false,
  qtText: "",
  qtContact: null,
  qtDraft: null,
  qtLoading: false,
  qtListening: false,
  qtError: null,
  qtLogged: false,
};

let _qtRecog = null;

const OCCASIONS = ["🎂 Birthday","🎄 Christmas","🎁 Holiday","👨‍👧 Father's Day","👩‍👧 Mother's Day","🎓 Graduation","🏠 Housewarming","💍 Wedding","⭐ Just because"];

// ── Utils ───────────────────────────────────────────────────────
const tod = () => new Date().toISOString().slice(0, 10);
const daysSince = d => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400e3) : 999;
const ini = c => ((c.fname||"")[0] + (c.lname||"")[0] || "?").toUpperCase();
const escH = s => String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const telDigits = p => { let d = String(p||"").replace(/\D/g,""); if(!d) return ""; if(d.length===10) d="1"+d; return d; };
const fmtPhone = p => { const d=telDigits(p); if(!d) return ""; return d.length===11&&d[0]==="1" ? `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}` : "+"+d; };
const fmtD = iso => new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
const dbu = b => {
  if (!b) return null;
  const p = b.split("-"); if (p.length<3) return null;
  const t = new Date(); t.setHours(0,0,0,0);
  const nx = new Date(t.getFullYear(), +p[1]-1, +p[2]);
  if (nx < t) nx.setFullYear(t.getFullYear()+1);
  return Math.round((nx-t)/86400e3);
};
const fmtB = b => { if(!b) return ""; const p=b.split("-"); if(p.length<3) return ""; return new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString("en-US",{month:"long",day:"numeric"}); };

function tagPill(tag) {
  const m = TAG_META[tag] || { label:tag, bg:"var(--bg-surface-2)", col:"var(--text-secondary)" };
  return `<span class="pill" style="background:${m.bg};color:${m.col}">${m.label}</span>`;
}

// ── Firebase ops ────────────────────────────────────────────────
async function saveContact(data) {
  await dbSet(refs.contact(data.id), data);
}
async function updateContact(id, patch) {
  await dbUpdate(refs.contact(id), patch);
}
async function deleteContact(id) {
  await dbDelete(refs.contact(id));
}

// ── Quick Text ───────────────────────────────────────────────────
async function qtParse(input) {
  const { callAI } = await import("../js/ai.js");
  _state.qtLoading = true; _state.qtContact = null; _state.qtDraft = null; _state.qtError = null; _state.qtLogged = false; render();
  const contacts = _ctx.state().contacts || [];
  const names = contacts.map(c => c.fname + " " + c.lname).join(", ");
  const raw = await callAI(
    `Contacts: ${names}\n\nParse: "${input}"\n\nReturn ONLY JSON: {"fname":"","lname":"","context":"what the message is about"}\nMatch the closest contact name.`,
    { maxTokens: 80 }
  );
  if (!raw) { _state.qtLoading = false; _state.qtError = "Couldn't parse — try again."; render(); return; }
  let parsed;
  try { parsed = JSON.parse(raw.replace(/```json|```/g,"").trim()); } catch { _state.qtLoading = false; _state.qtError = "Couldn't parse — try again."; render(); return; }
  const fl = (parsed.fname||"").toLowerCase(), ll = (parsed.lname||"").toLowerCase();
  const contact = contacts.find(c => c.fname.toLowerCase()===fl && c.lname.toLowerCase()===ll)
    || contacts.find(c => c.fname.toLowerCase()===fl)
    || contacts.find(c => (c.fname+" "+c.lname).toLowerCase().includes(fl));
  if (!contact) { _state.qtLoading = false; _state.qtError = `Couldn't find "${(parsed.fname||"")} ${(parsed.lname||"")}"`; render(); return; }
  _state.qtContact = contact;
  const draft = await callAI(
    `Short casual iMessage from Michael to ${contact.fname} about: ${parsed.context||input}. Background: ${contact.note||"friend"}. Easygoing dad energy. 1-2 sentences. Just the message.`,
    { maxTokens: 120 }
  );
  if (!draft) { _state.qtLoading = false; _state.qtError = "Couldn't draft — try again."; render(); return; }
  _state.qtDraft = draft; _state.qtLoading = false; render();
}

async function qtLog() {
  const c = _state.qtContact; const draft = _state.qtDraft;
  if (!c || !draft) return;
  const contacts = _ctx.state().contacts || [];
  const fresh = contacts.find(x => x.id === c.id) || c;
  const note = { id: uid(), date: tod(), text: "Texted: " + draft };
  await updateContact(c.id, { contactNotes: [note, ...(fresh.contactNotes||[])], lastContact: tod() });
  _state.qtLogged = true; render();
}

function renderQuickTextSheet() {
  if (!_state.showQt) return "";
  const c = _state.qtContact, draft = _state.qtDraft;
  const phone = c?.phone ? String(c.phone).replace(/\D/g,"") : null;
  const smsLink = phone && draft ? `sms:+${phone}?body=${encodeURIComponent(draft)}` : null;
  return `
    <div id="qt-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:700;display:flex;align-items:flex-end;justify-content:center">
      <div style="background:var(--bg-surface);border-radius:22px 22px 0 0;padding:20px;width:100%;max-width:540px;padding-bottom:calc(20px + env(safe-area-inset-bottom))">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div style="font-size:16px;font-weight:800;color:var(--text-primary)">✦ Quick Text</div>
          <button id="qt-close" style="width:28px;height:28px;border-radius:50%;background:var(--bg-surface-2);border:none;cursor:pointer;font-size:13px">✕</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <div style="flex:1;display:flex;align-items:center;gap:8px;background:var(--bg-surface-2);border:1.5px solid var(--separator);border-radius:12px;padding:10px 12px">
            <input id="qt-input" placeholder="text Lauren, on my way home…" value="${escH(_state.qtText)}"
              style="flex:1;border:none;background:transparent;font-size:14px;color:var(--text-primary);outline:none;font-family:inherit">
            <button id="qt-mic" style="border:none;background:none;cursor:pointer;font-size:18px;color:${_state.qtListening?"#EF4444":"var(--text-secondary)"}">
              ${_state.qtListening ? "🔴" : "🎙️"}
            </button>
          </div>
          <button id="qt-go" style="padding:10px 16px;border-radius:12px;border:none;background:var(--accent);color:#000;font-weight:800;font-size:14px;cursor:pointer">
            ${_state.qtLoading ? `<div style="width:14px;height:14px;border:2px solid rgba(0,0,0,0.2);border-top-color:#000;border-radius:50%;animation:spin 0.7s linear infinite"></div>` : "Go"}
          </button>
        </div>
        ${_state.qtError ? `<div style="background:var(--color-red-bg);border:1px solid var(--color-red);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--color-red);margin-bottom:12px">⚠️ ${escH(_state.qtError)}</div>` : ""}
        ${_state.qtLoading && !c ? `<div style="display:flex;align-items:center;gap:10px;padding:14px;background:var(--bg-surface-2);border-radius:12px;font-size:13px;color:var(--text-secondary)"><div class="loader-spinner" style="width:14px;height:14px"></div>Finding contact & drafting…</div>` : ""}
        ${c && draft ? `
          <div style="background:var(--bg-surface-2);border-radius:14px;padding:14px;border:1px solid var(--separator)">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <div class="avatar" style="width:36px;height:36px;background:${c.color}22;color:${c.color};font-size:12px;font-weight:900">${ini(c)}</div>
              <div>
                <div style="font-weight:700;font-size:14px">${escH(c.fname)} ${escH(c.lname)}</div>
                ${c.phone ? `<div style="font-size:11px;color:var(--text-secondary)">${fmtPhone(c.phone)}</div>` : ""}
              </div>
            </div>
            <div style="background:var(--color-green-bg);border:1.5px solid var(--color-green);border-radius:10px;padding:10px 12px;font-size:13px;color:#166534;line-height:1.7;font-style:italic;margin-bottom:10px">${escH(draft)}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${smsLink ? `<a href="${smsLink}" onclick="setTimeout(()=>document.getElementById('qt-log')?.click(),800)" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:9px 14px;border-radius:12px;background:var(--color-green);color:#fff;font-weight:700;font-size:13px;text-decoration:none">📱 Open in Messages</a>` : ""}
              ${_state.qtLogged
                ? `<div style="flex:1;padding:9px 14px;border-radius:12px;background:var(--color-green-bg);border:1.5px solid var(--color-green);color:var(--color-green);font-weight:700;font-size:13px;text-align:center">✅ Logged</div>`
                : `<button id="qt-log" style="flex:1;padding:9px 14px;border-radius:12px;border:1.5px solid var(--separator);background:var(--bg-surface);font-weight:600;font-size:13px;cursor:pointer;color:var(--text-secondary)">📝 Log note</button>`}
              <button id="qt-retry" style="padding:9px 12px;border-radius:12px;border:1.5px solid var(--separator);background:var(--bg-surface);font-size:14px;cursor:pointer">↺</button>
            </div>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

// ── Render ──────────────────────────────────────────────────────
function render() {
  if (!_container) return;
  const contacts = _ctx.state().contacts;

  let html = `<div class="module-content" id="crm-root">`;
  html += renderTopBar(contacts);
  html += renderMainView(contacts);
  if (_state.detail) html += renderDetailPanel(_state.detail, contacts);
  if (_state.showAdd) html += renderAddModal();
  html += renderQuickTextSheet();
  // FAB — positions above bottom nav on mobile, fixed bottom-right on desktop
  html += `<button id="crm-qt-fab" style="position:fixed;bottom:calc(72px + env(safe-area-inset-bottom) + 12px);right:16px;z-index:600;width:48px;height:48px;border-radius:50%;border:none;background:var(--accent);color:#000;font-size:18px;cursor:pointer;box-shadow:0 4px 16px rgba(0,212,255,0.4);display:flex;align-items:center;justify-content:center;font-weight:900" title="Quick Text">✦</button>`;
  html += "</div>";

  _container.innerHTML = html;
  bindEvents();

  // Check for pending contact from Home module
  const pendingId = sessionStorage.getItem("crm_open_contact");
  if (pendingId) {
    sessionStorage.removeItem("crm_open_contact");
    const c = contacts.find(x => x.id === pendingId);
    if (c) { _state.detail = c; render(); }
  }
}

function renderTopBar(contacts) {
  return `
    <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4);flex-wrap:wrap;align-items:center">
      <div style="display:flex;gap:var(--space-2);flex:1">
        <button class="btn ${_state.view==="grid"?"btn-primary":"btn-secondary"} btn-sm" data-view="grid">👥 All</button>
        <button class="btn ${_state.view==="birthdays"?"btn-primary":"btn-secondary"} btn-sm" data-view="birthdays">🎂 Birthdays</button>
      </div>
      <button class="btn btn-primary btn-sm" id="add-contact-btn">+ Add</button>
    </div>
  `;
}

function renderMainView(contacts) {
  if (_state.view === "birthdays") return renderBirthdays(contacts);
  return renderGrid(contacts);
}

function renderGrid(contacts) {
  const GROUPS_LIST = GROUPS;
  let list = _state.group === "all" ? contacts : contacts.filter(c => (c.tags||[]).includes(_state.group));
  if (_state.search.trim()) {
    const q = _state.search.toLowerCase();
    list = list.filter(c => (c.fname+" "+c.lname).toLowerCase().includes(q));
  }

  let html = `
    <div style="display:flex;gap:var(--space-2);overflow-x:auto;padding-bottom:var(--space-2);margin-bottom:var(--space-3)">
      ${GROUPS_LIST.map(g => {
        const count = g.id==="all" ? contacts.length : contacts.filter(c=>(c.tags||[]).includes(g.id)).length;
        const active = _state.group === g.id;
        return `<button class="btn btn-sm ${active?"btn-primary":"btn-secondary"}" data-group="${g.id}" style="flex-shrink:0">
          ${g.icon} ${g.label} <span style="opacity:0.7">${count}</span>
        </button>`;
      }).join("")}
    </div>
    <div style="margin-bottom:var(--space-3)">
      <input class="input" id="crm-search" placeholder="🔍 Search…" value="${escH(_state.search)}" style="font-size:var(--text-sm)">
    </div>
  `;

  if (_state.group !== "all") {
    const gm = GROUPS_LIST.find(g=>g.id===_state.group) || {label:"group"};
    html += `<button class="btn btn-primary w-full" style="margin-bottom:var(--space-3)" id="group-text-btn">💬 Text all of ${gm.label}</button>`;
  }

  if (!list.length) {
    return html + `<div class="empty-state"><div class="empty-state__icon">👥</div><div class="empty-state__title">${_state.search?"No matches":"Empty here"}</div><div class="empty-state__body">Add people or change the filter.</div></div>`;
  }

  html += `<div class="card-grid">`;
  list.forEach(c => {
    const days = daysSince(c.lastContact);
    const bdDays = dbu(c.birthday);
    html += `
      <div class="card" style="cursor:pointer;position:relative;overflow:hidden" data-open-contact="${c.id}">
        <div style="height:3px;background:${c.color}"></div>
        <div style="padding:var(--space-3)">
          <div class="avatar avatar-md" style="background:${c.color}22;color:${c.color};margin-bottom:var(--space-2)">${ini(c)}</div>
          <div style="font-weight:700;font-size:var(--text-md);margin-bottom:2px">${escH(c.fname)} ${escH(c.lname)}</div>
          <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--space-2)">${c.note?escH(c.note.slice(0,40))+"…":""}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:var(--space-2)">${(c.tags||[]).slice(0,2).map(tagPill).join("")}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding-top:var(--space-2);border-top:1px solid var(--separator)">
            <span style="font-size:var(--text-xs);color:var(--text-secondary)">${days===999?"never contacted":days+"d ago"}</span>
            <button class="btn btn-sm" style="background:var(--color-green-bg);color:var(--color-green);padding:4px 8px" data-quick-contact="${c.id}">✓</button>
          </div>
          ${bdDays!==null&&bdDays<=14?`<div style="margin-top:var(--space-2);font-size:var(--text-xs);font-weight:700;color:var(--color-crm)">🎂 ${bdDays===0?"Today!":"In "+bdDays+"d"}</div>`:""}
        </div>
      </div>
    `;
  });
  html += `</div>`;
  return html;
}

function renderBirthdays(contacts) {
  const bl = contacts.filter(c=>c.birthday).map(c=>({...c,dbu:dbu(c.birthday)})).sort((a,b)=>a.dbu-b.dbu);
  if (!bl.length) return `<div class="empty-state"><div class="empty-state__icon">🎂</div><div class="empty-state__title">No birthdays tracked</div><div class="empty-state__body">Add birthdays when editing contacts.</div></div>`;
  return `<div class="card">
    ${bl.map(c => `<div class="list-row list-row--clickable" data-open-contact="${c.id}">
      <div class="avatar avatar-md" style="background:${c.color}22;color:${c.color}">${ini(c)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700">${escH(c.fname)} ${escH(c.lname)}</div>
        <div style="font-size:var(--text-sm);color:var(--text-secondary)">${fmtB(c.birthday)}</div>
      </div>
      <div style="font-weight:800;color:${c.dbu===0?"var(--color-red)":c.dbu<=7?"var(--color-orange)":"var(--color-crm)"}">
        ${c.dbu===0?"🎉 Today!":c.dbu===1?"Tomorrow":"In "+c.dbu+"d"}
      </div>
    </div>`).join("")}
  </div>`;
}

function renderDetailPanel(c, allContacts) {
  const fresh = allContacts.find(x=>x.id===c.id) || c;
  const days = daysSince(fresh.lastContact);
  const bdDays = dbu(fresh.birthday);
  const isBday = bdDays !== null && bdDays <= 14;
  const notes = fresh.contactNotes || [];
  const gifts = fresh.gifts || [];
  const smsLink = fresh.phone ? `sms:+${telDigits(fresh.phone)}` : null;

  // Group gift ideas by occasion
  const grouped = {};
  gifts.forEach(g => { grouped[g.occasion] = grouped[g.occasion]||[]; grouped[g.occasion].push(g); });

  return `
    <div class="panel-overlay" id="detail-overlay">
      <div class="panel" id="detail-panel">

        <!-- Header -->
        <div style="padding:var(--space-5);border-bottom:1px solid var(--separator)">
          <div style="display:flex;align-items:flex-start;gap:var(--space-3)">
            <div class="avatar avatar-xl" style="background:${fresh.color}22;color:${fresh.color}">${ini(fresh)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:var(--text-xl);font-weight:800">${escH(fresh.fname)} ${escH(fresh.lname)}</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:var(--space-1)">${(fresh.tags||[]).map(tagPill).join("")}</div>
            </div>
            <button id="close-detail" style="width:28px;height:28px;border-radius:50%;background:var(--bg-surface-2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px">✕</button>
          </div>
        </div>

        <!-- Body -->
        <div style="padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-4)">

          <!-- Birthday alert -->
          ${isBday ? `<div class="pill w-full" style="background:var(--color-yellow-bg);color:#92400E;font-size:var(--text-sm);justify-content:center;padding:var(--space-2)">
            🎂 ${bdDays===0?"It's their birthday TODAY! 🎉":"Birthday in "+bdDays+(bdDays===1?" day":"days")} — ${fmtB(fresh.birthday)}
          </div>` : ""}

          <!-- Info -->
          <div class="card">
            ${fresh.phone ? `<div class="list-row"><span>📞</span><span style="font-size:var(--text-sm)">${fmtPhone(fresh.phone)}</span>
              ${smsLink ? `<a href="${smsLink}" class="btn btn-sm" style="background:var(--color-green);color:#fff">Text 📱</a>` : ""}
            </div>` : ""}
            <div class="list-row"><span>📝</span><span style="font-size:var(--text-sm);flex:1">${escH(fresh.note||"No note")}</span></div>
            <div class="list-row" style="border:none"><span>⏱️</span><span style="font-size:var(--text-sm)">Last contact: <strong>${days===999?"Never":days+"d ago"}</strong></span></div>
          </div>

          <!-- Draft text -->
          <div>
            <div class="section-label">Draft a text</div>
            ${_state.draftLoading ? `
              <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3);background:var(--bg-surface-2);border-radius:var(--radius-md)">
                <div class="loader-spinner" style="width:16px;height:16px"></div>
                <span style="font-size:var(--text-sm);color:var(--text-secondary)">Thinking…</span>
              </div>
            ` : _state.draftText ? `
              <div style="background:var(--color-green-bg);border:1.5px solid var(--color-green);border-radius:var(--radius-md);padding:var(--space-3);font-size:var(--text-sm);line-height:1.7;font-style:italic;color:#166534;margin-bottom:var(--space-2)">${escH(_state.draftText)}</div>
              <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
                ${smsLink ? `<a href="${smsLink}?body=${encodeURIComponent(_state.draftText)}" class="btn btn-sm" style="background:var(--color-green);color:#fff">📱 Open Messages</a>` : ""}
                <button class="btn btn-secondary btn-sm" id="copy-draft">📋 Copy</button>
                <button class="btn btn-ghost btn-sm" id="clear-draft">↺ New</button>
              </div>
            ` : `
              <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
                <button class="btn btn-sm draft-btn" style="background:var(--color-crm);color:#fff" data-dtype="catchup">💬 Check in</button>
                <button class="btn btn-sm draft-btn" style="background:var(--accent);color:#fff" data-dtype="hangout">🍻 Hangout</button>
                ${isBday?`<button class="btn btn-sm draft-btn" style="background:var(--color-orange);color:#fff" data-dtype="birthday">🎂 Birthday</button>`:""}
                <button class="btn btn-sm draft-btn" style="background:var(--color-green);color:#fff" data-dtype="bbq">🔥 BBQ</button>
              </div>
            `}
          </div>

          <!-- Mark contacted -->
          <button class="btn btn-secondary w-full" id="mark-contacted">✓ Mark as contacted today</button>

          <!-- Notes -->
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2)">
              <div class="section-label" style="margin:0">Notes after talking</div>
              ${_state.noteAdding?"":"<button class='btn btn-ghost btn-sm' id='start-note'>+ Add</button>"}
            </div>
            ${_state.noteAdding ? `
              <div style="background:var(--bg-surface-2);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-2)">
                <textarea id="note-input" class="input" placeholder="What did you talk about?" style="min-height:80px;margin-bottom:var(--space-2)"></textarea>
                <div style="display:flex;gap:var(--space-2);justify-content:flex-end">
                  <button class="btn btn-secondary btn-sm" id="cancel-note">Cancel</button>
                  <button class="btn btn-primary btn-sm" id="save-note">Save</button>
                </div>
              </div>
            ` : ""}
            ${!notes.length && !_state.noteAdding ? `<div style="text-align:center;padding:var(--space-4);background:var(--bg-surface-2);border-radius:var(--radius-md);border:1.5px dashed var(--separator)"><div style="font-size:20px;margin-bottom:4px">📝</div><div style="font-size:var(--text-sm);color:var(--text-secondary)">No notes yet</div></div>` : ""}
            ${notes.map(n=>`<div style="background:var(--bg-surface-2);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-2)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                <span style="font-size:var(--text-xs);color:var(--text-tertiary)">${fmtD(n.date)}</span>
                <button class="btn" style="font-size:12px;color:var(--text-tertiary)" data-del-note="${n.id}">✕</button>
              </div>
              <div style="font-size:var(--text-sm);color:var(--text-primary);line-height:1.6;white-space:pre-wrap">${escH(n.text)}</div>
            </div>`).join("")}
          </div>

          <!-- Gift ideas -->
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2)">
              <div class="section-label" style="margin:0">Gift ideas 🎁</div>
              ${_state.giftAdding?"":"<button class='btn btn-ghost btn-sm' id='start-gift'>+ Add</button>"}
            </div>
            ${_state.giftAdding ? `
              <div style="background:var(--bg-surface-2);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-2)">
                <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:var(--space-2)">
                  ${OCCASIONS.map(o=>`<button class="pill" style="background:${_state.addOccasion===o?"var(--accent)":"var(--bg-surface-3)"};color:${_state.addOccasion===o?"#fff":"var(--text-secondary)"};cursor:pointer" data-occasion="${o.replace(/"/g,"&quot;")}">${o}</button>`).join("")}
                </div>
                <input id="gift-input" class="input" placeholder="e.g. Traeger cookbook, nice whiskey…" style="margin-bottom:var(--space-2)">
                <div style="display:flex;gap:var(--space-2);justify-content:space-between;align-items:center">
                  <button class="btn btn-sm" style="background:#AF52DE;color:#fff" id="gen-gifts">
                    ${_state.giftGenerating?`<span class="spinner-sm"></span> Thinking…`:"✨ AI ideas"}
                  </button>
                  <div style="display:flex;gap:var(--space-2)">
                    <button class="btn btn-secondary btn-sm" id="cancel-gift">Cancel</button>
                    <button class="btn btn-primary btn-sm" id="save-gift">Save</button>
                  </div>
                </div>
              </div>
            ` : ""}
            ${!gifts.length&&!_state.giftAdding ? `<div style="text-align:center;padding:var(--space-4);background:var(--bg-surface-2);border-radius:var(--radius-md);border:1.5px dashed var(--separator)"><div style="font-size:20px;margin-bottom:4px">🎁</div><div style="font-size:var(--text-sm);color:var(--text-secondary)">No gift ideas yet</div></div>` : ""}
            ${Object.keys(grouped).map(occ=>`
              <div style="margin-bottom:var(--space-2)">
                <div style="font-size:var(--text-xs);font-weight:700;color:var(--text-tertiary);margin-bottom:4px">${occ}</div>
                ${grouped[occ].map(g=>`<div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);border-radius:var(--radius-sm);background:${g.bought?"var(--color-green-bg)":"var(--bg-surface-2)"};border:1px solid ${g.bought?"var(--color-green)":"var(--separator)"};margin-bottom:4px">
                  <input type="checkbox" ${g.bought?"checked":""} data-tog-gift="${g.id}" style="width:15px;height:15px;cursor:pointer;accent-color:var(--color-green)">
                  <span style="flex:1;font-size:var(--text-sm);color:${g.bought?"var(--text-secondary)":"var(--text-primary)"};text-decoration:${g.bought?"line-through":"none"}">${escH(g.text)}</span>
                  <button class="btn" style="font-size:12px;color:var(--text-tertiary)" data-del-gift="${g.id}">✕</button>
                </div>`).join("")}
              </div>
            `).join("")}
          </div>

          <!-- Delete -->
          <button class="btn btn-danger btn-sm w-full" id="delete-contact">Delete contact</button>

        </div>
      </div>
    </div>
  `;
}

function renderAddModal() {
  return `
    <div class="modal-overlay" id="add-modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <h2>Add contact</h2>
          <button id="close-add" class="btn btn-ghost btn-sm">✕</button>
        </div>
        <div class="modal-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div><div class="section-label">First name</div><input id="add-fname" class="input" placeholder="John"></div>
            <div><div class="section-label">Last name</div><input id="add-lname" class="input" placeholder="Smith"></div>
          </div>
          <div><div class="section-label">Phone</div><input id="add-phone" class="input" placeholder="555-555-1234" type="tel"></div>
          <div><div class="section-label">Birthday</div><input id="add-bday" class="input" type="date"></div>
          <div><div class="section-label">How do you know them?</div><input id="add-note" class="input" placeholder="Met at BBQ, childhood friend…"></div>
          <div>
            <div class="section-label">Color</div>
            <div style="display:flex;gap:var(--space-2)">
              ${COLORS.map(c=>`<button class="btn" style="width:28px;height:28px;border-radius:50%;background:${c};border:3px solid ${_state.addColor===c?"#fff":"transparent"};outline:2px solid ${_state.addColor===c?c:"transparent"}" data-pick-color="${c}"></button>`).join("")}
            </div>
          </div>
          <div>
            <div class="section-label">Groups</div>
            <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">
              ${Object.keys(TAG_META).map(t=>{const m=TAG_META[t];const sel=_state.addTags.includes(t);return `<button class="pill" style="background:${sel?m.col:"var(--bg-surface-2)"};color:${sel?"#fff":m.col};cursor:pointer;padding:var(--space-1) var(--space-3)" data-pick-tag="${t}">${m.label}</button>`;}).join("")}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-add">Cancel</button>
          <button class="btn btn-primary" id="confirm-add">Add contact</button>
        </div>
      </div>
    </div>
  `;
}

// ── Event binding ────────────────────────────────────────────────
function bindEvents() {
  const $ = id => document.getElementById(id);
  const on = (id, ev, fn) => { const el=$(id); if(el) el.addEventListener(ev, fn); };
  const del = (sel, fn) => _container.querySelectorAll(sel).forEach(el=>el.addEventListener("click",fn));

  // View switching
  _container.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>{_state.view=btn.dataset.view;render();}));

  // Group filter
  _container.querySelectorAll("[data-group]").forEach(btn=>btn.addEventListener("click",()=>{_state.group=btn.dataset.group;render();}));

  // Search
  const searchInput = $("crm-search");
  if (searchInput) searchInput.addEventListener("input", e=>{_state.search=e.target.value;render();});

  // Add contact
  on("add-contact-btn","click",()=>{_state.showAdd=true;render();});
  on("close-add","click",()=>{_state.showAdd=false;render();});
  on("cancel-add","click",()=>{_state.showAdd=false;render();});

  // Color picker in add modal
  _container.querySelectorAll("[data-pick-color]").forEach(btn=>btn.addEventListener("click",()=>{_state.addColor=btn.dataset.pickColor;render();}));

  // Tag picker in add modal
  _container.querySelectorAll("[data-pick-tag]").forEach(btn=>btn.addEventListener("click",()=>{
    const t=btn.dataset.pickTag;
    _state.addTags=_state.addTags.includes(t)?_state.addTags.filter(x=>x!==t):[..._state.addTags,t];
    render();
  }));

  // Confirm add
  on("confirm-add","click",async()=>{
    const fname=$("add-fname")?.value?.trim()||"";
    const lname=$("add-lname")?.value?.trim()||"";
    if(!fname&&!lname){alert("Name required");return;}
    const phone=String($("add-phone")?.value||"").replace(/\D/g,"");
    let d=phone;if(d.length===10)d="1"+d;
    const c={
      id:uid()+Math.random().toString(36).slice(2,5),
      fname,lname,phone:d,
      birthday:$("add-bday")?.value||"",
      note:$("add-note")?.value?.trim()||"",
      color:_state.addColor,tags:[..._state.addTags],
      lastContact:null,contactNotes:[],gifts:[]
    };
    await saveContact(c);
    _state.showAdd=false;_state.addTags=[];render();
  });

  // Open contact
  _container.querySelectorAll("[data-open-contact]").forEach(el=>{
    el.addEventListener("click",()=>{
      const id=el.dataset.openContact;
      const c=_ctx.state().contacts.find(x=>x.id===id);
      if(c){_state.detail=c;_state.draftText=null;_state.noteAdding=false;_state.giftAdding=false;render();}
    });
  });

  // Quick mark contacted
  _container.querySelectorAll("[data-quick-contact]").forEach(btn=>{
    btn.addEventListener("click",e=>{
      e.stopPropagation();
      updateContact(btn.dataset.quickContact,{lastContact:tod()});
    });
  });

  // Close detail panel
  on("close-detail","click",()=>{_state.detail=null;render();});
  on("detail-overlay","click",e=>{if(e.target.id==="detail-overlay"){_state.detail=null;render();}});

  // Mark contacted
  on("mark-contacted","click",async()=>{
    if(_state.detail){await updateContact(_state.detail.id,{lastContact:tod()});_state.detail=null;render();}
  });

  // Draft text buttons
  _container.querySelectorAll(".draft-btn").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      if(!getApiKey()){showToast("Add your API key first");return;}
      _state.draftLoading=true;_state.draftText=null;render();
      const c=_state.detail;
      _state.draftText=await draftText(btn.dataset.dtype,c)||"Hey "+c.fname+"! Hope you're doing well — let's catch up soon.";
      _state.draftLoading=false;render();
    });
  });

  on("copy-draft","click",()=>{
    if(_state.draftText){navigator.clipboard?.writeText(_state.draftText);showToast("Copied!");}
  });
  on("clear-draft","click",()=>{_state.draftText=null;render();});

  // Notes
  on("start-note","click",()=>{_state.noteAdding=true;render();setTimeout(()=>$("note-input")?.focus(),50);});
  on("cancel-note","click",()=>{_state.noteAdding=false;render();});
  on("save-note","click",async()=>{
    const text=$("note-input")?.value?.trim();
    if(!text||!_state.detail)return;
    const c=_ctx.state().contacts.find(x=>x.id===_state.detail.id)||_state.detail;
    const note={id:uid(),date:tod(),text};
    const notes=[note,...(c.contactNotes||[])];
    await updateContact(c.id,{contactNotes:notes,lastContact:tod()});
    _state.noteAdding=false;render();
  });

  del("[data-del-note]",async e=>{
    const btn=e.currentTarget;
    if(!_state.detail)return;
    const c=_ctx.state().contacts.find(x=>x.id===_state.detail.id)||_state.detail;
    await updateContact(c.id,{contactNotes:(c.contactNotes||[]).filter(n=>n.id!==btn.dataset.delNote)});
  });

  // Gifts
  on("start-gift","click",()=>{_state.giftAdding=true;render();});
  on("cancel-gift","click",()=>{_state.giftAdding=false;render();});
  _container.querySelectorAll("[data-occasion]").forEach(btn=>btn.addEventListener("click",()=>{_state.addOccasion=btn.dataset.occasion;render();}));

  on("gen-gifts","click",async()=>{
    if(!getApiKey()){showToast("Add your API key first");return;}
    if(!_state.detail||_state.giftGenerating)return;
    _state.giftGenerating=true;render();
    const c=_ctx.state().contacts.find(x=>x.id===_state.detail.id)||_state.detail;
    const ideas=await generateGiftIdeas(c,_state.addOccasion);
    const existing=c.gifts||[];
    const newGifts=ideas.map((text,i)=>({id:uid()+i,text,occasion:_state.addOccasion,bought:false,date:tod()}));
    await updateContact(c.id,{gifts:[...existing,...newGifts]});
    _state.giftGenerating=false;_state.giftAdding=false;render();
  });

  on("save-gift","click",async()=>{
    const text=$("gift-input")?.value?.trim();
    if(!text||!_state.detail)return;
    const c=_ctx.state().contacts.find(x=>x.id===_state.detail.id)||_state.detail;
    const g={id:uid(),text,occasion:_state.addOccasion,bought:false,date:tod()};
    await updateContact(c.id,{gifts:[...(c.gifts||[]),g]});
    _state.giftAdding=false;render();
  });

  del("[data-del-gift]",async e=>{
    const btn=e.currentTarget;
    if(!_state.detail)return;
    const c=_ctx.state().contacts.find(x=>x.id===_state.detail.id)||_state.detail;
    await updateContact(c.id,{gifts:(c.gifts||[]).filter(g=>g.id!==btn.dataset.delGift)});
  });

  del("[data-tog-gift]",async e=>{
    const btn=e.currentTarget;
    if(!_state.detail)return;
    const c=_ctx.state().contacts.find(x=>x.id===_state.detail.id)||_state.detail;
    await updateContact(c.id,{gifts:(c.gifts||[]).map(g=>g.id===btn.dataset.togGift?{...g,bought:!g.bought}:g)});
  });

  // Delete contact
  on("delete-contact","click",async()=>{
    if(!_state.detail)return;
    if(!confirm("Delete "+_state.detail.fname+"? This can't be undone."))return;
    await deleteContact(_state.detail.id);
    _state.detail=null;render();
  });

  // Quick Text FAB
  on("crm-qt-fab","click",()=>{
    _state.showQt=true;_state.qtText="";_state.qtContact=null;_state.qtDraft=null;_state.qtError=null;_state.qtLogged=false;render();
    setTimeout(()=>document.getElementById("qt-input")?.focus(),80);
  });
  // Quick Text sheet events
  on("qt-close","click",()=>{_state.showQt=false;render();});
  on("qt-overlay","click",e=>{if(e.target.id==="qt-overlay"){_state.showQt=false;render();}});
  on("qt-go","click",()=>{const t=(document.getElementById("qt-input")?.value||"").trim();if(t&&!_state.qtLoading){_state.qtText=t;qtParse(t);}});
  on("qt-log","click",()=>qtLog());
  on("qt-retry","click",()=>{_state.qtContact=null;_state.qtDraft=null;_state.qtLogged=false;render();});
  const qtInput=document.getElementById("qt-input");
  if(qtInput){
    qtInput.addEventListener("input",e=>{_state.qtText=e.target.value;});
    qtInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();const t=_state.qtText.trim();if(t&&!_state.qtLoading)qtParse(t);}});
  }
  on("qt-mic","click",()=>{
    if(_state.qtListening){if(_qtRecog)_qtRecog.stop();_qtRecog=null;_state.qtListening=false;render();return;}
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){alert("Voice input not supported here.");return;}
    _qtRecog=new SR();_qtRecog.lang="en-US";_qtRecog.interimResults=false;
    _qtRecog.onresult=e=>{const t=e.results[0][0].transcript;_state.qtText=t;_state.qtListening=false;_qtRecog=null;render();qtParse(t);};
    _qtRecog.onerror=()=>{_state.qtListening=false;_qtRecog=null;render();};
    _qtRecog.onend=()=>{if(_state.qtListening){_state.qtListening=false;render();}};
    _state.qtListening=true;render();_qtRecog.start();
  });
}

function showToast(msg) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Module exports ───────────────────────────────────────────────
let _stateUnsub = null;

export async function init(container, ctx) {
  _container = container;
  _ctx = ctx;

  // Re-render on state changes
  const { subscribe } = await import("../js/state.js");
  _stateUnsub = subscribe(() => {
    if (_state.detail) {
      const fresh = ctx.state().contacts.find(x => x.id === _state.detail.id);
      if (fresh) _state.detail = fresh;
    }
    render();
  });

  // Top bar actions
  ctx.setActions(`<button class="btn btn-primary btn-sm" onclick="document.getElementById('add-contact-btn')?.click()">+ Add contact</button>`);

  render();
}

export function cleanup() {
  _stateUnsub?.();
  _stateUnsub = null;
  _container = null;
  _ctx = null;
  _state.detail = null;
  _state.showAdd = false;
  _state.draftText = null;
  _state.noteAdding = false;
  _state.giftAdding = false;
}
