// SVG icon builder — icons use currentColor so they respond to nav active/inactive state
function _icon(paths) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

export const ICONS = {
  home:      _icon('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
  calendar:  _icon('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  tasks:     _icon('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  user:      _icon('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  dollar:    _icon('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
  utensils:  _icon('<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3z"/><path d="M21 15v7"/>'),
  users:     _icon('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  clipboard: _icon('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="11" y2="16"/>'),
  mail:      _icon('<rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 4 12 13 2 4"/>'),
  activity:  _icon('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
  sun:       _icon('<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'),
};

export const FIREBASE = {
  apiKey: "AIzaSyDINHNV1Ze3QfhXwBPwe22LnUe-xxnU-n4",
  authDomain: "inner-circle-crm.firebaseapp.com",
  projectId: "inner-circle-crm",
  storageBucket: "inner-circle-crm.firebasestorage.app",
  messagingSenderId: "805498964211",
  appId: "1:805498964211:web:be124fa6606b7bc2010f86"
};

export const USER_ID = "owner-inner-circle-crm";

// Claude model for AI features
export const AI_MODEL = "claude-sonnet-4-6";

// Local bridge (iCal / AI / photos proxies). Overridable via localStorage for
// the kitchen Pi if it ever points at another host; defaults to localhost.
export const BRIDGE_URL = localStorage.getItem("os_bridge_url") || "http://localhost:3333";

// Module registry — controls sidebar order, icons, colors
// shortName = label under icon in 64px sidebar (max ~5 chars)
export const MODULES = [
  { id: "home",           name: "Home",         shortName: "Today",  icon: ICONS.home,      color: "#2f9e7e", desc: "Command dashboard" },
  { id: "calendar",       name: "Calendar",     shortName: "Cal",    icon: ICONS.calendar,  color: "#5b8def", desc: "Schedule" },
  { id: "reminders",      name: "Reminders",    shortName: "Tasks",  icon: ICONS.tasks,     color: "#d99a3c", desc: "To-dos" },
  { id: "crm",            name: "Contacts",     shortName: "CRM",    icon: ICONS.user,      color: "#7b5ea7", desc: "Inner circle", scope: "crm" },
  { id: "finances",       name: "Finances",     shortName: "Money",  icon: ICONS.dollar,    color: "#2f9e7e", desc: "Budget & bills", scope: "finances" },
  { id: "meals",          name: "Meals",        shortName: "Meals",  icon: ICONS.utensils,  color: "#d99a3c", desc: "Meal prep" },
  { id: "family",         name: "Family",       shortName: "Fam",    icon: ICONS.users,     color: "#7b5ea7", desc: "Family OS" },
  { id: "household",      name: "Household",    shortName: "House",  icon: ICONS.clipboard, color: "#5b8def", desc: "Home ops" },
  { id: "email",          name: "Email",        shortName: "Email",  icon: ICONS.mail,      color: "#d9694a", desc: "Daily brief" },
  { id: "transformation", name: "Daily Health", shortName: "Health", icon: ICONS.activity,  color: "#c9a961", desc: "Health & Vitals" },
  { id: "weather",        name: "Weather",      shortName: "Wx",     icon: ICONS.sun,       color: "#5b8def", desc: "Forecast & radar" },
];

export const COLORS = ["#FF6B35","#3498DB","#2ECC71","#9B59B6","#E91E63","#F39C12","#1ABC9C","#E74C3C"];

export const TAG_META = {
  bbq:     { label: "🍖 BBQ",     bg: "#FFF3E0", col: "#E65100" },
  friends: { label: "🍺 Friends", bg: "#E8F5E9", col: "#2E7D32" },
  kids:    { label: "⚽ Kids",    bg: "#E3F2FD", col: "#1565C0" },
  family:  { label: "🏡 Family",  bg: "#FCE4EC", col: "#880E4F" },
  work:    { label: "💼 Work",    bg: "#F3E5F5", col: "#6A1B9A" },
};

export const GROUPS = [
  { id: "all",     label: "Everyone",      icon: "🌐" },
  { id: "bbq",     label: "BBQ Team",      icon: "🍖" },
  { id: "friends", label: "Close Friends", icon: "🍺" },
  { id: "kids",    label: "Kids' Parents", icon: "⚽" },
  { id: "family",  label: "Family",        icon: "🏡" },
  { id: "work",    label: "Work",          icon: "💼" },
];
