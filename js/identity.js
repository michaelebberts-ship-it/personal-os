/**
 * Identity — "who is using this device" for the Family OS (step 2).
 *
 * NOT auth. A per-device profile selection persisted to localStorage. The wall
 * monitor stays in "household" mode (everyone); a phone can be set to a person.
 * Reads members from state (seeded in step 1) and renders a switcher into the
 * mission strip, replacing the previously-static user badge.
 */

import { getState, setState, subscribe } from "./state.js";
import { canDo } from "./members.js";

const LS_KEY = "os.activeMember";
export const HOUSEHOLD = "household";

// ── Logic helpers (also used by later router scope-gating) ────────
export function getActiveMemberId() {
  return localStorage.getItem(LS_KEY) || HOUSEHOLD;
}

/** The active member object, or null in household mode. */
export function getActiveMember() {
  const id = getActiveMemberId();
  if (id === HOUSEHOLD) return null;
  return getState().members.find(m => m.id === id) || null;
}

export function isHouseholdMode() {
  return getActiveMemberId() === HOUSEHOLD;
}

export function setActiveMember(id) {
  localStorage.setItem(LS_KEY, id);
  setState({ activeMember: id });
}

/**
 * Capability check for UI gating (step 3). Household mode is the shared wall
 * surface — full visibility, read-mostly — so it passes. A specific member
 * passes only if they hold the scope.
 */
export function canEdit(scope) {
  if (isHouseholdMode()) return true;
  const members = getState().members;
  if (!members.length) return true;            // not loaded yet — don't gate prematurely
  const m = members.find(x => x.id === getActiveMemberId());
  if (!m) return true;                          // unknown/stale profile — fail open
  return canDo(m, scope);
}

// ── Switcher UI ───────────────────────────────────────────────────
let _root = null;
let _open = false;

function avatarGlyph(m) {
  if (m.emoji) return m.emoji;
  return (m.name || "?").trim().slice(0, 2).toUpperCase();
}

function renderActiveBadge() {
  const m = getActiveMember();
  if (!m) {
    return `
      <div class="ms-avatar" style="background:rgba(255,255,255,0.08)">🏠</div>
      <span class="ms-user-name" style="color:var(--text-secondary)">Household</span>
      <span class="ms-switch-caret">▾</span>
    `;
  }
  return `
    <div class="ms-avatar" style="background:${m.color}33;color:${m.color}">${avatarGlyph(m)}</div>
    <span class="ms-user-name" style="color:${m.color}">${m.name}</span>
    <span class="ms-switch-caret">▾</span>
  `;
}

function renderMenu() {
  const members = [...getState().members]
    .filter(m => m.isUser)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const activeId = getActiveMemberId();

  const row = (id, glyph, label, color, active) => `
    <button class="ms-switch-item ${active ? "is-active" : ""}" data-member="${id}">
      <span class="ms-avatar" style="background:${color}33;color:${color}">${glyph}</span>
      <span class="ms-switch-label">${label}</span>
      ${active ? `<span class="ms-switch-check">✓</span>` : ""}
    </button>
  `;

  return `
    <div class="ms-switch-menu">
      ${row(HOUSEHOLD, "🏠", "Household", "var(--text-secondary)", activeId === HOUSEHOLD)}
      <div class="ms-switch-sep"></div>
      ${members.map(m => row(m.id, avatarGlyph(m), m.name, m.color, activeId === m.id)).join("")}
    </div>
  `;
}

function render() {
  if (!_root) return;
  _root.innerHTML = `
    <button class="ms-theme-toggle" id="theme-toggle" aria-label="Toggle light/dark mode"></button>
    <button class="ms-user-badge ms-switch-trigger" id="ms-switch-trigger" aria-haspopup="true" aria-expanded="${_open}">
      ${renderActiveBadge()}
    </button>
    ${_open ? renderMenu() : ""}
  `;

  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) themeBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("lc-theme", next);
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next === "dark" ? "#0f1311" : "#eef1ec");
  });

  const trigger = document.getElementById("ms-switch-trigger");
  if (trigger) trigger.addEventListener("click", e => {
    e.stopPropagation();
    _open = !_open;
    render();
  });

  _root.querySelectorAll("[data-member]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      setActiveMember(btn.dataset.member);
      _open = false;
      render();
    });
  });
}

/** Mount the switcher into the mission strip's right slot. */
export function initProfileSwitcher() {
  _root = document.querySelector(".mission-strip .ms-right");
  if (!_root) return;
  _root.classList.add("ms-switch-root");

  // Re-render when members arrive/change from Firestore.
  subscribe(() => { if (!_open) render(); });

  // Close on outside click.
  document.addEventListener("click", () => {
    if (_open) { _open = false; render(); }
  });

  render();
}
