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
  view: "tasks",   // "tasks" | "maintenance" | "pets" | "routines" | "rewards"
  showAdd: false,
  generating: false,
  showAddReward: false,
};

const tod = () => new Date().toISOString().slice(0, 10);
const escH = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");

// ── One-click starter pack — seeds a few sample routines + rewards so the
// tabs aren't blank on first use. Safe to click more than once (just adds
// more rows); does not touch or remove anything already there.
async function seedStarterPack() {
  const routines = [
    { title: "Make bed", area: "bedroom", assignedTo: "son", priority: "low", dueDate: "", type: "routine", recurrence: "daily", rotation: [], points: 3, done: false },
    { title: "Make bed", area: "bedroom", assignedTo: "daughter", priority: "low", dueDate: "", type: "routine", recurrence: "daily", rotation: [], points: 3, done: false },
    { title: "Feed the dogs", area: "kitchen", assignedTo: "son", priority: "medium", dueDate: "", type: "routine", recurrence: "daily", rotation: [], points: 5, done: false },
    { title: "Pack school bag for tomorrow", area: "bedroom", assignedTo: "daughter", priority: "low", dueDate: "", type: "routine", recurrence: "daily", rotation: [], points: 3, done: false },
    { title: "Take out the trash", area: "garage", assignedTo: "", priority: "medium", dueDate: "", type: "routine", recurrence: "weekly", rotation: ["son","daughter"], points: 10, done: false },
  ];
  const rewards = [
    { title: "Ice cream after dinner", emoji: "🍦", cost: 15 },
    { title: "30 extra min of screen time", emoji: "📱", cost: 20 },
    { title: "Pick the movie for movie night", emoji: "🎬", cost: 25 },
    { title: "Pick what's for dinner", emoji: "🍕", cost: 40 },
    { title: "$5 allowance cash-out", emoji: "💵", cost: 100 },
  ];
  await Promise.all([
    ...routines.map(r => { const id = uid(); return dbSet(refs.task(id), { id, ...r }); }),
    ...rewards.map(r => { const id = uid(); return dbSet(refs.reward(id), { id, ...r }); }),
  ]);
}

// Members available to assign chores to (people, not pets). Refreshed each render.
let _members = [];
const assignableMembers = () => _members.filter(m => m.role !== "pet");

// ── Recurrence helpers ────────────────────────────────────────
const RECUR_OPTIONS = [
  { value: "",        label: "None (one-time)" },
  { value: "daily",   label: "Daily" },
  { value: "weekly",  label: "Weekly" },
  { value: "biweekly",label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
];

function nextDueDate(fromDate, recurrence) {
  if (!recurrence || !fromDate) return "";
  const d = new Date(fromDate + "T12:00:00");
  if (recurrence === "daily")    d.setDate(d.getDate() + 1);
  if (recurrence === "weekly")   d.setDate(d.getDate() + 7);
  if (recurrence === "biweekly") d.setDate(d.getDate() + 14);
  if (recurrence === "monthly")  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function nextAssignee(rotation, currentId) {
  if (!Array.isArray(rotation) || rotation.length < 2) return currentId;
  const idx = rotation.indexOf(currentId);
  return rotation[(idx + 1) % rotation.length];
}

// ── Rewards: award points to a member's allowance balance on task completion ──
// Additive — uses the `allowance` field already seeded on every member doc
// (js/members.js: "chore→allowance hook (later)"). Safe no-op if no member/points.
export async function awardPoints(memberId, points) {
  if (!memberId || !points) return;
  const member = _members.find(m => m.id === memberId);
  if (!member) return;
  const current = member.allowance?.balance || 0;
  await dbUpdate(refs.memberDoc(memberId), {
    allowance: { ...(member.allowance || { rate: 0, currency: "USD" }), balance: current + points },
  });
}

// Called when a recurring task is checked off. Exported so family.js can reuse it.
// Marks it done and creates the next occurrence as a fresh task.
export async function completeRecurring(task) {
  const doneDate = tod();
  await dbUpdate(refs.task(task.id), { done: true, doneDate });
  if (task.assignedTo && task.points) await awardPoints(task.assignedTo, task.points);

  if (!task.recurrence) return;

  const base = task.dueDate || doneDate;
  const newDue = nextDueDate(base, task.recurrence);
  const rotation = Array.isArray(task.rotation) ? task.rotation : [];
  const newAssignee = rotation.length >= 2
    ? nextAssignee(rotation, task.assignedTo || rotation[0])
    : (task.assignedTo || "");

  const next = {
    id:         uid(),
    title:      task.title,
    area:       task.area       || "general",
    type:       task.type       || "task",
    priority:   task.priority   || "low",
    assignedTo: newAssignee,
    recurrence: task.recurrence,
    rotation:   rotation,
    points:     task.points     || 0,
    dueDate:    newDue,
    done:       false,
  };
  await dbSet(refs.task(next.id), next);
}

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
  const { householdTasks, members } = _ctx.state();
  _members = members || [];
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
      <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-4)">
        ${["tasks","maintenance","pets","routines","rewards"].map(v=>`
          <button class="btn btn-sm ${_localState.view===v?"btn-primary":"btn-secondary"}" data-view="${v}">
            ${{tasks:"📋 Tasks",maintenance:"🔧 Maintenance",pets:"🐾 Pets",routines:"🔄 Routines",rewards:"⭐ Rewards"}[v]}
          </button>
        `).join("")}
      </div>

      ${_localState.view === "tasks"       ? renderTasks(open, done) : ""}
      ${_localState.view === "maintenance" ? renderMaintenance(householdTasks) : ""}
      ${_localState.view === "pets"        ? renderPets() : ""}
      ${_localState.view === "routines"    ? renderRoutines(householdTasks) : ""}
      ${_localState.view === "rewards"     ? renderRewards(_ctx.state().rewards || []) : ""}

      ${_localState.showAdd ? renderAddModal() : ""}
      ${_localState.showAddReward ? renderAddRewardModal() : ""}
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
  const who  = t.assignedTo ? _members.find(m=>m.id===t.assignedTo) : null;
  const priorityStyle = t.priority==="high" ? "color:var(--color-red)" : t.priority==="medium" ? "color:var(--color-orange)" : "";
  return `
    <div class="list-row" style="${t.done?"opacity:0.5":""}">
      <input type="checkbox" ${t.done?"checked":""} data-toggle-task="${t.id}" style="width:18px;height:18px;cursor:pointer;accent-color:var(--color-green);flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:var(--text-sm);text-decoration:${t.done?"line-through":"none"};${priorityStyle}">${escH(t.title)}</div>
        <div style="display:flex;gap:var(--space-2);margin-top:2px;flex-wrap:wrap">
          ${who ? `<span class="pill" style="background:${who.color}22;color:${who.color}">${who.emoji||""} ${escH(who.name)}</span>` : ""}
          ${area ? `<span class="pill" style="background:var(--bg-surface-2)">${area.icon} ${area.label}</span>` : ""}
          ${t.dueDate ? `<span style="font-size:var(--text-xs);color:${t.dueDate<=tod()?"var(--color-red)":"var(--text-secondary)"}">📅 ${t.dueDate}</span>` : ""}
          ${t.recurrence ? `<span class="pill" style="background:rgba(0,212,255,0.08);color:var(--accent)">🔄 ${t.recurrence}</span>` : ""}
          ${t.priority==="high"?`<span class="pill" style="background:var(--color-red-bg);color:var(--color-red)">🔴 High</span>`:""}
          ${t.points ? `<span class="pill" style="background:rgba(255,204,0,0.12);color:#FFCC00">⭐ ${t.points}</span>` : ""}
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

// Real routines = household tasks with type "routine". A routine only really
// works with a recurrence set, so anything without one still shows (so it's
// not silently hidden) but is flagged as "no schedule set" instead of faked.
function renderRoutines(tasks) {
  const routines = (tasks || []).filter(t => t.type === "routine");
  const open = routines.filter(t => !t.done);
  const doneToday = routines.filter(t => t.done && t.doneDate === tod());

  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="card">
        <div class="card-header"><div class="card-title">🔄 Routines</div><button class="btn btn-primary btn-sm" id="add-routine-btn">+ Add</button></div>
        ${open.length ? open.map(r=>`
          <div class="list-row">
            <span style="font-size:20px">${AREAS.find(a=>a.id===r.area)?.icon || "🔄"}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:var(--text-sm)">${escH(r.title)}</div>
              <div style="font-size:var(--text-xs);color:var(--text-secondary)">
                ${r.recurrence ? `↻ ${r.recurrence}` : "No schedule set — edit to add a repeat"}
                ${r.points ? ` · ⭐ ${r.points}` : ""}
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" data-log-routine="${r.id}">Log ✓</button>
          </div>
        `).join("") : `
          <div class="empty-state">
            <div class="empty-state__icon">🔄</div>
            <div class="empty-state__title">No routines yet</div>
            <div class="empty-state__body">Add one with a repeat interval — e.g. "Morning walk," daily.</div>
            <button class="btn btn-secondary btn-sm" id="seed-starter-pack" style="margin-top:var(--space-3)">🌱 Add starter routines &amp; rewards</button>
          </div>
        `}
      </div>

      ${doneToday.length ? `
        <div class="section-title">Logged today</div>
        <div class="card">
          ${doneToday.map(r=>`
            <div class="list-row" style="opacity:0.6">
              <span style="font-size:18px">✅</span>
              <div style="flex:1;font-size:var(--text-sm)">${escH(r.title)}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

// ── Rewards: per-member point balances + redeemable catalog ──────────
function renderRewards(rewards) {
  const people = assignableMembers();
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">

      <div class="card">
        <div class="card-header"><div class="card-title">⭐ Points balance</div></div>
        ${people.length ? `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:var(--space-3);padding:var(--space-4)">
            ${people.map(m=>`
              <div style="text-align:center">
                <div style="font-size:32px">${m.emoji||"🙂"}</div>
                <div style="font-weight:700;font-size:var(--text-sm);margin-top:4px">${escH(m.name)}</div>
                <div style="font-weight:800;font-size:var(--text-lg);color:#FFCC00">${m.allowance?.balance||0}</div>
              </div>
            `).join("")}
          </div>
        ` : `<div class="empty-state"><div class="empty-state__body">No assignable family members found.</div></div>`}
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🎁 Reward catalog</div>
          <button class="btn btn-primary btn-sm" id="add-reward-btn">+ Add reward</button>
        </div>
        ${rewards.length ? rewards.map(r => `
          <div class="list-row">
            <span style="font-size:20px">${r.emoji||"🎁"}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:var(--text-sm)">${escH(r.title)}</div>
              <div style="font-size:var(--text-xs);color:#FFCC00;font-weight:700">⭐ ${r.cost||0}</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${people.map(m => `
                <button class="btn btn-secondary btn-sm" data-redeem-reward="${r.id}" data-redeem-member="${m.id}" title="Redeem for ${escH(m.name)}">
                  ${m.emoji||""}
                </button>
              `).join("")}
              <button class="btn" style="font-size:11px;color:var(--text-tertiary)" data-del-reward="${r.id}">✕</button>
            </div>
          </div>
        `).join("") : `
          <div class="empty-state">
            <div class="empty-state__icon">🎁</div>
            <div class="empty-state__title">No rewards yet</div>
            <div class="empty-state__body">Add something kids can redeem points for — movie night, ice cream, screen time.</div>
            <button class="btn btn-secondary btn-sm" id="seed-starter-pack" style="margin-top:var(--space-3)">🌱 Add starter routines &amp; rewards</button>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderAddRewardModal() {
  return `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header"><h2>Add reward</h2><button class="btn btn-ghost btn-sm" id="close-add-reward">✕</button></div>
        <div class="modal-body">
          <div><div class="section-label">Title</div><input id="reward-title" class="input" placeholder="Movie night, ice cream…"></div>
          <div><div class="section-label">Emoji (optional)</div><input id="reward-emoji" class="input" placeholder="🍦" maxlength="2"></div>
          <div><div class="section-label">Cost in points</div><input id="reward-cost" class="input" type="number" min="1" step="1" value="10"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-add-reward">Cancel</button>
          <button class="btn btn-primary" id="confirm-add-reward">Add</button>
        </div>
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
            <div class="section-label">Assign to</div>
            <select id="task-assignee" class="input select">
              <option value="">Anyone</option>
              ${assignableMembers().map(m=>`<option value="${m.id}">${m.emoji||""} ${escH(m.name)}</option>`).join("")}
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
            <div class="section-label">Repeats</div>
            <select id="task-recur" class="input select">
              ${RECUR_OPTIONS.map(o=>`<option value="${o.value}">${o.label}</option>`).join("")}
            </select>
          </div>
          <div id="task-rotation-wrap" style="display:none">
            <div class="section-label">Rotate between</div>
            <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)" id="task-rotation-picker">
              ${assignableMembers().map(m=>`
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:var(--text-sm)">
                  <input type="checkbox" data-rotation-member="${m.id}" style="accent-color:var(--accent)">
                  ${m.emoji||""} ${escH(m.name)}
                </label>`).join("")}
            </div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">Each completion hands the chore to the next person in order.</div>
          </div>
          <div>
            <div class="section-label">Type</div>
            <select id="task-type" class="input select">
              <option value="task">Task</option>
              <option value="maintenance">Maintenance</option>
              <option value="pet">Pet</option>
              <option value="routine">Routine</option>
            </select>
          </div>
          <div>
            <div class="section-label">⭐ Points (reward value)</div>
            <input id="task-points" class="input" type="number" min="0" step="1" value="0" placeholder="0 = no reward">
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

  on("add-task-btn","click",()=>{_localState.showAdd=true;render();setTimeout(()=>{$("task-title")?.focus();
    // Wire rotation-picker visibility after modal renders
    const recurSel=$("task-recur");
    const rotWrap=$("task-rotation-wrap");
    if(recurSel&&rotWrap){recurSel.addEventListener("change",()=>{rotWrap.style.display=recurSel.value?"block":"none";});}
  },50)});
  on("close-add-task","click",()=>{_localState.showAdd=false;render();});
  on("cancel-add-task","click",()=>{_localState.showAdd=false;render();});
  on("confirm-add-task","click",async()=>{
    const title=$("task-title")?.value?.trim();
    if(!title)return;
    const recurrence=$("task-recur")?.value||"";
    const rotation=recurrence
      ? [...(_container?.querySelectorAll("[data-rotation-member]:checked")||[])].map(el=>el.dataset.rotationMember)
      : [];
    const assignedTo=$("task-assignee")?.value||"";
    const t={
      id:uid(),title,
      area:$("task-area")?.value||"general",
      assignedTo: rotation.length>=2 ? rotation[0] : assignedTo,
      priority:$("task-priority")?.value||"low",
      dueDate:$("task-due")?.value||"",
      type:$("task-type")?.value||"task",
      recurrence,
      rotation,
      points: Math.max(0, parseInt($("task-points")?.value, 10) || 0),
      done:false,
    };
    await dbSet(refs.task(t.id),t);
    _localState.showAdd=false;render();
  });

  _container.querySelectorAll("[data-toggle-task]").forEach(cb=>{
    cb.addEventListener("change",async()=>{
      const { householdTasks } = _ctx.state();
      const task = householdTasks.find(t=>t.id===cb.dataset.toggleTask);
      if (cb.checked && task?.recurrence) {
        await completeRecurring(task);
      } else {
        await dbUpdate(refs.task(cb.dataset.toggleTask),{done:cb.checked,doneDate:cb.checked?tod():null});
        if (cb.checked && task?.assignedTo && task?.points) await awardPoints(task.assignedTo, task.points);
      }
    });
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

  on("seed-starter-pack","click",async(e)=>{
    e.target.disabled=true; e.target.textContent="Adding…";
    await seedStarterPack();
    render();
  });

  // Routines: reuse the task modal, pre-set to type "routine"
  on("add-routine-btn","click",()=>{
    _localState.showAdd=true;render();
    setTimeout(()=>{
      $("task-title")?.focus();
      const typeSel=$("task-type");
      if(typeSel) typeSel.value="routine";
      const recurSel=$("task-recur");
      const rotWrap=$("task-rotation-wrap");
      if(recurSel&&rotWrap){recurSel.addEventListener("change",()=>{rotWrap.style.display=recurSel.value?"block":"none";});}
    },50);
  });
  _container.querySelectorAll("[data-log-routine]").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      const { householdTasks } = _ctx.state();
      const task = householdTasks.find(t=>t.id===btn.dataset.logRoutine);
      if (!task) return;
      if (task.recurrence) {
        await completeRecurring(task);
      } else {
        await dbUpdate(refs.task(task.id),{done:true,doneDate:tod()});
        if (task.assignedTo && task.points) await awardPoints(task.assignedTo, task.points);
      }
    });
  });

  // Rewards catalog
  on("add-reward-btn","click",()=>{_localState.showAddReward=true;render();setTimeout(()=>$("reward-title")?.focus(),50);});
  on("close-add-reward","click",()=>{_localState.showAddReward=false;render();});
  on("cancel-add-reward","click",()=>{_localState.showAddReward=false;render();});
  on("confirm-add-reward","click",async()=>{
    const title=$("reward-title")?.value?.trim();
    if(!title)return;
    const reward={
      id:uid(),title,
      emoji:$("reward-emoji")?.value?.trim()||"🎁",
      cost:Math.max(1,parseInt($("reward-cost")?.value,10)||1),
    };
    await dbSet(refs.reward(reward.id),reward);
    _localState.showAddReward=false;render();
  });
  _container.querySelectorAll("[data-del-reward]").forEach(btn=>{
    btn.addEventListener("click",async()=>await dbDelete(refs.reward(btn.dataset.delReward)));
  });
  _container.querySelectorAll("[data-redeem-reward]").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      const { rewards } = _ctx.state();
      const reward = (rewards||[]).find(r=>r.id===btn.dataset.redeemReward);
      const member = _members.find(m=>m.id===btn.dataset.redeemMember);
      if (!reward || !member) return;
      const balance = member.allowance?.balance || 0;
      if (balance < (reward.cost||0)) { alert(`${member.name} only has ${balance} points — needs ${reward.cost}.`); return; }
      if (!confirm(`Redeem "${reward.title}" for ${member.name}? -${reward.cost} points`)) return;
      await dbUpdate(refs.memberDoc(member.id), {
        allowance: { ...(member.allowance||{rate:0,currency:"USD"}), balance: balance - (reward.cost||0) },
      });
    });
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
