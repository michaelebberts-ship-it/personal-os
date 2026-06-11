import { MODULES } from "./config.js";

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

export function getModuleMeta(id) {
  return getMeta(id);
}

export async function navigate(id, pushState = true) {
  const meta = getMeta(id);
  if (!meta) {
    console.warn(`Module "${id}" not found in config`);
    return;
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
