/**
 * Finances Module
 * Budget tracking, bills, subscriptions, cash flow overview.
 * Manual entry + AI categorization via Claude.
 */

import { refs, dbSet, dbUpdate, dbDelete, uid } from "../js/db.js";
import { categorizeExpense } from "../js/ai.js";

let _container = null;
let _ctx = null;
let _stateUnsub = null;
let _localState = {
  view: "overview",  // "overview" | "bills" | "budget" | "subscriptions"
  showAddBill: false,
  showAddTransaction: false,
  month: new Date().toISOString().slice(0, 7), // "2026-06"
};

const tod = () => new Date().toISOString().slice(0, 10);
const escH = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
const fmt$ = n => "$" + (+n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const CATEGORIES = [
  { id:"food",          label:"🍔 Food",         color:"#FF9500" },
  { id:"transport",     label:"🚗 Transport",     color:"#007AFF" },
  { id:"home",          label:"🏠 Home",          color:"#5AC8FA" },
  { id:"health",        label:"💊 Health",        color:"#34C759" },
  { id:"entertainment", label:"🎬 Entertainment", color:"#AF52DE" },
  { id:"shopping",      label:"🛍️ Shopping",      color:"#FF2D55" },
  { id:"subscriptions", label:"📱 Subscriptions", color:"#FF6B35" },
  { id:"utilities",     label:"⚡ Utilities",     color:"#FFCC00" },
  { id:"other",         label:"📦 Other",         color:"#8E8E93" },
];

function render() {
  if (!_container || !_ctx) return;
  const { finances: transactions, bills } = _ctx.state();

  const monthTxns = transactions.filter(t => t.date?.startsWith(_localState.month));
  const totalSpent = monthTxns.reduce((s, t) => s + (+t.amount || 0), 0);

  const paidBills   = bills.filter(b => b.paid);
  const unpaidBills = bills.filter(b => !b.paid);
  const overdueBills = bills.filter(b => !b.paid && b.dueDate <= tod());
  const totalBillsDue = unpaidBills.reduce((s,b)=>s+(+b.amount||0), 0);

  // Category breakdown
  const byCategory = {};
  monthTxns.forEach(t => {
    const cat = t.category || "other";
    byCategory[cat] = (byCategory[cat]||0) + (+t.amount||0);
  });

  const [year, month] = _localState.month.split("-");
  const monthLabel = new Date(+year, +month-1, 1).toLocaleDateString("en-US",{month:"long",year:"numeric"});

  _container.innerHTML = `
    <div class="module-content">

      <!-- Month nav -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4)">
        <button class="btn btn-secondary btn-sm" id="prev-month">‹</button>
        <div style="font-weight:700">${monthLabel}</div>
        <button class="btn btn-secondary btn-sm" id="next-month">›</button>
      </div>

      <!-- View tabs -->
      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4);overflow-x:auto">
        ${["overview","bills","budget","subscriptions"].map(v=>`
          <button class="btn btn-sm ${_localState.view===v?"btn-primary":"btn-secondary"}" data-view="${v}" style="flex-shrink:0">
            ${{overview:"📊 Overview",bills:"📋 Bills",budget:"💳 Spending",subscriptions:"📱 Subscriptions"}[v]}
          </button>
        `).join("")}
      </div>

      ${_localState.view === "overview"  ? renderOverview(totalSpent, totalBillsDue, overdueBills, unpaidBills, byCategory) : ""}
      ${_localState.view === "bills"     ? renderBills(bills, overdueBills) : ""}
      ${_localState.view === "budget"    ? renderBudget(monthTxns, byCategory) : ""}
      ${_localState.view === "subscriptions" ? renderSubscriptions(bills.filter(b=>b.isSubscription)) : ""}

      ${_localState.showAddBill        ? renderAddBillModal() : ""}
      ${_localState.showAddTransaction ? renderAddTransactionModal() : ""}
    </div>
  `;

  bindEvents();
}

function renderOverview(totalSpent, totalBillsDue, overdueBills, unpaidBills, byCategory) {
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">

      <!-- Summary cards -->
      <div class="two-col">
        <div class="card">
          <div style="padding:var(--space-4)">
            <div style="font-size:var(--text-xs);color:var(--text-secondary);font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-1)">Spent this month</div>
            <div style="font-size:var(--text-3xl);font-weight:800">${fmt$(totalSpent)}</div>
          </div>
        </div>
        <div class="card" style="${overdueBills.length?"border:1.5px solid var(--color-red)":""}">
          <div style="padding:var(--space-4)">
            <div style="font-size:var(--text-xs);color:var(--text-secondary);font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-1)">Bills due</div>
            <div style="font-size:var(--text-3xl);font-weight:800;color:${overdueBills.length?"var(--color-red)":"var(--text-primary)"}">${fmt$(totalBillsDue)}</div>
            <div style="font-size:var(--text-xs);color:var(--text-secondary)">${unpaidBills.length} unpaid${overdueBills.length?` · ${overdueBills.length} overdue ⚠️`:""}</div>
          </div>
        </div>
      </div>

      <!-- Overdue bills alert -->
      ${overdueBills.length ? `
        <div class="card" style="border:1.5px solid var(--color-red)">
          <div class="card-header"><div class="card-title">⚠️ Overdue bills</div></div>
          ${overdueBills.map(b=>`<div class="list-row">
            <div style="flex:1"><div style="font-weight:700">${escH(b.name)}</div><div style="font-size:var(--text-xs);color:var(--color-red)">Due ${b.dueDate}</div></div>
            <div style="font-weight:700;color:var(--color-red)">${fmt$(b.amount)}</div>
            <button class="btn btn-sm" style="background:var(--color-green);color:#fff" data-mark-paid="${b.id}">Pay ✓</button>
          </div>`).join("")}
        </div>
      ` : ""}

      <!-- Category donut summary -->
      ${Object.keys(byCategory).length ? `
        <div class="card">
          <div class="card-header"><div class="card-title">📊 Spending by category</div></div>
          <div style="padding:var(--space-3)">
            ${Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).map(([catId, amt]) => {
              const cat = CATEGORIES.find(c=>c.id===catId) || { label:catId, color:"#8E8E93" };
              const pct = totalSpent > 0 ? Math.round(amt/totalSpent*100) : 0;
              return `
                <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3)">
                  <div style="width:80px;font-size:var(--text-xs);font-weight:700">${cat.label}</div>
                  <div style="flex:1;height:8px;background:var(--bg-surface-2);border-radius:var(--radius-full);overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:${cat.color};border-radius:var(--radius-full)"></div>
                  </div>
                  <div style="font-size:var(--text-sm);font-weight:700;min-width:60px;text-align:right">${fmt$(amt)}</div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      ` : `
        <div class="card">
          <div style="padding:var(--space-5);text-align:center;color:var(--text-secondary)">
            <div style="font-size:28px;margin-bottom:var(--space-2)">💳</div>
            <div style="font-size:var(--text-sm)">No spending tracked for ${new Date(_localState.month+"-01T12:00:00").toLocaleDateString("en-US",{month:"long"})}</div>
            <button class="btn btn-primary btn-sm" style="margin-top:var(--space-3)" id="add-txn-btn">+ Add transaction</button>
          </div>
        </div>
      `}
    </div>
  `;
}

function renderBills(bills, overdueBills) {
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="card">
        <div class="card-header">
          <div class="card-title">📋 Bills & subscriptions</div>
          <button class="btn btn-primary btn-sm" id="add-bill-btn">+ Add</button>
        </div>
        ${bills.length ? bills.sort((a,b)=>(a.dueDate||"9999")<(b.dueDate||"9999")?-1:1).map(b=>`
          <div class="list-row">
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:var(--text-sm)">${escH(b.name)}</div>
              <div style="font-size:var(--text-xs);color:${b.paid?"var(--text-tertiary)":b.dueDate<=tod()?"var(--color-red)":"var(--text-secondary)"}">
                ${b.isSubscription?"♻️ Monthly · ":""}
                Due ${b.dueDate||"—"}${b.paid?" · ✅ Paid":""}
              </div>
            </div>
            <div style="font-weight:700;font-size:var(--text-md);min-width:64px;text-align:right">${fmt$(b.amount)}</div>
            ${!b.paid ? `<button class="btn btn-sm" style="background:var(--color-green);color:#fff" data-mark-paid="${b.id}">✓</button>` : ""}
            <button class="btn" style="font-size:12px;color:var(--text-tertiary)" data-del-bill="${b.id}">✕</button>
          </div>
        `).join("") : `<div class="empty-state"><div class="empty-state__icon">📋</div><div class="empty-state__title">No bills yet</div><div class="empty-state__body">Add your recurring bills and subscriptions.</div></div>`}
      </div>
    </div>
  `;
}

function renderBudget(transactions, byCategory) {
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="card">
        <div class="card-header">
          <div class="card-title">💳 Transactions</div>
          <button class="btn btn-primary btn-sm" id="add-txn-btn">+ Add</button>
        </div>
        ${transactions.length ? [...transactions].sort((a,b)=>b.date>a.date?1:-1).map(t=>{
          const cat = CATEGORIES.find(c=>c.id===t.category) || {label:"Other",color:"#8E8E93"};
          return `<div class="list-row">
            <div style="width:8px;height:8px;border-radius:50%;background:${cat.color};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:var(--text-sm)">${escH(t.description)}</div>
              <div style="font-size:var(--text-xs);color:var(--text-secondary)">${t.date} · ${cat.label}</div>
            </div>
            <div style="font-weight:700;color:var(--color-red)">${fmt$(t.amount)}</div>
            <button class="btn" style="font-size:12px;color:var(--text-tertiary)" data-del-txn="${t.id}">✕</button>
          </div>`;
        }).join("") : `<div class="empty-state"><div class="empty-state__icon">💳</div><div class="empty-state__title">No transactions</div><div class="empty-state__body">Add spending manually or connect a bank feed.</div></div>`}
      </div>
    </div>
  `;
}

function renderSubscriptions(subs) {
  const monthlyTotal = subs.reduce((s,b)=>s+(+b.amount||0), 0);
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="card">
        <div style="padding:var(--space-4);border-bottom:1px solid var(--separator)">
          <div style="font-size:var(--text-xs);color:var(--text-secondary);font-weight:700;text-transform:uppercase">Monthly total</div>
          <div style="font-size:var(--text-3xl);font-weight:800;margin-top:var(--space-1)">${fmt$(monthlyTotal)}</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary)">${fmt$(monthlyTotal*12)} / year</div>
        </div>
        ${subs.length ? subs.map(s=>`<div class="list-row">
          <div style="flex:1"><div style="font-weight:700">${escH(s.name)}</div><div style="font-size:var(--text-xs);color:var(--text-secondary)">♻️ ${s.frequency||"Monthly"}</div></div>
          <div style="font-weight:700">${fmt$(s.amount)}/mo</div>
          <button class="btn" style="font-size:12px;color:var(--text-tertiary)" data-del-bill="${s.id}">✕</button>
        </div>`).join("") : `<div class="empty-state"><div class="empty-state__icon">📱</div><div class="empty-state__title">No subscriptions tracked</div><div class="empty-state__body">Add bills with "Subscription" enabled.</div></div>`}
        <div style="padding:var(--space-3);border-top:1px solid var(--separator)">
          <button class="btn btn-secondary btn-sm w-full" id="add-bill-btn">+ Add subscription</button>
        </div>
      </div>
    </div>
  `;
}

function renderAddBillModal() {
  return `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header"><h2>Add bill / subscription</h2><button class="btn btn-ghost btn-sm" id="close-bill-modal">✕</button></div>
        <div class="modal-body">
          <div><div class="section-label">Name</div><input id="bill-name" class="input" placeholder="Netflix, Mortgage…"></div>
          <div><div class="section-label">Amount</div><input id="bill-amount" class="input" type="number" placeholder="0.00" step="0.01"></div>
          <div><div class="section-label">Due date</div><input id="bill-due" class="input" type="date" value="${tod()}"></div>
          <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm)">
            <input type="checkbox" id="bill-sub" style="width:16px;height:16px;accent-color:var(--accent)">
            Recurring subscription
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-add-bill">Cancel</button>
          <button class="btn btn-primary" id="confirm-add-bill">Add</button>
        </div>
      </div>
    </div>
  `;
}

function renderAddTransactionModal() {
  return `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header"><h2>Add transaction</h2><button class="btn btn-ghost btn-sm" id="close-txn-modal">✕</button></div>
        <div class="modal-body">
          <div><div class="section-label">Description</div><input id="txn-desc" class="input" placeholder="Grocery run, dinner out…"></div>
          <div><div class="section-label">Amount</div><input id="txn-amount" class="input" type="number" placeholder="0.00" step="0.01"></div>
          <div><div class="section-label">Date</div><input id="txn-date" class="input" type="date" value="${tod()}"></div>
          <div>
            <div class="section-label">Category</div>
            <select id="txn-cat" class="input select">
              ${CATEGORIES.map(c=>`<option value="${c.id}">${c.label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-add-txn">Cancel</button>
          <button class="btn btn-primary" id="confirm-add-txn">Add</button>
        </div>
      </div>
    </div>
  `;
}

function bindEvents() {
  if (!_container) return;
  const $ = id => document.getElementById(id);
  const on = (id, ev, fn) => { const el=$(id); if(el) el.addEventListener(ev, fn); };

  // Month nav
  on("prev-month","click",()=>{
    const [y,m]=_localState.month.split("-");
    const d=new Date(+y,+m-2,1);
    _localState.month=d.toISOString().slice(0,7);render();
  });
  on("next-month","click",()=>{
    const [y,m]=_localState.month.split("-");
    const d=new Date(+y,+m,1);
    _localState.month=d.toISOString().slice(0,7);render();
  });

  // View tabs
  _container.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>{_localState.view=btn.dataset.view;render();}));

  // Bills
  on("add-bill-btn","click",()=>{_localState.showAddBill=true;render();setTimeout(()=>$("bill-name")?.focus(),50);});
  on("close-bill-modal","click",()=>{_localState.showAddBill=false;render();});
  on("cancel-add-bill","click",()=>{_localState.showAddBill=false;render();});
  on("confirm-add-bill","click",async()=>{
    const name=$("bill-name")?.value?.trim();
    if(!name)return;
    const b={id:uid(),name,amount:+$("bill-amount")?.value||0,dueDate:$("bill-due")?.value||"",paid:false,isSubscription:$("bill-sub")?.checked||false};
    await dbSet(refs.bill(b.id),b);
    _localState.showAddBill=false;render();
  });

  _container.querySelectorAll("[data-mark-paid]").forEach(btn=>{
    btn.addEventListener("click",async()=>{await dbUpdate(refs.bill(btn.dataset.markPaid),{paid:true,paidDate:tod()});});
  });
  _container.querySelectorAll("[data-del-bill]").forEach(btn=>{
    btn.addEventListener("click",async()=>{await dbDelete(refs.bill(btn.dataset.delBill));});
  });

  // Transactions
  on("add-txn-btn","click",()=>{_localState.showAddTransaction=true;render();setTimeout(()=>$("txn-desc")?.focus(),50);});
  on("close-txn-modal","click",()=>{_localState.showAddTransaction=false;render();});
  on("cancel-add-txn","click",()=>{_localState.showAddTransaction=false;render();});
  on("confirm-add-txn","click",async()=>{
    const description=$("txn-desc")?.value?.trim();
    if(!description)return;
    let category=$("txn-cat")?.value||"other";
    const t={id:uid(),description,amount:+$("txn-amount")?.value||0,date:$("txn-date")?.value||tod(),category};
    await dbSet(refs.finance(t.id),t);
    _localState.showAddTransaction=false;render();
  });
  _container.querySelectorAll("[data-del-txn]").forEach(btn=>{
    btn.addEventListener("click",async()=>{await dbDelete(refs.finance(btn.dataset.delTxn));});
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
