/**
 * Minimal reactive global state.
 * Modules read from this shared store and call setState() to update.
 */

let _state = {
  // sync
  syncStatus: "synced", // "synced" | "saving" | "error"

  // CRM
  contacts: [],

  // Reminders: manually added + Apple-synced
  reminders: [],
  syncedReminders: [],
  remLastSync: null,    // ISO string of last Apple Reminders sync

  // Calendar events: manually added + iCal feed (merged in modules)
  events: [],
  syncedEvents: [],
  icalEvents: [],
  calLastSync: null,    // ISO string of last Apple Calendar sync

  // Finances
  finances: [],
  bills: [],

  // Household tasks
  householdTasks: [],

  // Rewards catalog (chore points redemption)
  rewards: [],

  // Family members & schedules
  familyMembers: [],
  familySchedule: [],

  // Canonical household identity (Family OS) — separate from familyMembers.
  // `activeMember` = who is "using" this device; "household" = wall/shared mode.
  members: [],
  activeMember: "household",

  // Email briefs
  emailBriefs: [],

  // Meals: saved weekly plans + recipe library + this week's dinner assignments
  mealPlans: [],
  recipes: [],
  weekDinners: null,

  // UI
  apiKeyVisible: false,
};

const listeners = new Set();

export function getState() {
  return _state;
}

export function setState(patch) {
  _state = { ..._state, ...patch };
  listeners.forEach(fn => fn(_state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn); // returns unsubscribe
}

// Convenience accessor for a single field
export function get(key) {
  return _state[key];
}
