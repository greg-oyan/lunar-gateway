export const SCHEMA_VERSION = 1;

export function validateState(state) {
  return (
    state &&
    state.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(state.requirements) &&
    typeof state.notesByReqId === 'object'
  );
}