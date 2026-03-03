import { SCHEMA_VERSION, validateState } from './schema.js';

const KEY = 'gateway_state_v1';

export function defaultState() {
  return { schemaVersion: SCHEMA_VERSION, requirements: [], notesByReqId: {} };
}

export function loadState() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return defaultState();

  try {
    const parsed = JSON.parse(raw);
    if (validateState(parsed)) return parsed;
  } catch {}
  return defaultState();
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function resetState() {
  localStorage.removeItem(KEY);
}