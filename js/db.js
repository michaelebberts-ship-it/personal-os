import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc,
  onSnapshot, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { FIREBASE, USER_ID } from "./config.js";

const app = initializeApp(FIREBASE);
export const db = getFirestore(app);

// ── Collection refs ──────────────────────────────────────────
const userBase = () => ["users", USER_ID];

export const refs = {
  contacts:    () => collection(db, ...userBase(), "contacts"),
  reminders:   () => collection(db, ...userBase(), "reminders"),
  events:      () => collection(db, ...userBase(), "events"),
  finances:    () => collection(db, ...userBase(), "finances"),
  bills:       () => collection(db, ...userBase(), "bills"),
  household:   () => collection(db, ...userBase(), "household"),
  family:      () => collection(db, ...userBase(), "family"),
  members:     () => collection(db, ...userBase(), "members"),
  emailBriefs: () => collection(db, ...userBase(), "emailBriefs"),
  mealPlans:   () => collection(db, ...userBase(), "mealPlans"),
  recipes:     () => collection(db, ...userBase(), "recipes"),
  // Rewards catalog (additive — does not touch any existing collection)
  rewards:     () => collection(db, ...userBase(), "rewards"),

  contact:    (id) => doc(db, ...userBase(), "contacts",    id),
  reminder:   (id) => doc(db, ...userBase(), "reminders",   id),
  event:      (id) => doc(db, ...userBase(), "events",      id),
  finance:    (id) => doc(db, ...userBase(), "finances",    id),
  bill:       (id) => doc(db, ...userBase(), "bills",       id),
  task:       (id) => doc(db, ...userBase(), "household",   id),
  member:     (id) => doc(db, ...userBase(), "family",      id),
  memberDoc:  (id) => doc(db, ...userBase(), "members",     id),
  emailBrief: (id) => doc(db, ...userBase(), "emailBriefs", id),
  mealPlan:   (id) => doc(db, ...userBase(), "mealPlans",   id),
  recipe:     (id) => doc(db, ...userBase(), "recipes",     id),
  reward:     (id) => doc(db, ...userBase(), "rewards",     id),

  // This week's dinner assignments (singleton doc) — drives the Home "Tonight" card
  weekDinners: () => doc(db, ...userBase(), "meta", "weekDinners"),

  // Sync documents — written by Apple Shortcuts
  syncCalendar:  () => doc(db, ...userBase(), "sync", "calendar"),
  syncReminders: () => doc(db, ...userBase(), "sync", "reminders"),
};

// ── CRUD helpers ─────────────────────────────────────────────
export async function dbSet(ref, data) {
  await setDoc(ref, { ...data, _ts: serverTimestamp() });
}

export async function dbUpdate(ref, patch) {
  await updateDoc(ref, { ...patch, _ts: serverTimestamp() });
}

export async function dbDelete(ref) {
  await deleteDoc(ref);
}

// ── Subscribe helper — collection, returns unsubscribe fn ────
export function subscribe(colRef, cb, errCb) {
  return onSnapshot(query(colRef), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, errCb || console.error);
}

// ── Subscribe to a single document ───────────────────────────
export function subscribeDoc(docRef, cb, errCb) {
  return onSnapshot(docRef, snap => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, errCb || console.error);
}

// ── One-time fetch ────────────────────────────────────────────
export async function fetchAll(colRef) {
  const snap = await getDocs(colRef);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Shared uid generator ──────────────────────────────────────
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
