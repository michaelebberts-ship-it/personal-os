import { MODULES } from "./config.js";
import { canEdit } from "./identity.js";

let current = null;
let onChangeCallback = null;

export function onModuleChange(cb) {
  onChangeCallback = cb;
}

// Look up module meta from the static MODULES config — no registration step needed
function getMeta(id) {
  return MODULES.find(m => m.id === id) || null;
}

export function getAllModules() {
  return MODULES;
}

// Modules the active profile is allowed to see. A module with no `scope` is
// always visible; a scoped one is shown only if the active member holds it.
// Household mode passes everything (shared wall surface).
export function getVisibleModules() {
  return MODULES.filter(m => !m.scope || canEdit(m.scope));
}

export function getModuleMeta(id) {
  return getMeta(id);
}

export async function navigate(id, pushState = true) {
  const meta = getMeta(id);
  if (!meta) {
    console.warn(`Module "${id}" not found in config`);
    return;
  }

  // Scope guard — a profile without the module's scope can't open it
  // (blocks deep-links via #hash and tile shortcuts). Fall back to home.
  if (meta.scope && !canEdit(meta.scope) && id !== "home") {
    return navigate("home", pushState);
  }

  current = id;

  if (pushState) {
    history.pushState({ module: id }, "", `#${id}`);
  }

  if (onChangeCallback) {
    onChangeCallback(id, meta);
  }
}

export function getCurrentModule() {
  return current;
}

export function initRouter(defaultModule = "home") {
  window.addEventListener("popstate", (e) => {
    const id = e.state?.module || hashModule() || defaultModule;
    navigate(id, false);
  });

  const initial = hashModule() || defaultModule;
  navigate(initial, true);
}

function hashModule() {
  const hash = location.hash.replace("#", "").trim();
  return MODULES.some(m => m.id === hash) ? hash : null;
}
