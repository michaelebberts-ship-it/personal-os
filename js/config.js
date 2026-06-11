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
export const AI_MODEL = "claude-sonnet-4-5";

// Local bridge (iCal / AI / photos proxies). Overridable via localStorage for
// the kitchen Pi if it ever points at another host; defaults to localhost.
export const BRIDGE_URL = localStorage.getItem("os_bridge_url") || "http://localhost:3333";

// Module registry — controls sidebar order, icons, colors
export const MODULES = [
  { id: "home",      name: "Home",       icon: "⌂",  color: "#007AFF", desc: "Morning brief" },
  { id: "crm",       name: "Contacts",   icon: "👥", color: "#FF6B35", desc: "Inner circle" },
  { id: "calendar",  name: "Calendar",   icon: "📅", color: "#FF3B30", desc: "Schedule" },
  { id: "reminders", name: "Reminders",  icon: "⏰", color: "#FF9500", desc: "To-dos" },
  { id: "finances",  name: "Finances",   icon: "💰", color: "#34C759", desc: "Budget & bills" },
  { id: "household", name: "Household",  icon: "🏠", color: "#5AC8FA", desc: "Home ops" },
  { id: "family",    name: "Family",     icon: "👨‍👩‍👧‍👦", color: "#AF52DE", desc: "Family OS" },
  { id: "meals",     name: "Meals",      icon: "🍱", color: "#FF9F0A", desc: "Meal prep" },
  { id: "email",     name: "Email",      icon: "📧", color: "#FF2D55", desc: "Daily brief" },
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
