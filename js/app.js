import { MODULES } from "./config.js";
import { refs, subscribe as dbSubscribe, subscribeDoc, uid } from "./db.js";
import { setState, getState } from "./state.js";
import { navigate, onModuleChange, initRouter, getCurrentModule, getAllModules } from "./router.js";

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

// Dark mode only — no theme toggle needed
document.documentElement.setAttribute("data-theme", "dark");

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
  const modules = getAllModules();
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

  // Mobile bottom nav (first 5 items)
  bottomNavList.innerHTML = modules.slice(0, 5).map(m => `
    <li>
      <button
        class="bottom-item ${m.id === current ? "bottom-item--active" : ""}"
        data-module="${m.id}"
      >
        <span class="bottom-item__icon">${m.icon}</span>
        <span class="bottom-item__label">${m.name}</span>
      </button>
    </li>
  `).join("");

  // Event delegation
  [navList, bottomNavList].forEach(el => {
    el.onclick = e => {
      const btn = e.target.closest("[data-module]");
      if (btn) navigate(btn.dataset.module);
    };
  });
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
    // Dynamically import the module
    const mod = await import(`../modules/${id}.js`);

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

  // Family
  dbSubscribe(refs.family(), docs => setState({ familyMembers: docs }));

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

  // Build initial nav (modules are known from config, no async load needed)
  buildNav();

  // Navigate to initial route
  initRouter("home");
}

boot().catch(console.error);
