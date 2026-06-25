/**
 * Members — canonical household identity (Family OS, step 1: backend only).
 *
 * This is a NEW, parallel collection ("members"). It does NOT replace or touch
 * the existing "family" collection that modules/family.js renders from — that
 * keeps working exactly as before. Nothing renders from `members` yet; this is
 * the foundation that the profile switcher + per-member assignment build on.
 *
 * Schema (one doc per person/pet):
 *   id          stable slug — used as `assignedTo` across tasks/events/etc.
 *   name        display name
 *   emoji       avatar glyph
 *   color       accent hex
 *   role        "owner" | "adult" | "teen" | "kid" | "pet"
 *   birthday    ISO date or null
 *   isUser      can this member be an active profile (vs. a pet)?
 *   scopes      string[] — UI capability gates (see canDo)
 *   pin         optional 4-digit string to gate profile switch (null = open)
 *   allowance   { rate, balance, currency } — chore→allowance hook (later)
 *   health      { ouraToken, weightGoal } — per-member health hook (later)
 *   order       sort order
 */

import { refs, dbSet, fetchAll } from "./db.js";

// Scope constants — drive which modules a profile can see/edit (step 3).
export const SCOPES = ["admin", "finances", "health", "crm"];

// Seed identities. Ids match the existing family.js DEFAULT_MEMBERS so any
// future migration onto this collection lines up 1:1.
export const SEED_MEMBERS = [
  { id: "michael",  name: "Michael",  emoji: "🧔", color: "#007AFF", role: "owner", isUser: true,  scopes: ["admin", "finances", "health", "crm"], order: 0 },
  { id: "wife",     name: "Wife",     emoji: "👩", color: "#FF2D55", role: "adult", isUser: true,  scopes: ["finances", "health", "crm"],          order: 1 },
  { id: "son",      name: "Son",      emoji: "👦", color: "#007AFF", role: "teen",  isUser: true,  scopes: ["health"],                              order: 2 },
  { id: "daughter", name: "Daughter", emoji: "👧", color: "#AF52DE", role: "kid",   isUser: true,  scopes: ["health"],                              order: 3 },
  { id: "dog1",     name: "Golden #1",emoji: "🦮", color: "#FF9500", role: "pet",   isUser: false, scopes: [],                                      order: 4 },
  { id: "dog2",     name: "Golden #2",emoji: "🦮", color: "#FFCC00", role: "pet",   isUser: false, scopes: [],                                      order: 5 },
];

function withDefaults(m) {
  return {
    birthday: null,
    pin: null,
    allowance: { rate: 0, balance: 0, currency: "USD" },
    health: { ouraToken: null, weightGoal: null },
    ...m,
  };
}

/**
 * One-time, idempotent seed. Writes the seed identities ONLY if the members
 * collection is empty. Safe to call on every boot — it no-ops once seeded and
 * never overwrites edited members.
 */
export async function seedMembersIfEmpty() {
  try {
    const existing = await fetchAll(refs.members());
    if (existing.length) return existing;
    await Promise.all(SEED_MEMBERS.map(m => dbSet(refs.memberDoc(m.id), withDefaults(m))));
    return SEED_MEMBERS.map(withDefaults);
  } catch (err) {
    // Backend foundation must never break boot — log and move on.
    console.warn("seedMembersIfEmpty skipped:", err);
    return [];
  }
}

/** Permission check used by later UI gating. Pets/no-scope → false. */
export function canDo(member, scope) {
  return !!member && Array.isArray(member.scopes) && member.scopes.includes(scope);
}
