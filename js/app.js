import { loadState, saveState } from './store.js';
import { renderList, renderDetail } from './ui.js';

let state = loadState();

const listPanel = document.getElementById('listPanel');
const detailPanel = document.getElementById('detailPanel');
const searchInput = document.getElementById('searchInput');
const fileInput = document.getElementById('fileInput');

let selectedId = null;

function refresh() {
  const q = (searchInput.value || '').trim().toLowerCase();

  const filtered = state.requirements
    .filter((r) => {
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.text.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  renderList(filtered, listPanel, (req) => selectReq(req.id));
}

function selectReq(id) {
  selectedId = id;
  const req = state.requirements.find((r) => r.id === id);
  if (!req) return;

  const note = state.notesByReqId[id] || '';
  renderDetail(req, detailPanel, note, (newNote) => {
    state.notesByReqId[id] = newNote;
    saveState(state);
  });
}

document.getElementById('loadDemoBtn').addEventListener('click', () => {
  state.requirements = demoRequirements();
  saveState(state);
  refresh();
});

document.getElementById('exportBtn').addEventListener('click', () => {
  downloadJson(state, 'gateway_export.json');
});

document.getElementById('importBtn').addEventListener('click', () => {
  fileInput.value = '';
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const imported = JSON.parse(text);
  // simplest safe behavior for now: replace
  state = imported;
  saveState(state);
  selectedId = null;
  detailPanel.innerHTML = '<h2>Imported.</h2><p>Select a requirement on the left.</p>';
  refresh();
});

searchInput.addEventListener('input', refresh);

function demoRequirements() {
  return [
    {
      id: 'GW-POWER-001',
      title