import { MODULES } from "./config.js";
import { refs, subscribe as dbSubscribe, subscribeDoc, uid } from "./db.js";
import { setState, getState, subscribe as onState } from "./state.js";
import { navigate, onModuleChange, initRouter, getCurrentModule, getModuleMeta, getVisibleModules } from "./router.js";
import { initGlobalAI } from "./global-ai.js";
import { seedMembersIfEmpty } from "./members.js";
import { initProfileSwitcher, canEdit } from "./identity.js";

// Version stamp — busts ES module cache on every page load
const _V = Date.now();

// Bottom nav: pinned tabs on mobile (everything else goes in "More")
const MOBILE_PINNED = ['home', 'calendar', 'reminders', 'transformation'];
let _moreOpen = false;

// ── DOM refs ──────────────────────────────────────────────────
const navList       = document.getElementById("nav-list");
const bottomNavList = document.getElementById("bottom-nav-list");
const moduleView    = document.getElementById("module-view");
const pageHeading   = document.getElementById("page-heading");
const topbarActions = document.getElementById("topbar-actions");
const liveClock     = document.getElementById("live-clock");
const msDate        = document.getElementById("ms-date");
const syncDot       = document.getElementById("sync-dot");
const topBar        = document.getElementById("top-bar");

// Theme: Light & Calm supports both light and dark, persisted in localStorage
(function initTheme() {
  const saved = localStorage.getItem('lc-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', saved === 'dark' ? '#0f1311' : '#eef1ec');
})();

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('lc-theme', next);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', next === 'dark' ? '#0f1311' : '#eef1ec');
});

// ── Clock + date ───────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  if (liveClock) liveClock.textContent = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (msDate) msDate.innerHTML =
    now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
setInterval(updateClock, 1000);
updateClock();

// ── Nav rendering ─────────────────────────────────────────────
function buildNav() {
  const modules = getVisibleModules();
  const current = getCurrentModule();

  // Desktop sidebar (icon-only, 64px)
  navList.innerHTML = modules.map(m => `
    <li>
      <button
        class="nav-item ${m.id === current ? "nav-item--active" : ""}"
        data-module="${m.id}"
        aria-current="${m.id === current ? "page" : "false"}"
        title="${m.name} — ${m.desc}"
      >
        <span class="nav-item__icon">${m.icon}</span>
        <span class="nav-item__label">${m.shortName || m.name.slice(0, 5)}</span>
      </button>
    </li>
  `).join("");

  // Mobile bottom nav — 4 pinned tabs + "More" sheet
  const pinned   = modules.filter(m => MOBILE_PINNED.includes(m.id));
  const overflow = modules.filter(m => !MOBILE_PINNED.includes(m.id));
  const overflowActive = overflow.some(m => m.id === current);

  bottomNavList.innerHTML = pinned.map(m => `
    <li>
      <button class="bottom-item ${m.id === current ? "bottom-item--active" : ""}" data-module="${m.id}">
        <span class="bottom-item__icon">${m.icon}</span>
        <span class="bottom-item__label">${m.shortName || m.name}</span>
      </button>
    </li>
  `).join("") + `
    <li>
      <button class="bottom-item ${overflowActive ? "bottom-item--active" : ""}" id="more-btn">
        <span class="bottom-item__icon" style="font-size:18px;font-weight:700;letter-spacing:1px">···</span>
        <span class="bottom-item__label">More</span>
      </button>
    </li>`;

  bottomNavList.onclick = e => {
    const btn = e.target.closest("[data-module]");
    if (btn) { closeMoreSheet(); navigate(btn.dataset.module); return; }
    if (e.target.closest("#more-btn")) toggleMoreSheet(overflow, current);
  };

  navList.onclick = e => {
    const btn = e.target.closest("[data-module]");
    if (btn) navigate(btn.dataset.module);
  };

  // Keep More sheet grid in sync if open
  if (_moreOpen) updateMoreSheet(overflow, current);
}

// ── More sheet (mobile overflow nav) ──────────────────────────
function ensureMoreSheet() {
  if (document.getElementById('more-sheet')) return;

  // Inject styles directly so they aren't subject to CSS file caching
  if (!document.getElementById('more-sheet-styles')) {
    const style = document.createElement('style');
    style.id = 'more-sheet-styles';
    style.textContent = `
      #more-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;opacity:0;transition:opacity .25s ease}
      #more-overlay.is-open{display:block;opacity:1}
      #more-sheet{position:fixed;bottom:0;left:0;right:0;background:var(--bg-elevated);border-radius:20px 20px 0 0;padding:12px 20px calc(env(safe-area-inset-bottom,0px) + 28px);z-index:201;transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1)}
      #more-sheet.is-open{transform:translateY(0)}
      .more-handle{width:36px;height:4px;background:var(--separator);border-radius:2px;margin:0 auto 20px}
      .more-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
      .more-item{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px 12px;background:var(--bg-surface-2);border-radius:14px;border:none;cursor:pointer;font-family:var(--font-sans);transition:background .15s ease}
      .more-item--active{background:var(--accent-light)}
      .more-item__icon{font-size:28px;line-height:1;display:flex;align-items:center;justify-content:center}
      .more-item__label{font-size:11px;font-weight:600;color:var(--text-secondary);white-space:nowrap}
      .more-item--active .more-item__label{color:var(--accent)}
      .ms-household-btn{background:var(--bg-surface-2);border:1px solid var(--separator);border-radius:999px;padding:4px 10px;font-size:16px;cursor:pointer;line-height:1;display:none;align-items:center}
      @media(max-width:768px){.ms-household-btn{display:flex}}
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.id = 'more-overlay';
  overlay.addEventListener('click', closeMoreSheet);

  const sheet = document.createElement('div');
  sheet.id = 'more-sheet';
  sheet.innerHTML = `
    <div class="more-handle"></div>
    <div class="more-grid" id="more-grid"></div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);

  document.getElementById('more-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-module]');
    if (btn) { closeMoreSheet(); navigate(btn.dataset.module); }
  });
}

function updateMoreSheet(overflow, current) {
  const grid = document.getElementById('more-grid');
  if (!grid) return;
  grid.innerHTML = overflow.map(m => `
    <button class="more-item ${m.id === current ? 'more-item--active' : ''}" data-module="${m.id}">
      <span class="more-item__icon">${m.icon}</span>
      <span class="more-item__label">${m.shortName || m.name}</span>
    </button>
  `).join('');
}

function toggleMoreSheet(overflow, current) {
  ensureMoreSheet();
  if (_moreOpen) { closeMoreSheet(); return; }
  _moreOpen = true;
  updateMoreSheet(overflow, current);
  document.getElementById('more-sheet').classList.add('is-open');
  document.getElementById('more-overlay').classList.add('is-open');
}

function closeMoreSheet() {
  _moreOpen = false;
  document.getElementById('more-sheet')?.classList.remove('is-open');
  document.getElementById('more-overlay')?.classList.remove('is-open');
}

// ── Module loading ─────────────────────────────────────────────
let activeModule = null;

async function activateModule(id, meta) {
  // Show loading
  moduleView.innerHTML = `<div class="loader"><div class="loader-spinner"></div></div>`;
  pageHeading.textContent = meta.name;
  topbarActions.innerHTML = "";

  buildNav(); // refresh active state

  try {
    // Dynamically import the module (version stamp busts ES module cache)
    const mod = await import(`../modules/${id}.js?v=${_V}`);

    // Cleanup previous
    if (activeModule?.cleanup) {
      try { activeModule.cleanup(); } catch {}
    }

    activeModule = mod;

    // Clear and render
    moduleView.innerHTML = "";
    await mod.init(moduleView, {
      state: getState,
      setState,
      setActions: (html) => { topbarActions.innerHTML = html; },
      navigate,
    });
  } catch (err) {
    console.error(`Failed to load module "${id}":`, err);
    moduleView.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">⚠️</div>
        <div class="empty-state__title">Module unavailable</div>
        <div class="empty-state__body">${err.message}</div>
      </div>
    `;
  }
}

// ── Firebase subscriptions (global shared data) ───────────────
function initDataSubscriptions() {
  // Contacts
  dbSubscribe(refs.contacts(), docs => {
    setState({ contacts: docs, syncStatus: "synced" });
    setSyncStatus("synced");
  }, () => setSyncStatus("error"));

  // Reminders
  dbSubscribe(refs.reminders(), docs => setState({ reminders: docs }));

  // Events
  dbSubscribe(refs.events(), docs => setState({ events: docs }));

  // Finances
  dbSubscribe(refs.finances(), docs => setState({ finances: docs }));
  dbSubscribe(refs.bills(), docs => setState({ bills: docs }));

  // Household
  dbSubscribe(refs.household(), docs => setState({ householdTasks: docs }));

  // Rewards catalog
  dbSubscribe(refs.rewards(), docs => setState({ rewards: docs }));

  // Family
  dbSubscribe(refs.family(), docs => setState({ familyMembers: docs }));

  // Members — canonical household identity (Family OS foundation). Nothing
  // renders from this yet; it populates state for the upcoming profile switcher.
  dbSubscribe(refs.members(), docs => setState({ members: docs }));

  // Email briefs
  dbSubscribe(refs.emailBriefs(), docs => setState({ emailBriefs: docs }));

  // Meals: weekly plans + recipe library + this week's dinner assignments
  dbSubscribe(refs.mealPlans(), docs => setState({ mealPlans: docs }));
  dbSubscribe(refs.recipes(), docs => setState({ recipes: docs }));
  subscribeDoc(refs.weekDinners(), doc => setState({ weekDinners: doc }));

  // Apple Shortcuts sync documents
  subscribeDoc(refs.syncCalendar(), doc => {
    const syncedEvents   = doc ? parseSync(doc.data, "event")    : [];
    const calLastSync    = doc?.lastSync || null;
    setState({ syncedEvents, calLastSync });
  });

  subscribeDoc(refs.syncReminders(), doc => {
    // On desktop the local bridge (EventKit) owns reminder data in real time.
    // Skip the Firestore/Shortcuts feed there so it can't clobber bridge data.
    if (window.__remBridgeActive) return;
    const syncedReminders  = doc ? parseSync(doc.data, "reminder") : [];
    const remLastSync      = doc?.lastSync || null;
    setState({ syncedReminders, remLastSync });
  });
}

// ── Parse pipe-delimited sync data ────────────────────────────
// Calendar line format:  title|||date|||startTime|||endTime|||location|||calendar
// Reminder line format:  title|||dueDate|||priority|||list|||notes
function parseSync(raw, type) {
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line, i) => {
    const parts = line.split('|||');
    if (type === "event") {
      const [title, date, time, endTime, location, calendar] = parts;
      return { id: `apple_ev_${i}_${date}`, title: title||'', date: date||'', time: time||'', endTime: endTime||'', location: location||'', calendar: calendar||'Personal', source: 'apple', color: '#FF3B30' };
    } else {
      const [title, dueDate, priority, list, notes] = parts;
      return { id: `apple_rem_${i}`, title: title||'', dueDate: dueDate||'', priority: priority||'none', list: list||'personal', notes: notes||'', completed: false, source: 'apple' };
    }
  });
}

function setSyncStatus(status) {
  if (!syncDot) return;
  syncDot.className = `ms-pulse ms-pulse--${status === "synced" ? "" : status}`.trim();
  const label = document.getElementById("sync-label");
  if (label) label.textContent = { synced: "Live", saving: "Saving…", error: "Sync error" }[status] || "Live";
}

// ── Boot ───────────────────────────────────────────────────────
async function boot() {

  // Wire up router
  onModuleChange((id, meta) => activateModule(id, meta));

  // Start data subscriptions
  initDataSubscriptions();

  // Seed canonical members once (idempotent; no-ops if already present).
  seedMembersIfEmpty();

  // Re-gate the nav when the active profile changes, or once members load
  // (member scopes resolve async). Bounce off a module the profile can't see.
  let _navKey = "";
  onState(() => {
    const s = getState();
    const key = `${s.activeMember}|${s.members.length}`;
    if (key === _navKey) return;
    _navKey = key;
    buildNav();
    const meta = getModuleMeta(getCurrentModule());
    if (meta?.scope && !canEdit(meta.scope)) navigate("home");
  });

  // Build initial nav (modules are known from config, no async load needed)
  buildNav();

  // Profile switcher in the mission strip (Family OS identity)
  initProfileSwitcher();

  // Household quick-access button (mobile mission strip)
  document.getElementById('ms-household-btn')?.addEventListener('click', () => {
    closeMoreSheet();
    navigate('household');
  });

  // Global AI assistant (persists across all modules)
  initGlobalAI(navigate);

  // Navigate to initial route
  initRouter("home");
}

boot().catch(console.error);
