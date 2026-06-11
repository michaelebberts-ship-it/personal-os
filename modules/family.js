/**
 * Family OS Module
 * Wife, 13-yr-old son, 8-yr-old daughter, 2 golden retrievers.
 * Schedule, responsibilities, notes, sports calendars.
 */

import { refs, dbSet, dbUpdate, dbDelete, uid } from "../js/db.js";

let _container = null;
let _ctx = null;
let _stateUnsub = null;
let _localState = {
  view: "members",   // "members" | "schedule" | "shared"
  editMemberId: null,
  showAddMember: false,
  showAddSchedule: false,
};

const tod = () => new Date().toISOString().slice(0, 10);
const escH = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");

// Pre-seeded family (loads from DB; shown as defaults on first run)
const DEFAULT_MEMBERS = [
  { id:"wife",    name:"Wife",         emoji:"👩", role:"Partner",       color:"#FF2D55", note:"" },
  { id:"son",     name:"Son",          emoji:"👦", role:"13 yrs · 8th grade", color:"#007AFF", note:"" },
  { id:"daughter",name:"Daughter",     emoji:"👧", role:"8 yrs · 3rd grade",  color:"#AF52DE", note:"" },
  { id:"dog1",    name:"Golden #1",    emoji:"🦮", role:"Golden retriever",    color:"#FF9500", note:"" },
  { id:"dog2",    name:"Golden #2",    emoji:"🦮", role:"Golden retriever",    color:"#FFCC00", note:"" },
];

const ACTIVITY_TYPES = ["⚽ Sports","🎵 Music","🎨 Art","📚 Tutoring","🏥 Doctor","✈️ Travel","🎉 Birthday","📅 Other"];

function render() {
  if (!_container || !_ctx) return;
  const { familyMembers, events } = _ctx.state();

  // Use DB members if seeded, else show defaults
  const members = familyMembers.length ? familyMembers : DEFAULT_MEMBERS;
  const familyEvents = events.filter(e => e.isFamilyEvent);
  const todayEvents  = familyEvents.filter(e => e.date === tod());

  _container.innerHTML = `
    <div class="module-content">

      <!-- Today banner -->
      ${todayEvents.length ? `
        <div class="card" style="background:var(--accent);color:#fff;margin-bottom:var(--space-4)">
          <div style="padding:var(--space-4)">
            <div style="font-weight:700;margin-bottom:var(--space-2)">📅 Today for the family</div>
            ${todayEvents.map(e=>`<div style="font-size:var(--text-sm);opacity:0.9">• ${escH(e.title)}${e.time?" at "+e.time:""}</div>`).join("")}
          </div>
        </div>
      ` : ""}

      <!-- Tabs -->
      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4);overflow-x:auto">
        ${["members","schedule","shared"].map(v=>`
          <button class="btn btn-sm ${_localState.view===v?"btn-primary":"btn-secondary"}" data-view="${v}" style="flex-shrink:0">
            ${{members:"👨‍👩‍👧‍👦 Members",schedule:"📅 Schedule",shared:"📋 Shared"}[v]}
          </button>
        `).join("")}
      </div>

      ${_localState.view === "members"  ? renderMembers(members) : ""}
      ${_localState.view === "schedule" ? renderSchedule(familyEvents) : ""}
      ${_localState.view === "shared"   ? renderShared() : ""}

      ${_localState.showAddSchedule ? renderAddScheduleModal() : ""}
    </div>
  `;

  bindEvents();
}

function renderMembers(members) {
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-3)">
      ${members.map(m => `
        <div class="card">
          <div style="padding:var(--space-4);display:flex;align-items:center;gap:var(--space-3)">
            <div style="font-size:36px">${m.emoji}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:var(--text-lg);font-weight:700">${escH(m.name)}</div>
              <div style="font-size:var(--text-sm);color:var(--text-secondary)">${escH(m.role||"")}</div>
              ${m.note ? `<div style="font-size:var(--text-sm);color:var(--text-secondary);margin-top:4px">${escH(m.note)}</div>` : ""}
            </div>
            <div style="display:flex;flex-direction:column;gap:var(--space-2)">
              ${m.id==="son"||m.id==="daughter" ? `
                <button class="btn btn-secondary btn-sm" data-view="schedule">📅 Schedule</button>
              ` : ""}
              ${(m.id==="wife") ? `
                <a href="sms:" class="btn btn-secondary btn-sm">💬 Text</a>
              ` : ""}
            </div>
          </div>
          ${(m.id==="son"||m.id==="daughter") ? renderKidStats(m) : ""}
        </div>
      `).join("")}

      <!-- Add custom member -->
      <button class="btn btn-secondary w-full" id="add-member-btn">+ Add family member</button>
    </div>
  `;
}

function renderKidStats(m) {
  const isOlder = m.id === "son";
  const items = isOlder
    ? ["🏈 Football", "🎮 Gaming", "🎓 8th Grade"]
    : ["⚽ Soccer", "🎨 Art", "📚 3rd Grade"];
  return `
    <div style="padding:0 var(--space-4) var(--space-3);display:flex;gap:var(--space-2);flex-wrap:wrap">
      ${items.map(i=>`<span class="pill" style="background:var(--bg-surface-2)">${i}</span>`).join("")}
    </div>
  `;
}

function renderSchedule(familyEvents) {
  const upcoming = familyEvents
    .filter(e => e.date >= tod())
    .sort((a,b) => a.date < b.date ? -1 : 1)
    .slice(0, 20);

  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="card">
        <div class="card-header">
          <div class="card-title">📅 Family schedule</div>
          <button class="btn btn-primary btn-sm" id="add-schedule-btn">+ Add</button>
        </div>
        ${upcoming.length ? upcoming.map(e => {
          const isToday = e.date === tod();
          return `<div class="list-row">
            <div style="width:4px;height:100%;min-height:36px;border-radius:2px;background:${e.color||"var(--accent)"};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:var(--text-sm)">${escH(e.title)}</div>
              <div style="font-size:var(--text-xs);color:var(--text-secondary)">
                ${isToday?"Today":""}${e.date}${e.time?" · "+e.time:""}
                ${e.who?" · "+e.who:""}
              </div>
            </div>
            ${isToday?`<span class="pill" style="background:var(--accent);color:#fff">Today</span>`:""}
            <button class="btn" style="font-size:12px;color:var(--text-tertiary)" data-del-fam-event="${e.id}">✕</button>
          </div>`;
        }).join("") : `
          <div class="empty-state">
            <div class="empty-state__icon">📅</div>
            <div class="empty-state__title">No upcoming events</div>
            <div class="empty-state__body">Add sports, school events, activities.</div>
          </div>
        `}
      </div>

      <!-- Sports schedules hint -->
      <div class="card" style="border:1.5px solid var(--color-orange)">
        <div style="padding:var(--space-4)">
          <div style="font-weight:700;margin-bottom:var(--space-2)">⚽ Import sports schedules</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.6">
            Most youth sports leagues publish calendar files (.ics). You can import them into Apple Calendar, then use the Shortcuts sync to push them here automatically.
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderShared() {
  const SHARED_ITEMS = [
    { label:"Grocery list", icon:"🛒", href:"#" },
    { label:"Dinner ideas", icon:"🍽️", href:"#" },
    { label:"Weekend plans", icon:"🎉", href:"#" },
    { label:"Budget notes", icon:"💰", href:"#" },
    { label:"House rules", icon:"📋", href:"#" },
  ];
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">

      <!-- Shared quick actions -->
      <div class="card">
        <div class="card-header"><div class="card-title">📋 Shared items</div></div>
        ${SHARED_ITEMS.map(item=>`<div class="list-row list-row--clickable">
          <span style="font-size:20px">${item.icon}</span>
          <div style="flex:1;font-weight:600;font-size:var(--text-sm)">${item.label}</div>
          <span style="color:var(--text-tertiary)">›</span>
        </div>`).join("")}
      </div>

      <!-- Family notes -->
      <div class="card">
        <div class="card-header"><div class="card-title">📝 Family notes</div></div>
        <div style="padding:var(--space-4)">
          <textarea class="input" placeholder="Shared notes, reminders, grocery list…" style="min-height:120px"></textarea>
        </div>
      </div>

      <!-- Chore chart -->
      <div class="card">
        <div class="card-header"><div class="card-title">🧹 Chore chart</div></div>
        ${[
          { who:"Son (13)", chores:["Take out trash","Walk dogs","Dishes"] },
          { who:"Daughter (8)", chores:["Feed dogs","Make bed","Clean room"] },
        ].map(row=>`<div class="list-row" style="align-items:flex-start">
          <div style="min-width:100px;font-weight:700;font-size:var(--text-sm)">${row.who}</div>
          <div style="flex:1;display:flex;flex-wrap:wrap;gap:var(--space-2)">
            ${row.chores.map(c=>`<span class="pill" style="background:var(--bg-surface-2)">${c}</span>`).join("")}
          </div>
        </div>`).join("")}
      </div>
    </div>
  `;
}

function renderAddScheduleModal() {
  return `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header"><h2>Add family event</h2><button class="btn btn-ghost btn-sm" id="close-schedule-modal">✕</button></div>
        <div class="modal-body">
          <div><div class="section-label">Title</div><input id="fam-title" class="input" placeholder="Soccer game, dentist…"></div>
          <div><div class="section-label">Date</div><input id="fam-date" class="input" type="date" value="${tod()}"></div>
          <div><div class="section-label">Time</div><input id="fam-time" class="input" type="time"></div>
          <div>
            <div class="section-label">Who</div>
            <select id="fam-who" class="input select">
              <option value="Everyone">Everyone</option>
              <option value="Son">Son</option>
              <option value="Daughter">Daughter</option>
              <option value="Wife">Wife</option>
              <option value="Dogs">Dogs</option>
            </select>
          </div>
          <div>
            <div class="section-label">Type</div>
            <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)" id="activity-type-picker">
              ${ACTIVITY_TYPES.map(t=>`<button class="pill" data-act-type="${t}" style="background:var(--bg-surface-2);cursor:pointer">${t}</button>`).join("")}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-add-schedule">Cancel</button>
          <button class="btn btn-primary" id="confirm-add-schedule">Add</button>
        </div>
      </div>
    </div>
  `;
}

let _pickedType = "📅 Other";

function bindEvents() {
  if (!_container) return;
  const $ = id => document.getElementById(id);
  const on = (id, ev, fn) => { const el=$(id); if(el) el.addEventListener(ev, fn); };

  _container.querySelectorAll("[data-view]").forEach(btn=>{
    btn.addEventListener("click",()=>{_localState.view=btn.dataset.view;render();});
  });

  on("add-schedule-btn","click",()=>{_localState.showAddSchedule=true;render();setTimeout(()=>$("fam-title")?.focus(),50);});
  on("close-schedule-modal","click",()=>{_localState.showAddSchedule=false;render();});
  on("cancel-add-schedule","click",()=>{_localState.showAddSchedule=false;render();});

  _container.querySelectorAll("[data-act-type]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      _pickedType=btn.dataset.actType;
      _container.querySelectorAll("[data-act-type]").forEach(b=>{b.style.background="var(--bg-surface-2)";b.style.color="var(--text-primary)";});
      btn.style.background="var(--accent)";btn.style.color="#fff";
    });
  });

  on("confirm-add-schedule","click",async()=>{
    const title=$("fam-title")?.value?.trim();
    if(!title)return;
    const e={id:uid(),title,date:$("fam-date")?.value||tod(),time:$("fam-time")?.value||"",who:$("fam-who")?.value||"Everyone",type:_pickedType,isFamilyEvent:true,color:"var(--accent)"};
    await dbSet(refs.event(e.id),e);
    _localState.showAddSchedule=false;render();
  });

  _container.querySelectorAll("[data-del-fam-event]").forEach(btn=>{
    btn.addEventListener("click",async()=>await dbDelete(refs.event(btn.dataset.delFamEvent)));
  });
}

export async function init(container, ctx) {
  _container = container;
  _ctx = ctx;
  const { subscribe } = await import("../js/state.js");
  _stateUnsub = subscribe(() => render());
  render();
}

export function cleanup() {
  _stateUnsub?.();
  _stateUnsub = null;
  _container = null;
  _ctx = null;
}
