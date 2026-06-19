import {
  applySuiteNav,
  buildScopeEmptyStateHtml,
  buildScopePillHtml,
  buildSuiteHref,
  getSharedContextEntries,
  hasSharedContext,
  loadSuiteCrosswalk,
  mergeQueryState,
  readSharedContext,
  resolveScope,
  resolveScopeFromSelection,
  wbsIsScope,
} from '../suite-assets/suite-context.js';

const DATA_URL = './data/documents.json';
const CROSSWALK_URL = '../suite-assets/data/gateway-crosswalk.json';

const state = {
  allDocuments: [],
  visibleDocuments: [],
  selectedDocumentId: null,
  searchQuery: '',
  fileType: '',
  category: '',
  loadState: 'loading',
  loadError: '',
  crosswalk: null,
  sharedContext: {},
  context: null,
};

const elements = {};
const SOURCE_LABELS = {
  simulation: 'Simulation',
  wbs: 'WBS',
  schedule: 'Schedule',
  cost: 'Cost',
  risk: 'Risk',
  documents: 'Documents',
};

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSearchIndex(documentRecord) {
  return [
    documentRecord.title,
    documentRecord.filename,
    documentRecord.category,
    documentRecord.shortDescription,
    ...(Array.isArray(documentRecord.tags) ? documentRecord.tags : []),
  ]
    .map((value) => normalizeText(value))
    .join(' ');
}

export function filterDocuments(documents, filters = {}) {
  const query = normalizeText(filters.searchQuery);
  const fileType = normalizeText(filters.fileType);
  const category = normalizeText(filters.category);

  return documents.filter((documentRecord) => {
    const matchesQuery = !query || getSearchIndex(documentRecord).includes(query);
    const matchesFileType =
      !fileType || normalizeText(documentRecord.fileType) === fileType;
    const matchesCategory =
      !category || normalizeText(documentRecord.category) === category;

    return matchesQuery && matchesFileType && matchesCategory;
  });
}

function openDocumentHref(relativePath) {
  return `../${encodeURI(relativePath)}`;
}

function buildDocumentUseNote(documentRecord) {
  switch (documentRecord.category) {
    case 'Program Reference':
      return 'This document defines program scope, structure, or estimating context used across Gateway.';
    case 'WBS Dataset':
      return 'This dataset lays out the Gateway work breakdown and responsibility structure.';
    case 'Cost Dataset':
      return 'This dataset supports cost rollups, detail rows, and yearly phasing for Gateway.';
    case 'Contract Pricing Dataset':
      return 'This dataset preserves priced contract evidence used to anchor parts of the estimate.';
    case 'Schedule Dataset':
      return 'This dataset supports milestone and task-level schedule analysis for Gateway.';
    case 'Risk Dataset':
      return 'This dataset captures the risk issues and mitigation actions tied to Gateway execution.';
    case 'Document Control Dataset':
      return 'This tracker links controlled documents to the program structure, milestones, and supporting evidence.';
    case 'Reference Dataset':
      return 'This reference file helps interpret the broader set of Gateway source material.';
    default:
      return 'This document is part of the Gateway source library and provides supporting program context.';
  }
}

function getScope() {
  if (!wbsIsScope(state.sharedContext)) return null;
  return resolveScope(state.crosswalk, state.sharedContext?.wbs);
}

// Selection drives the suite scope only for an explicitly element-specific
// document: exactly one element WBS id. Program-wide docs (the whole current
// library) and multi-element docs with no single primary never auto-scope, so
// the current scope is left unchanged.
function applySelectionScope(documentId) {
  const elementWbsIds = state.crosswalk?.documents?.byId?.[documentId]?.elementWbsIds || [];
  if (elementWbsIds.length !== 1) return;
  const wbsId = resolveScopeFromSelection(state.crosswalk, elementWbsIds[0]);
  if (!wbsId) return;
  state.sharedContext = { wbs: wbsId, scope: '1' };
}

// Element-specific (linked) docs for a scope: only documents the crosswalk
// classified as naming a WBS element in the scope's subtree (explicit signal,
// never inferred). Everything else is program-wide. With the current source
// library every document is program-wide, so this set is honestly empty.
function collectElementDocIds(scope) {
  const linked = new Set();
  Object.values(state.crosswalk?.documents?.byId || {}).forEach((documentRecord) => {
    if ((documentRecord.elementWbsIds || []).some((wbsId) => scope.has(wbsId))) {
      linked.add(documentRecord.id);
    }
  });
  return linked;
}

function deriveDocumentContext() {
  const shared = state.sharedContext || {};
  const docCatalog = state.crosswalk?.documents?.byId || {};
  if (!hasSharedContext(shared)) return null;

  // An active WBS scope wins over derived contexts. Library files without a
  // WBS relation stay visible under a labeled program-wide section instead of
  // disappearing. A `wbs` is an active scope when it is bare or carries the
  // `scope=1` marker; a `wbs` riding with an item id but no marker is a derived
  // association, so we fall through and center on the item instead.
  if (wbsIsScope(shared)) {
    const scope = getScope();
    const wbsContext = state.crosswalk?.wbs?.byId?.[shared.wbs];
    return {
      scoped: true,
      title: `Documents linked to WBS ${shared.wbs}${scope?.name ? ` ${scope.name}` : ''}`,
      body: wbsContext?.documents.reason || `WBS ${shared.wbs} is not in the current crosswalk.`,
      sourceDocIds: [],
      scopedDocIds: collectElementDocIds(scope),
      controlDocuments: wbsContext?.documents.controlDocuments || [],
      wbsId: shared.wbs,
      milestoneId: wbsContext?.schedule.primaryMilestoneId || '',
      riskId: wbsContext?.risks.primaryRiskId || '',
      moduleKey: wbsContext?.simulation.moduleKeys?.[0] || '',
    };
  }

  if (shared.milestone) {
    const milestoneContext = state.crosswalk?.schedule?.byMilestoneId?.[shared.milestone];
    if (milestoneContext) {
      return {
        title: milestoneContext.primaryWbsId
          ? `Showing documents related to WBS ${milestoneContext.primaryWbsId}`
          : `Showing documents related to milestone ${shared.milestone}`,
        body: milestoneContext.reason,
        sourceDocIds: milestoneContext.documents.sourceDocIds || [],
        controlDocuments: milestoneContext.documents.controlDocuments || [],
        wbsId: milestoneContext.primaryWbsId || '',
        milestoneId: shared.milestone,
        riskId: milestoneContext.risks.ids?.[0] || '',
        moduleKey: milestoneContext.simulation.moduleKeys?.[0] || '',
      };
    }
  }

  if (shared.risk) {
    const riskContext = state.crosswalk?.risk?.byId?.[shared.risk];
    if (riskContext) {
      return {
        title: `Showing documents related to risk ${shared.risk}`,
        body: riskContext.reason,
        sourceDocIds: riskContext.documents.sourceDocIds || [],
        controlDocuments: riskContext.documents.controlDocuments || [],
        wbsId: riskContext.primaryWbsId || '',
        milestoneId: riskContext.primaryMilestoneId || '',
        riskId: shared.risk,
        moduleKey: riskContext.simulation.moduleKeys?.[0] || '',
      };
    }
  }

  if (shared.module) {
    const moduleContext = state.crosswalk?.simulation?.byModuleKey?.[shared.module];
    if (moduleContext) {
      return {
        title: `Showing documents related to ${shared.module}`,
        body: moduleContext.note,
        sourceDocIds: moduleContext.documents.sourceDocIds || [],
        controlDocuments: moduleContext.documents.controlDocuments || [],
        wbsId: moduleContext.primaryWbsId || '',
        milestoneId: moduleContext.primaryMilestoneId || '',
        riskId: moduleContext.primaryRiskId || '',
        moduleKey: shared.module,
      };
    }
  }

  const selectedDoc = shared.doc && docCatalog[shared.doc] ? shared.doc : '';
  if (!selectedDoc) return null;

  return {
    title: `Showing ${docCatalog[selectedDoc].title}`,
    body: 'This document was selected directly from another suite view.',
    sourceDocIds: [],
    controlDocuments: [],
    wbsId: '',
    milestoneId: '',
    riskId: '',
    moduleKey: '',
  };
}

function buildSuiteAction(route, label, params) {
  return `
    <a class="suite-context-action" href="${escapeHtml(buildSuiteHref(route, params))}">
      ${escapeHtml(label)}
    </a>
  `;
}

// Top suite nav carries only the origin and an explicitly set scope. It never
// derives wbs/milestone/risk/doc/module from the current selection.
function buildTopNavContext() {
  return {
    from: 'documents',
    wbs: getScope()?.id || '',
  };
}

function syncSuiteNavigation() {
  applySuiteNav(buildTopNavContext(), { currentRoute: 'documents' });
}

function syncUrlState() {
  const defaultDocumentId = state.visibleDocuments[0]?.id || state.allDocuments[0]?.id || '';
  const shouldPersistDocumentId =
    hasSharedContext(state.sharedContext) ||
    Boolean(state.searchQuery) ||
    Boolean(state.fileType) ||
    Boolean(state.category) ||
    (state.selectedDocumentId && state.selectedDocumentId !== defaultDocumentId);

  mergeQueryState({
    ...getSharedContextEntries(state.sharedContext),
    doc: shouldPersistDocumentId ? state.selectedDocumentId || '' : '',
  });
}

function getSelectedDocument() {
  if (!state.selectedDocumentId) return null;
  return (
    state.visibleDocuments.find(
      (documentRecord) => documentRecord.id === state.selectedDocumentId,
    ) || null
  );
}

function renderFilters(documents) {
  const fileTypes = Array.from(
    new Set(documents.map((documentRecord) => documentRecord.fileType).filter(Boolean)),
  ).sort();
  const categories = Array.from(
    new Set(documents.map((documentRecord) => documentRecord.category).filter(Boolean)),
  ).sort();

  elements.typeFilter.innerHTML =
    '<option value="">All file types</option>' +
    fileTypes
      .map((fileType) => `<option value="${fileType}">${fileType}</option>`)
      .join('');

  elements.categoryFilter.innerHTML =
    '<option value="">All categories</option>' +
    categories
      .map((category) => `<option value="${category}">${category}</option>`)
      .join('');

  elements.categoryCount.textContent = String(categories.length);
  elements.fileTypeCount.textContent = String(fileTypes.length);
  elements.typeFilter.value = state.fileType;
  elements.categoryFilter.value = state.category;
}

function renderActiveFilters() {
  const chips = [];

  if (state.searchQuery) chips.push(`Search: ${state.searchQuery}`);
  if (state.fileType) chips.push(`Type: ${state.fileType}`);
  if (state.category) chips.push(`Category: ${state.category}`);
  if (state.context?.wbsId) chips.push(`Context: WBS ${state.context.wbsId}`);
  if (state.context?.milestoneId) chips.push(`Milestone: ${state.context.milestoneId}`);
  if (state.context?.riskId) chips.push(`Risk: ${state.context.riskId}`);

  if (!chips.length) {
    elements.activeFilters.innerHTML = '';
    return;
  }

  elements.activeFilters.innerHTML = chips
    .map((label) => `<span class="filter-chip">${label}</span>`)
    .join('');
}

function renderContextBanner() {
  if (!elements.contextBannerHost) return;
  if (!state.context || !hasSharedContext(state.sharedContext)) {
    elements.contextBannerHost.innerHTML = '';
    return;
  }

  const scope = state.context.scoped ? getScope() : null;
  if (scope) {
    const linkedCount = (state.context.scopedDocIds || new Set()).size;
    const programWideCount = Math.max(state.allDocuments.length - linkedCount, 0);
    const note = linkedCount
      ? `${linkedCount} linked, ${programWideCount} program-wide`
      : 'No element-specific sources; the library is program-wide for this element';
    elements.contextBannerHost.innerHTML = buildScopePillHtml(scope, { note });
    return;
  }

  const chips = [];
  const sourceLabel = SOURCE_LABELS[state.sharedContext.from] || '';
  if (sourceLabel) {
    chips.push(`<span class="suite-context-chip"><strong>From</strong>${escapeHtml(sourceLabel)}</span>`);
  }
  if (state.context.wbsId) {
    chips.push(`<span class="suite-context-chip"><strong>WBS</strong>${escapeHtml(state.context.wbsId)}</span>`);
  }
  if (state.context.milestoneId) {
    chips.push(`<span class="suite-context-chip"><strong>Milestone</strong>${escapeHtml(state.context.milestoneId)}</span>`);
  }
  if (state.context.riskId) {
    chips.push(`<span class="suite-context-chip"><strong>Risk</strong>${escapeHtml(state.context.riskId)}</span>`);
  }
  if (state.context.moduleKey) {
    chips.push(`<span class="suite-context-chip"><strong>Module</strong>${escapeHtml(state.context.moduleKey)}</span>`);
  }

  elements.contextBannerHost.innerHTML = `
    <section class="suite-context-banner">
      <p class="suite-context-banner__eyebrow">Cross-App Context</p>
      <h3 class="suite-context-banner__title">${escapeHtml(state.context.title || 'Document context')}</h3>
      <p class="suite-context-banner__body">${escapeHtml(state.context.body || 'Showing the source material tied to what you were viewing elsewhere in the suite.')}</p>
      <div class="suite-context-banner__chips">
        ${chips.join('')}
      </div>
      <div class="suite-context-actions">
        <button class="suite-context-action" type="button" data-action="reset-view">Reset view</button>
      </div>
    </section>
  `;
}

function renderList() {
  const selectedDocument = getSelectedDocument();
  const documents = state.visibleDocuments;

  elements.visibleCount.textContent = documents.length
    ? documents.length === state.allDocuments.length
      ? String(documents.length)
      : `${documents.length}/${state.allDocuments.length}`
    : '0';
  elements.headerCount.textContent =
    documents.length === state.allDocuments.length
      ? `${state.allDocuments.length} documents`
      : `${documents.length} of ${state.allDocuments.length} documents`;

  elements.resultsLabel.textContent =
    documents.length === 1 ? '1 result' : `${documents.length} results`;

  if (state.loadState === 'error') {
    elements.listState.hidden = false;
    elements.listState.innerHTML =
      `<strong>Unable to load the document library.</strong><br />${state.loadError}`;
    elements.documentList.innerHTML = '';
    elements.resultsLabel.textContent = 'Load error';
    return;
  }

  if (!documents.length) {
    elements.listState.hidden = false;
    elements.listState.innerHTML =
      '<strong>No matching documents.</strong><br />Try a broader search, another category, or a different file type.';
    elements.documentList.innerHTML = '';
    return;
  }

  elements.listState.hidden = true;
  elements.listState.textContent = '';

  const renderDocumentButton = (documentRecord) => {
    const isSelected = selectedDocument?.id === documentRecord.id;
    const summaryTags = documentRecord.tags.slice(0, 3);

    return `
      <button
        class="document-item${isSelected ? ' is-selected' : ''}"
        type="button"
        data-document-id="${documentRecord.id}"
        role="option"
        aria-selected="${String(isSelected)}"
      >
        <div class="document-item__meta">
          <span class="file-badge">${documentRecord.fileType}</span>
          <span class="meta-chip">${documentRecord.category}</span>
        </div>
        <h3 class="document-item__title">${documentRecord.title}</h3>
        <p class="document-item__description">${documentRecord.shortDescription}</p>
        <div class="document-item__footer">
          ${summaryTags.map((tag) => `<span class="tag-chip">${tag}</span>`).join('')}
        </div>
      </button>
    `;
  };

  const scope = state.context?.scoped ? getScope() : null;
  if (!scope) {
    elements.documentList.innerHTML = documents.map(renderDocumentButton).join('');
    return;
  }

  const scopedDocIds = state.context.scopedDocIds || new Set();
  const linkedDocuments = documents.filter((documentRecord) => scopedDocIds.has(documentRecord.id));
  const programWideDocuments = documents.filter((documentRecord) => !scopedDocIds.has(documentRecord.id));

  // With no element-specific docs, the program-wide library is all there is, so
  // render it plainly and expanded - no "Linked (0)" header that would imply a
  // filter that does not exist. Otherwise lead with the linked docs and tuck the
  // program-wide library behind a collapsed, labeled summary.
  if (!linkedDocuments.length) {
    elements.documentList.innerHTML = `
      <p class="list-group-label">Program-wide sources (${programWideDocuments.length})</p>
      ${programWideDocuments.map(renderDocumentButton).join('')}
    `;
    return;
  }

  elements.documentList.innerHTML = `
    <p class="list-group-label">Linked to WBS ${escapeHtml(scope.id)} (${linkedDocuments.length})</p>
    ${linkedDocuments.map(renderDocumentButton).join('')}
    <details class="doc-program-wide">
      <summary class="doc-program-wide__summary">
        <span class="list-group-label">Program-wide sources (${programWideDocuments.length})</span>
        <span class="doc-program-wide__chevron" aria-hidden="true">▾</span>
      </summary>
      <div class="doc-program-wide__list">
        ${programWideDocuments.map(renderDocumentButton).join('')}
      </div>
    </details>
  `;
}

function renderDetailEmptyState(eyebrow, title, body) {
  elements.detailPaneContent.innerHTML = `
    <div class="detail-empty">
      <div>
        <p class="detail-empty__eyebrow">${escapeHtml(eyebrow)}</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(body)}</p>
      </div>
    </div>
  `;
}

function renderDetailCard(documentRecord) {
  const tags = Array.isArray(documentRecord.tags) ? documentRecord.tags : [];
  const detailUseNote = buildDocumentUseNote(documentRecord);
  const trackedRecords = Array.isArray(state.context?.controlDocuments) ? state.context.controlDocuments : [];

  elements.detailPaneContent.innerHTML = `
    <article class="detail-card">
      <header class="detail-card__hero">
        <div class="detail-card__hero-copy">
          <p class="detail-card__eyebrow">${escapeHtml(documentRecord.category)}</p>
          <h2>${escapeHtml(documentRecord.title)}</h2>
          <p class="detail-card__description">${escapeHtml(documentRecord.shortDescription)}</p>
        </div>
        <div class="detail-card__hero-actions">
          <span class="file-badge">${escapeHtml(documentRecord.fileType)}</span>
          <a
            class="primary-button"
            href="${escapeHtml(openDocumentHref(documentRecord.relativePath))}"
            target="_blank"
            rel="noreferrer"
          >
            Open Document
          </a>
        </div>
      </header>

      ${
        state.context?.title
          ? `
            <details class="cross-app-collapsed">
              <summary class="cross-app-collapsed__summary">
                <span>Open this document elsewhere</span>
                <span class="cross-app-collapsed__chevron" aria-hidden="true">▾</span>
              </summary>
              <div class="cross-app-collapsed__actions">
                ${buildSuiteAction('wbs', 'Open in WBS', {
                  from: 'documents',
                  wbs: getScope()?.id || '',
                  scope: getScope() ? '1' : '',
                  doc: documentRecord.id,
                })}
                ${buildSuiteAction('schedule', 'Open in Schedule', {
                  from: 'documents',
                  wbs: getScope()?.id || '',
                  scope: getScope() ? '1' : '',
                  milestone: state.context.milestoneId || '',
                  doc: documentRecord.id,
                })}
                ${buildSuiteAction('cost', 'Open in Cost', {
                  from: 'documents',
                  wbs: getScope()?.id || '',
                  scope: getScope() ? '1' : '',
                  doc: documentRecord.id,
                  view: 'module',
                })}
                ${buildSuiteAction('risk', 'Open in Risk', {
                  from: 'documents',
                  wbs: getScope()?.id || '',
                  scope: getScope() ? '1' : '',
                  risk: state.context.riskId || '',
                  doc: documentRecord.id,
                })}
              </div>
            </details>
          `
          : ''
      }

      <section class="detail-grid" aria-label="Document metadata">
        <div class="detail-meta-card">
          <p class="detail-meta-card__label">Filename</p>
          <code>${escapeHtml(documentRecord.filename)}</code>
        </div>
        <div class="detail-meta-card">
          <p class="detail-meta-card__label">Relative Path</p>
          <code>${escapeHtml(documentRecord.relativePath)}</code>
        </div>
        <div class="detail-meta-card">
          <p class="detail-meta-card__label">Category</p>
          <span>${escapeHtml(documentRecord.category)}</span>
        </div>
        <div class="detail-meta-card">
          <p class="detail-meta-card__label">Document ID</p>
          <code>${escapeHtml(documentRecord.id)}</code>
        </div>
      </section>

      <section class="detail-section">
        <div class="detail-section__header">
          <p class="detail-section__eyebrow">Program use</p>
          <h3>Why this document matters</h3>
        </div>
        <p class="detail-section__body">${escapeHtml(detailUseNote)}</p>
      </section>

      ${
        trackedRecords.length
          ? `
            <section class="detail-section">
              <div class="detail-section__header">
                <p class="detail-section__eyebrow">Tracked records</p>
                <h3>Controlled records behind this context</h3>
              </div>
              <div class="suite-context-list">
                ${trackedRecords
                  .slice(0, 6)
                  .map(
                    (record) => `
                      <article class="suite-context-list__item">
                        <p class="suite-context-list__meta">${escapeHtml(`${record.id} · ${record.type}`)}</p>
                        <h4 class="suite-context-list__title">${escapeHtml(record.name)}</h4>
                        <p class="suite-context-list__copy">${escapeHtml(record.notes || `${record.status} · ${record.owner}`)}</p>
                      </article>
                    `,
                  )
                  .join('')}
              </div>
            </section>
          `
          : ''
      }

      <section class="detail-section">
        <div class="detail-section__header">
          <p class="detail-section__eyebrow">Tags</p>
          <h3>Search tags</h3>
        </div>
        <div class="tag-row">
          ${tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </section>
    </article>
  `;
}

function renderDetail() {
  if (state.loadState === 'error') {
    renderDetailEmptyState(
      'Load Error',
      'Unable to load documents.',
      state.loadError,
    );
    return;
  }

  const selectedDocument = getSelectedDocument();

  if (!selectedDocument) {
    renderDetailEmptyState(
      'No Results',
      'No documents match the current filters.',
      'Try a broader search, another category, or a different file type to repopulate the detail pane.',
    );
    return;
  }

  renderDetailCard(selectedDocument);
}

function syncSelectedDocumentId() {
  if (!state.visibleDocuments.length) {
    state.selectedDocumentId = null;
    return;
  }

  const selectedStillVisible = state.visibleDocuments.some(
    (documentRecord) => documentRecord.id === state.selectedDocumentId,
  );

  if (!selectedStillVisible) {
    state.selectedDocumentId = state.visibleDocuments[0].id;
  }
}

function updateVisibleDocuments() {
  // A scope keeps every document visible (grouped into linked vs program-wide
  // sections in the list); derived contexts keep their narrower filter.
  const baseDocuments =
    !state.context?.scoped && state.context?.sourceDocIds?.length
      ? state.allDocuments.filter((documentRecord) => state.context.sourceDocIds.includes(documentRecord.id))
      : state.allDocuments;

  state.visibleDocuments = filterDocuments(baseDocuments, {
    searchQuery: state.searchQuery,
    fileType: state.fileType,
    category: state.category,
  });

  syncSelectedDocumentId();
}

function render() {
  renderContextBanner();
  renderActiveFilters();
  renderList();
  renderDetail();
  syncUrlState();
  syncSuiteNavigation();
}

function resetView() {
  state.searchQuery = '';
  state.fileType = '';
  state.category = '';
  state.sharedContext = {};
  state.context = null;
  state.selectedDocumentId = null;
  elements.searchInput.value = '';
  elements.typeFilter.value = '';
  elements.categoryFilter.value = '';
  updateVisibleDocuments();
  render();
}

function clearScope() {
  if (!state.sharedContext?.wbs) return;
  delete state.sharedContext.wbs;
  delete state.sharedContext.scope;
  state.context = deriveDocumentContext();
  updateVisibleDocuments();
  render();
}

function setScope(wbsId) {
  if (!wbsId) return;
  state.sharedContext.wbs = wbsId;
  state.context = deriveDocumentContext();
  updateVisibleDocuments();
  render();
}

function handleListClick(event) {
  const parentControl = event.target.closest('[data-action="scope-view-parent"]');
  if (parentControl) {
    setScope(parentControl.getAttribute('data-parent-id'));
    return;
  }
  if (event.target.closest('[data-action="clear-scope"]')) {
    clearScope();
    return;
  }

  const button = event.target.closest('[data-document-id]');
  if (!button) return;

  const documentId = button.getAttribute('data-document-id');
  state.selectedDocumentId = documentId;
  // Selection drives scope only for genuinely element-specific documents.
  // Program-wide docs (the entire current library) never scope, and a doc with
  // multiple element WBS ids and no single primary does not auto-scope either.
  applySelectionScope(documentId);
  state.context = deriveDocumentContext();
  updateVisibleDocuments();
  syncSelectedDocumentId();
  render();
}

function attachEvents() {
  elements.searchInput.addEventListener('input', (event) => {
    state.searchQuery = event.target.value.trim();
    updateVisibleDocuments();
    render();
  });

  elements.typeFilter.addEventListener('change', (event) => {
    state.fileType = event.target.value;
    updateVisibleDocuments();
    render();
  });

  elements.categoryFilter.addEventListener('change', (event) => {
    state.category = event.target.value;
    updateVisibleDocuments();
    render();
  });

  elements.clearFiltersButton.addEventListener('click', resetView);

  elements.contextBannerHost.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="clear-scope"]')) {
      clearScope();
      return;
    }
    if (event.target.closest('[data-action="reset-view"]')) {
      resetView();
    }
  });

  elements.documentList.addEventListener('click', handleListClick);
}

function cacheElements() {
  elements.appTitle = document.getElementById('appTitle');
  elements.searchInput = document.getElementById('searchInput');
  elements.headerCount = document.getElementById('headerCount');
  elements.typeFilter = document.getElementById('typeFilter');
  elements.categoryFilter = document.getElementById('categoryFilter');
  elements.clearFiltersButton = document.getElementById('clearFiltersButton');
  elements.visibleCount = document.getElementById('visibleCount');
  elements.categoryCount = document.getElementById('categoryCount');
  elements.fileTypeCount = document.getElementById('fileTypeCount');
  elements.resultsLabel = document.getElementById('resultsLabel');
  elements.activeFilters = document.getElementById('activeFilters');
  elements.contextBannerHost = document.getElementById('contextBannerHost');
  elements.listState = document.getElementById('listState');
  elements.documentList = document.getElementById('documentList');
  elements.detailPaneContent = document.getElementById('detailPaneContent');
}

async function loadManifest() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Unable to load document manifest (${response.status})`);
  }

  return response.json();
}

function initializeFromManifest(manifest) {
  state.allDocuments = Array.isArray(manifest.documents) ? manifest.documents : [];
  state.context = deriveDocumentContext();
  state.selectedDocumentId =
    hasSharedContext(state.sharedContext) && state.sharedContext.doc
      ? state.sharedContext.doc
      : state.allDocuments[0]?.id || null;
  state.loadState = 'ready';
  state.loadError = '';
  elements.appTitle.textContent = manifest.appTitle || 'Documents Explorer';
  renderFilters(state.allDocuments);
  updateVisibleDocuments();
  render();
}

function renderFatalError(message) {
  state.loadState = 'error';
  state.loadError = message;
  state.allDocuments = [];
  state.visibleDocuments = [];
  state.selectedDocumentId = null;
  render();
}

async function initializeApp() {
  cacheElements();
  attachEvents();

  try {
    const [manifest, crosswalk] = await Promise.all([
      loadManifest(),
      loadSuiteCrosswalk(CROSSWALK_URL),
    ]);
    state.crosswalk = crosswalk;
    state.sharedContext = readSharedContext();
    initializeFromManifest(manifest);
  } catch (error) {
    console.error('Failed to load documents.json', error);
    renderFatalError(error instanceof Error ? error.message : 'Unknown error');
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initializeApp);
}
