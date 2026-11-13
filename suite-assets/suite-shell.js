// Suite-wide search (Ctrl/Cmd+K or "/"). One index over every WBS element,
// milestone, risk, document, and glossary term, with a jump into the app that
// owns each result. Loaded by every page through applySuiteNav().

import { buildSuiteHref, compareWbsId } from './suite-context.js';

const ASSET_BASE = new URL('.', import.meta.url);
const DATA_URLS = {
  crosswalk: new URL('./data/gateway-crosswalk.json', ASSET_BASE),
  risks: new URL('../risk/data/risks.json', ASSET_BASE),
  schedule: new URL('../schedule/data/gateway-schedule.json', ASSET_BASE),
  documents: new URL('../documents/data/documents.json', ASSET_BASE),
  glossary: new URL('../Contract_Cost_Schedule%20Documents/data/gateway_glossary.csv', ASSET_BASE),
};

const GROUP_ORDER = ['view', 'wbs', 'milestone', 'risk', 'document', 'glossary'];
const GROUP_LABELS = {
  view: 'Apps and views',
  wbs: 'WBS elements',
  milestone: 'Milestones',
  risk: 'Risks',
  document: 'Documents',
  glossary: 'Glossary',
};
const MAX_PER_GROUP = { view: 6, wbs: 6, milestone: 5, risk: 5, document: 4, glossary: 3 };
const MAX_PER_GROUP_FOCUSED = 60;

const VIEW_ENTRIES = [
  { title: 'Program Overview', meta: 'Cost, schedule, and risk on one screen', route: 'overview', keywords: 'dashboard home summary' },
  { title: 'Confidence Lab', meta: 'Cost and schedule confidence simulation', route: 'confidence', keywords: 'monte carlo jcl s-curve scenario reserve' },
  { title: 'WBS Explorer', meta: 'Program structure', route: 'wbs', keywords: 'work breakdown structure hierarchy' },
  { title: 'WBS Explorer: Structure view', meta: 'Full hierarchy diagram', route: 'wbs', params: { mode: 'structure' }, keywords: 'tree diagram' },
  { title: 'Cost Explorer: Gateway cost map', meta: 'Cost by module', route: 'cost', keywords: 'estimate money module' },
  { title: 'Cost Explorer: Yearly spend', meta: 'Annual phasing', route: 'cost', params: { view: 'year' }, keywords: 'fiscal year phasing budget' },
  { title: 'Cost Explorer: Defensibility', meta: 'Method, evidence, sources', route: 'cost', params: { view: 'method' }, keywords: 'methodology basis of estimate traceability' },
  { title: 'Schedule Explorer', meta: 'Phases and milestones', route: 'schedule', keywords: 'timeline gantt dates' },
  { title: 'Risk Explorer', meta: 'Risk register', route: 'risk', keywords: 'risks likelihood impact mitigation' },
  { title: 'Documents Explorer', meta: 'Source library', route: 'documents', keywords: 'files csv rtf sources' },
  { title: '3D Simulation', meta: 'Gateway in lunar orbit', route: 'simulation', keywords: 'orbit three.js nrho moon tour' },
];

const state = {
  open: false,
  query: '',
  results: [],
  activeIndex: 0,
  focusGroup: '',
  index: null,
  indexPromise: null,
  loadError: '',
  lastFocused: null,
};

const dom = {};

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseCsv(rawText) {
  const text = String(rawText ?? '').replace(/^﻿/, '');
  const rows = [];
  let value = '';
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === ',') {
      row.push(value);
      value = '';
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (value !== '' || row.length) {
    row.push(value);
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, String(cells[index] ?? '').trim()])),
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${url.pathname}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${url.pathname}`);
  return response.text();
}

function makeEntry(entry) {
  return {
    ...entry,
    titleKey: normalize(entry.title),
    idKey: normalize(entry.id || ''),
    aliases: (entry.aliases || []).map(normalize).filter(Boolean),
    haystack: normalize([entry.id, entry.title, entry.meta, entry.keywords, ...(entry.aliases || [])].filter(Boolean).join(' ')),
  };
}

function priorityBandLabel(score) {
  if (score >= 16) return 'Critical';
  if (score >= 12) return 'High';
  if (score >= 8) return 'Moderate';
  return 'Watch';
}

async function buildIndex() {
  const settled = await Promise.allSettled([
    fetchJson(DATA_URLS.crosswalk),
    fetchJson(DATA_URLS.risks),
    fetchJson(DATA_URLS.schedule),
    fetchJson(DATA_URLS.documents),
    fetchText(DATA_URLS.glossary),
  ]);
  const [crosswalk, risks, schedule, documents, glossaryText] = settled.map((result) =>
    result.status === 'fulfilled' ? result.value : null,
  );
  const missing = settled.filter((result) => result.status === 'rejected').length;
  if (missing === settled.length) throw new Error('Search data could not be loaded.');

  const entries = VIEW_ENTRIES.map((view) =>
    makeEntry({ ...view, group: 'view', href: buildSuiteHref(view.route, view.params || {}) }),
  );

  const wbsById = crosswalk?.wbs?.byId || {};
  const glossaryRows = glossaryText ? parseCsv(glossaryText) : [];
  // Glossary acronyms double as search aliases for the WBS element they
  // describe, so "HALO" finds 1.4 Habitation and Logistics Outpost.
  const aliasesByWbs = new Map();
  glossaryRows.forEach((row) => {
    if (!row.acronym || !wbsById[row.related_wbs]) return;
    if (normalize(wbsById[row.related_wbs].name) !== normalize(row.term)) return;
    if (!aliasesByWbs.has(row.related_wbs)) aliasesByWbs.set(row.related_wbs, []);
    aliasesByWbs.get(row.related_wbs).push(row.acronym);
  });

  Object.values(wbsById)
    .sort((left, right) => compareWbsId(left.id, right.id))
    .forEach((node) => {
      const parent = wbsById[node.parentId];
      const hasCost = Boolean(node.cost?.primaryCategoryId);
      const riskCount = node.risks?.ids?.length || 0;
      const milestoneCount = node.schedule?.milestoneIds?.length || 0;
      const context = { from: 'search', wbs: node.id };
      entries.push(
        makeEntry({
          group: 'wbs',
          id: node.id,
          title: node.name,
          meta: parent ? `Under ${parent.id} ${parent.name}` : 'Program root',
          aliases: aliasesByWbs.get(node.id) || [],
          href: buildSuiteHref('wbs', context),
          jumps: [
            hasCost ? { label: 'Cost', href: buildSuiteHref('cost', context) } : null,
            milestoneCount ? { label: 'Schedule', href: buildSuiteHref('schedule', context) } : null,
            riskCount ? { label: `Risk (${riskCount})`, href: buildSuiteHref('risk', context) } : null,
            { label: 'Overview', href: buildSuiteHref('overview', context) },
          ].filter(Boolean),
        }),
      );
    });

  (schedule?.milestones || []).forEach((milestone) => {
    entries.push(
      makeEntry({
        group: 'milestone',
        id: milestone.id,
        title: milestone.shortName || milestone.name,
        meta: [milestone.dateLabel, milestone.phaseName].filter(Boolean).join(' · '),
        keywords: [milestone.name, milestone.task?.name, milestone.task?.wbsId].filter(Boolean).join(' '),
        href: buildSuiteHref('schedule', { from: 'search', milestone: milestone.id }),
      }),
    );
  });

  (risks?.risks || []).forEach((risk) => {
    entries.push(
      makeEntry({
        group: 'risk',
        id: risk.id,
        title: risk.title,
        meta: `${priorityBandLabel(Number(risk.priority))} · score ${risk.priority} · ${risk.category}`,
        keywords: [(risk.tags || []).join(' '), risk.owner, risk.status, risk.wbsId].filter(Boolean).join(' '),
        href: buildSuiteHref('risk', { from: 'search', risk: risk.id }),
      }),
    );
  });

  (documents?.documents || []).forEach((doc) => {
    entries.push(
      makeEntry({
        group: 'document',
        id: doc.filename,
        title: doc.title,
        meta: [doc.fileType, doc.category].filter(Boolean).join(' · '),
        keywords: [(doc.tags || []).join(' '), doc.shortDescription].filter(Boolean).join(' '),
        href: buildSuiteHref('documents', { from: 'search', doc: doc.id }),
      }),
    );
  });

  glossaryRows.forEach((row) => {
    if (!row.term) return;
    const relatedWbs = wbsById[row.related_wbs] ? row.related_wbs : '';
    entries.push(
      makeEntry({
        group: 'glossary',
        id: row.acronym && row.acronym !== row.term ? row.acronym : '',
        title: row.term,
        meta: relatedWbs ? `Related to WBS ${relatedWbs}` : 'Glossary term',
        body: row.definition,
        keywords: row.definition,
        href: relatedWbs ? buildSuiteHref('wbs', { from: 'search', wbs: relatedWbs }) : '',
      }),
    );
  });

  return { entries, partial: missing > 0 };
}

function ensureIndex() {
  if (!state.indexPromise) {
    state.indexPromise = buildIndex()
      .then((index) => {
        state.index = index;
        state.loadError = '';
      })
      .catch((error) => {
        state.loadError = error instanceof Error ? error.message : 'Search data could not be loaded.';
        state.indexPromise = null;
      })
      .finally(() => {
        if (state.open) runSearch();
      });
  }
  return state.indexPromise;
}

function scoreEntry(entry, tokens, fullQuery) {
  let score = 0;
  for (const token of tokens) {
    if (!entry.haystack.includes(token)) return 0;
    if (entry.aliases.includes(token)) score += 90;
    if (entry.idKey && entry.idKey === token) score += 120;
    else if (entry.idKey && entry.idKey.startsWith(token)) score += 45;
    if (entry.titleKey.startsWith(token)) score += 40;
    else if (new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(entry.titleKey)) score += 24;
    else if (entry.titleKey.includes(token)) score += 12;
    else score += 3;
  }
  if (entry.titleKey === fullQuery || entry.idKey === fullQuery) score += 80;
  return score;
}

function runSearch() {
  const query = normalize(state.query).trim();
  const entries = state.index?.entries || [];
  let grouped = [];

  if (!query) {
    const views = entries.filter((entry) => entry.group === 'view');
    grouped = views.length ? [{ group: 'view', items: views, total: views.length }] : [];
  } else {
    const tokens = query.split(/\s+/).filter(Boolean);
    const byGroup = new Map();
    entries.forEach((entry) => {
      const score = scoreEntry(entry, tokens, query);
      if (!score) return;
      if (!byGroup.has(entry.group)) byGroup.set(entry.group, []);
      byGroup.get(entry.group).push({ entry, score });
    });
    grouped = GROUP_ORDER.filter((group) => byGroup.has(group))
      .filter((group) => !state.focusGroup || state.focusGroup === group)
      .map((group) => {
        const ranked = byGroup.get(group).sort((left, right) => right.score - left.score);
        const limit = state.focusGroup === group ? MAX_PER_GROUP_FOCUSED : MAX_PER_GROUP[group];
        return {
          group,
          total: ranked.length,
          best: ranked[0].score,
          items: ranked.slice(0, limit).map((item) => item.entry),
        };
      })
      // Strongest group first, so an exact ID match leads the list.
      .sort((left, right) => right.best - left.best || GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group));
  }

  state.results = grouped;
  const flatCount = grouped.reduce((sum, group) => sum + group.items.length, 0);
  state.activeIndex = Math.min(state.activeIndex, Math.max(flatCount - 1, 0));
  renderResults();
}

function flatResults() {
  return state.results.flatMap((group) => group.items);
}

function renderResults() {
  if (!dom.list) return;
  const query = state.query.trim();

  if (!state.index) {
    dom.list.innerHTML = `<p class="suite-search__status">${escapeHtml(state.loadError || 'Loading the suite index...')}</p>`;
    dom.count.textContent = '';
    return;
  }

  const flat = flatResults();
  if (!flat.length) {
    dom.list.innerHTML = `<p class="suite-search__status">No matches for "${escapeHtml(query)}".</p>`;
    dom.count.textContent = '';
    return;
  }

  let cursor = 0;
  dom.list.innerHTML = state.results
    .map((group) => {
      const rows = group.items
        .map((entry) => {
          const index = cursor;
          cursor += 1;
          const active = index === state.activeIndex;
          const jumps = (entry.jumps || [])
            .map((jump) => `<a class="suite-search__jump" href="${escapeHtml(jump.href)}" tabindex="-1">${escapeHtml(jump.label)}</a>`)
            .join('');
          return `
            <li class="suite-search__row${active ? ' suite-search__row--active' : ''}" role="option" id="suite-search-option-${index}" aria-selected="${active}" data-index="${index}">
              <div class="suite-search__row-main">
                <p class="suite-search__title">
                  ${entry.id ? `<span class="suite-search__id">${escapeHtml(entry.id)}</span>` : ''}
                  <span>${escapeHtml(entry.title)}</span>
                </p>
                ${entry.meta ? `<p class="suite-search__meta">${escapeHtml(entry.meta)}</p>` : ''}
                ${entry.body ? `<p class="suite-search__body">${escapeHtml(entry.body)}</p>` : ''}
              </div>
              ${jumps ? `<div class="suite-search__jumps">${jumps}</div>` : ''}
            </li>`;
        })
        .join('');
      const more = group.total - group.items.length;
      const focusable = query && (more > 0 || state.focusGroup === group.group);
      return `
        <section class="suite-search__group" aria-label="${escapeHtml(GROUP_LABELS[group.group])}">
          <header class="suite-search__group-head">
            <span>${escapeHtml(GROUP_LABELS[group.group])}</span>
            ${
              focusable
                ? `<button class="suite-search__more" type="button" data-focus-group="${state.focusGroup === group.group ? '' : escapeHtml(group.group)}" tabindex="-1">${
                    state.focusGroup === group.group ? 'All types' : `All ${group.total}`
                  }</button>`
                : `<span class="suite-search__group-count">${group.total}</span>`
            }
          </header>
          <ul class="suite-search__rows" role="presentation">${rows}</ul>
        </section>`;
    })
    .join('');

  const total = state.results.reduce((sum, group) => sum + group.total, 0);
  dom.count.textContent = query ? `${total} ${total === 1 ? 'match' : 'matches'}` : '';
  dom.input.setAttribute('aria-activedescendant', `suite-search-option-${state.activeIndex}`);
  dom.list.querySelector('.suite-search__row--active')?.scrollIntoView({ block: 'nearest' });
}

function activate(entry) {
  if (!entry) return;
  if (!entry.href) return;
  window.location.assign(entry.href);
}

function moveActive(delta) {
  const count = flatResults().length;
  if (!count) return;
  state.activeIndex = (state.activeIndex + delta + count) % count;
  renderResults();
}

function ensureStylesheet() {
  const href = new URL('./suite-shell.css', ASSET_BASE).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')].some((link) => link.href === href);
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

function buildDom() {
  if (dom.root) return;
  ensureStylesheet();

  const root = document.createElement('div');
  root.className = 'suite-search';
  root.hidden = true;
  root.innerHTML = `
    <div class="suite-search__backdrop" data-close-search></div>
    <div class="suite-search__dialog" role="dialog" aria-modal="true" aria-label="Search the Gateway suite">
      <div class="suite-search__field">
        <svg class="suite-search__icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13.2 13.2 17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input class="suite-search__input" type="text" role="combobox" aria-expanded="true" aria-controls="suite-search-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="WBS, milestone, risk, document, or term" />
        <span class="suite-search__count" aria-live="polite"></span>
        <kbd class="suite-search__kbd">Esc</kbd>
      </div>
      <div class="suite-search__list" id="suite-search-list" role="listbox" aria-label="Results"></div>
      <footer class="suite-search__foot">
        <span><kbd class="suite-search__kbd">↑</kbd><kbd class="suite-search__kbd">↓</kbd> move</span>
        <span><kbd class="suite-search__kbd">Enter</kbd> open</span>
        <span class="suite-search__foot-note">Ctrl K or / from any app</span>
      </footer>
    </div>`;
  document.body.append(root);

  dom.root = root;
  dom.input = root.querySelector('.suite-search__input');
  dom.list = root.querySelector('.suite-search__list');
  dom.count = root.querySelector('.suite-search__count');

  dom.input.addEventListener('input', () => {
    state.query = dom.input.value;
    state.activeIndex = 0;
    state.focusGroup = '';
    runSearch();
  });

  dom.input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(flatResults()[state.activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
    } else if (event.key === 'Tab') {
      // Focus stays in the field; results are reached with the arrow keys.
      event.preventDefault();
    }
  });

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-search]')) {
      closeSearch();
      return;
    }
    const focusButton = event.target.closest('[data-focus-group]');
    if (focusButton) {
      state.focusGroup = focusButton.getAttribute('data-focus-group') || '';
      state.activeIndex = 0;
      runSearch();
      dom.input.focus();
      return;
    }
    if (event.target.closest('.suite-search__jump')) return;
    const row = event.target.closest('.suite-search__row');
    if (row) activate(flatResults()[Number(row.getAttribute('data-index'))]);
  });

  root.addEventListener('mousemove', (event) => {
    const row = event.target.closest('.suite-search__row');
    if (!row) return;
    const index = Number(row.getAttribute('data-index'));
    if (index === state.activeIndex) return;
    state.activeIndex = index;
    dom.list.querySelectorAll('.suite-search__row').forEach((item) => {
      const active = Number(item.getAttribute('data-index')) === index;
      item.classList.toggle('suite-search__row--active', active);
      item.setAttribute('aria-selected', String(active));
    });
  });
}

export function openSearch(initialQuery = '') {
  buildDom();
  if (state.open) return;
  state.open = true;
  state.lastFocused = document.activeElement;
  state.query = initialQuery;
  state.activeIndex = 0;
  state.focusGroup = '';
  dom.input.value = initialQuery;
  dom.root.hidden = false;
  document.documentElement.classList.add('suite-search-open');
  runSearch();
  ensureIndex();
  requestAnimationFrame(() => dom.input.focus());
}

export function closeSearch() {
  if (!state.open) return;
  state.open = false;
  dom.root.hidden = true;
  document.documentElement.classList.remove('suite-search-open');
  if (state.lastFocused && typeof state.lastFocused.focus === 'function') {
    state.lastFocused.focus();
  }
}

function isTypingTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function labelTriggers() {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  document.querySelectorAll('[data-suite-search-hint]').forEach((hint) => {
    hint.textContent = isMac ? '⌘K' : 'Ctrl K';
  });
}

function init() {
  if (window.__gatewaySuiteShell) return;
  window.__gatewaySuiteShell = true;
  ensureStylesheet();
  labelTriggers();
  // On small screens the nav is a swipeable row; start it on the current app.
  const links = document.querySelector('.suite-nav__links');
  const active = links?.querySelector('[aria-current="page"]');
  if (links && active && links.scrollWidth > links.clientWidth) {
    links.scrollLeft = Math.max(0, active.offsetLeft - links.offsetLeft - 56);
  }

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === 'k') {
      event.preventDefault();
      if (state.open) closeSearch();
      else openSearch();
      return;
    }
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !state.open && !isTypingTarget(event.target)) {
      event.preventDefault();
      openSearch();
    }
  });

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-suite-search]');
    if (!trigger) return;
    event.preventDefault();
    openSearch();
  });
}

init();
