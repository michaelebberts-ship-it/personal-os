/**
 * Household Module
 * Home maintenance, chores, routines, pets, kids' sports schedules.
 */

import { refs, dbSet, dbUpdate, dbDelete, uid } from "../js/db.js";
import { suggestMaintenanceTasks } from "../js/ai.js";

let _container = null;
let _ctx = null;
let _stateUnsub = null;
let _localState = {
  view: "tasks",   // "tasks" | "maintenance" | "pets" | "routines"
  showAdd: false,
  generating: false,
};

const tod = () => new Date().toISOString().slice(0, 10);
const escH = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");

const AREAS = [
  { id:"kitchen",  label:"Kitchen",  icon:"🍳" },
  { id:"yard",     label:"Yard",     icon:"🌿" },
  { id:"garage",   label:"Garage",   icon:"🚗" },
  { id:"bedroom",  label:"Bedroom",  icon:"🛏️" },
  { id:"bathroom", label:"Bathroom", icon:"🚿" },
  { id:"basement", label:"Basement", icon:"📦" },
  { id:"general",  label:"General",  icon:"🏠" },
];

function render() {
  if (!_container || !_ctx) return;
  const { householdTasks } = _ctx.state();
  const open   = householdTasks.filter(t => !t.done);
  const done   = householdTasks.filter(t => t.done);
  const urgent = open.filter(t => t.priority === "high" || (t.dueDate && t.dueDate <= tod()));

  _container.innerHTML = `
    <div class="module-content">

      <!-- Stats -->
      <div class="stat-grid" style="margin-bottom:var(--space-4)">
        <div class="stat-card">
          <div class="stat-card__icon">📋</div>
          <div class="stat-card__value">${open.length}</div>
          <div class="stat-card__label">Open tasks</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon">🚨</div>
          <div class="stat-card__value" style="color:${urgent.length?"var(--color-red)":"var(--text-primary)"}">${urgent.length}</div>
          <div class="stat-card__label">Urgent</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon">✅</div>
          <div class="stat-card__value">${done.length}</div>
          <div class="stat-card__label">Done</div>
        </div>
      </div>

      <!-- View tabs -->
      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4);overflow-x:auto">
        ${["tasks","maintenance","pets","routines"].map(v=>`
          <button class="btn btn-sm ${_localState.view===v?"btn-primary":"btn-secondary"}" data-view="${v}" style="flex-shrink:0">
            ${{tasks:"📋 Tasks",maintenance:"🔧 Maintenance",pets:"🐾 Pets",routines:"🔄 Routines"}[v]}
          </button>
        `).join("")}
      </div>

      ${_localState.view === "tasks"       ? renderTasks(open, done) : ""}
      ${_localState.view === "maintenance" ? renderMaintenance(householdTasks) : ""}
      ${_localState.view === "pets"        ? renderPets() : ""}
      ${_localState.view === "routines"    ? renderRoutines() : ""}

      ${_localState.showAdd ? renderAddModal() : ""}
    </div>
  `;

  bindEvents();
}

function renderTasks(open, done) {
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="card">
        <div class="card-header">
          <div class="card-title">📋 Tasks</div>
          <button class="btn btn-primary btn-sm" id="add-task-btn">+ Add</button>
        </div>
        ${open.length ? open.sort((a,b)=>{
          const pa=a.priority==="high"?0:a.priority==="medium"?1:2;
          const pb=b.priority==="high"?0:b.priority==="medium"?1:2;
          return pa-pb;
        }).map(t => renderTaskRow(t)).join("") : `
          <div class="empty-state">
            <div class="empty-state__icon">🎉</div>
            <div class="empty-state__title">All clear!</div>
            <div class="empty-state__body">No open tasks. Enjoy the downtime.</div>
          </div>
        `}
      </div>

      ${done.length ? `
        <details>
          <summary style="font-size:var(--text-sm);font-weight:600;cursor:pointer;color:var(--text-secondary);margin-bottom:var(--space-2)">
            ✅ Completed (${done.length})
          </summary>
          <div class="card">
            ${done.slice(0,10).map(t=>renderTaskRow(t)).join("")}
          </div>
        </details>
      ` : ""}
    </div>
  `;
}

function renderTaskRow(t) {
  const area = AREAS.find(a=>a.id===t.area);
  const priorityStyle = t.priority==="high" ? "color:var(--color-red)" : t.priority==="medium" ? "color:var(--color-orange)" : "";
  return `
    <div class="list-row" style="${t.done?"opacity:0.5":""}">
      <input type="checkbox" ${t.done?"checked":""} data-toggle-task="${t.id}" style="width:18px;height:18px;cursor:pointer;accent-color:var(--color-green);flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:var(--text-sm);text-decoration:${t.done?"line-through":"none"};${priorityStyle}">${escH(t.title)}</div>
        <div style="display:flex;gap:var(--space-2);margin-top:2px;flex-wrap:wrap">
          ${area ? `<span class="pill" style="background:var(--bg-surface-2)">${area.icon} ${area.label}</span>` : ""}
          ${t.dueDate ? `<span style="font-size:var(--text-xs);color:${t.dueDate<=tod()?"var(--color-red)":"var(--text-secondary)"}">📅 ${t.dueDate}</span>` : ""}
          ${t.priority==="high"?`<span class="pill" style="background:var(--color-red-bg);color:var(--color-red)">🔴 High</span>`:""}
        </div>
      </div>
      <button class="btn" style="font-size:12px;color:var(--text-tertiary)" data-del-task="${t.id}">✕</button>
    </div>
  `;
}

function renderMaintenance(tasks) {
  const maint = tasks.filter(t => t.type === "maintenance");
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">

      <!-- AI suggestions -->
      <div class="card" style="border:1.5px solid var(--accent)">
        <div style="padding:var(--space-4)">
          <div style="font-weight:700;margin-bottom:var(--space-2)">✨ Seasonal suggestions</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-3)">
            Get AI-powered maintenance recommendations for ${new Date().toLocaleDateString("en-US",{month:"long"})}.
          </div>
          <button class="btn btn-primary btn-sm" id="gen-maint-btn">
            ${_localState.generating ? `<span class="spinner-sm"></span> Generating…` : "✨ Get suggestions"}
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🔧 Maintenance log</div>
          <button class="btn btn-primary btn-sm" id="add-task-btn">+ Add</button>
        </div>
        ${maint.length ? maint.map(t=>renderTaskRow(t)).join("") : `
          <div class="empty-state">
            <div class="empty-state__icon">🔧</div>
            <div class="empty-state__title">No maintenance tasks</div>
            <div class="empty-state__body">Track repairs, inspections, and home projects.</div>
          </div>
        `}
      </div>

      <!-- Maintenance checklist by area -->
      <div class="section-title">Areas</div>
      <div class="card">
        ${AREAS.map(a=>{
          const areaCount = tasks.filter(t=>t.area===a.id&&!t.done).length;
          return `<div class="list-row"><span style="font-size:18px">${a.icon}</span><div style="flex:1;font-weight:600">${a.label}</div>${areaCount?`<span class="badge">${areaCount}</span>`:""}`;
        }).join("")}
      </div>
    </div>
  `;
}

function renderPets() {
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="card">
        <div class="card-header"><div class="card-title">🐾 Golden retrievers</div></div>
        <div style="display:flex;gap:var(--space-4);padding:var(--space-4)">
          ${[{name:"Dog 1",emoji:"🦮"},{name:"Dog 2",emoji:"🦮"}].map(dog=>`
            <div style="flex:1;text-align:center">
              <div style="font-size:40px;margin-bottom:var(--space-2)">${dog.emoji}</div>
              <div style="font-weight:700">${dog.name}</div>
              <button class="btn btn-secondary btn-sm" style="margin-top:var(--space-2)">Edit</button>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">📋 Pet tasks</div><button class="btn btn-primary btn-sm" id="add-task-btn">+ Add</button></div>
        <div style="padding:var(--space-4);text-align:center;color:var(--text-secondary);font-size:var(--text-sm)">
          Track vet appointments, grooming, medication, food orders.<br>
          Click "+ Add" to log a pet task.
        </div>
      </div>

      <!-- Quick log items -->
      <div class="section-title">Quick log</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        ${["💊 Medication","🩺 Vet visit","✂️ Grooming","🥣 Food order"].map(item=>`
          <button class="btn btn-secondary" style="height:56px;font-size:var(--text-sm)" id="add-task-btn">${item}</button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderRoutines() {
  const ROUTINES = [
    { title:"Morning walk", schedule:"Daily · 7am", emoji:"🌅", area:"yard" },
    { title:"HVAC filter check", schedule:"Monthly", emoji:"🌬️", area:"general" },
    { title:"Lawn mowing", schedule:"Weekly", emoji:"🌿", area:"yard" },
    { title:"Deep clean", schedule:"Monthly", emoji:"🧹", area:"general" },
  ];
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="card">
        <div class="card-header"><div class="card-title">🔄 Routines</div><button class="btn btn-primary btn-sm" id="add-task-btn">+ Add</button></div>
        ${ROUTINES.map(r=>`
          <div class="list-row">
            <span style="font-size:20px">${r.emoji}</span>
            <div style="flex:1">
              <div style="font-weight:600;font-size:var(--text-sm)">${r.title}</div>
              <div style="font-size:var(--text-xs);color:var(--text-secondary)">${r.schedule}</div>
            </div>
            <button class="btn btn-secondary btn-sm">Log ✓</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderAddModal() {
  return `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header"><h2>Add task</h2><button class="btn btn-ghost btn-sm" id="close-add-task">✕</button></div>
        <div class="modal-body">
          <div><div class="section-label">Title</div><input id="task-title" class="input" placeholder="Fix leaky faucet…"></div>
          <div>
            <div class="section-label">Area</div>
            <select id="task-area" class="input select">
              ${AREAS.map(a=>`<option value="${a.id}">${a.icon} ${a.label}</option>`).join("")}
            </select>
          </div>
          <div>
            <div class="section-label">Priority</div>
            <select id="task-priority" class="input select">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">🔴 High</option>
            </select>
          </div>
          <div><div class="section-label">Due date</div><input id="task-due" class="input" type="date"></div>
          <div>
            <div class="section-label">Type</div>
            <select id="task-type" class="input select">
              <option value="task">Task</option>
              <option value="maintenance">Maintenance</option>
              <option value="pet">Pet</option>
              <option value="routine">Routine</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-add-task">Cancel</button>
          <button class="btn btn-primary" id="confirm-add-task">Add</button>
        </div>
      </div>
    </div>
  `;
}

function bindEvents() {
  if (!_container) return;
  const $ = id => document.getElementById(id);
  const on = (id, ev, fn) => { const el=$(id); if(el) el.addEventListener(ev, fn); };

  _container.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>{_localState.view=btn.dataset.view;render();}));

  on("add-task-btn","click",()=>{_localState.showAdd=true;render();setTimeout(()=>$("task-title")?.focus(),50);});
  on("close-add-task","click",()=>{_localState.showAdd=false;render();});
  on("cancel-add-task","click",()=>{_localState.showAdd=false;render();});
  on("confirm-add-task","click",async()=>{
    const title=$("task-title")?.value?.trim();
    if(!title)return;
    const t={id:uid(),title,area:$("task-area")?.value||"general",priority:$("task-priority")?.value||"low",dueDate:$("task-due")?.value||"",type:$("task-type")?.value||"task",done:false};
    await dbSet(refs.task(t.id),t);
    _localState.showAdd=false;render();
  });

  _container.querySelectorAll("[data-toggle-task]").forEach(cb=>{
    cb.addEventListener("change",async()=>await dbUpdate(refs.task(cb.dataset.toggleTask),{done:cb.checked,doneDate:cb.checked?tod():null}));
  });
  _container.querySelectorAll("[data-del-task]").forEach(btn=>{
    btn.addEventListener("click",async()=>await dbDelete(refs.task(btn.dataset.delTask)));
  });

  on("gen-maint-btn","click",async()=>{
    if(_localState.generating)return;
    _localState.generating=true;render();
    const suggestions=await suggestMaintenanceTasks({month:new Date().toLocaleDateString("en-US",{month:"long"})});
    await Promise.all(suggestions.map(s=>dbSet(refs.task(uid()),{title:s,area:"general",priority:"medium",type:"maintenance",done:false,dueDate:""})));
    _localState.generating=false;render();
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
