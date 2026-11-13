import {
  applySuiteNav,
  buildOpenInHtml,
  buildScopeEmptyStateHtml,
  buildScopePillHtml,
  buildSuiteHref,
  getSharedContextEntries,
  hasSharedContext,
  loadSuiteCrosswalk,
  mergeQueryState,
  readSharedContext,
  resolveScope,
} from '../suite-assets/suite-context.js';

const DATA_URL = './data/risks.json';
const CROSSWALK_URL = '../suite-assets/data/gateway-crosswalk.json';

const state = {
  allRisks: [],
  visibleRisks: [],
  selectedRiskId: null,
  searchQuery: '',
  category: '',
  status: '',
  priorityBand: '',
  matrixCell: null,
  sortBy: 'priority_desc',
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
  overview: 'Overview',
  confidence: 'Confidence',
  search: 'Search',
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

function priorityBand(priority) {
  if (priority >= 16) return 'critical';
  if (priority >= 12) return 'high';
  if (priority >= 8) return 'moderate';
  return 'watch';
}

function categoryBand(category) {
  switch (normalizeText(category)) {
    case 'technical':
      return 'technical';
    case 'schedule integration':
      return 'schedule';
    case 'programmatic':
      return 'programmatic';
    case 'mission operations':
      return 'operations';
    default:
      return 'default';
  }
}

function priorityLabel(priority) {
  switch (priorityBand(priority)) {
    case 'critical':
      return 'Critical';
    case 'high':
      return 'High';
    case 'moderate':
      return 'Moderate';
    default:
      return 'Watch';
  }
}

function priorityBandLabel(band) {
  switch (band) {
    case 'critical':
      return 'Critical';
    case 'high':
      return 'High';
    case 'moderate':
      return 'Moderate';
    default:
      return 'Watch';
  }
}

function bandRangeText(band) {
  switch (band) {
    case 'critical':
      return '16-25 score range';
    case 'high':
      return '12-15 score range';
    case 'moderate':
      return '8-11 score range';
    default:
      return '1-7 score range';
  }
}

function confidenceLabel(confidenceLevel) {
  const value = String(confidenceLevel ?? '').trim();
  if (!value) return '';
  const joined = value.split('_').join('-');
  return `${joined[0].toUpperCase()}${joined.slice(1)} confidence`;
}

function basisLabel(basisType) {
  const value = String(basisType ?? '').trim();
  if (!value) return '';
  const joined = value.split('_').join(' ');
  return `${joined[0].toUpperCase()}${joined.slice(1)}`;
}

function riskSearchIndex(risk) {
  return [
    risk.id,
    risk.title,
    risk.category,
    risk.owner,
    risk.description,
    risk.mitigation,
    risk.status,
    ...(Array.isArray(risk.tags) ? risk.tags : []),
  ]
    .map((value) => normalizeText(value))
    .join(' ');
}

function getScope() {
  return resolveScope(state.crosswalk, state.sharedContext?.wbs);
}

function deriveRiskContext() {
  const shared = state.sharedContext || {};
  if (!hasSharedContext(shared)) return null;

  // An explicit WBS scope wins over every derived context. The scoped base
  // list is exactly the crosswalk node's risk union - never silently widened.
  if (shared.wbs) {
    const scope = getScope();
    const directContext = state.crosswalk?.wbs?.byId?.[shared.wbs];
    return {
      scoped: true,
      title: `${directContext?.risks.ids.length || 0} of ${state.allRisks.length} risks linked to WBS ${shared.wbs}${scope?.name ? ` ${scope.name}` : ''}`,
      body: directContext?.risks.reason || `WBS ${shared.wbs} is not in the current crosswalk.`,
      wbsId: shared.wbs,
      milestoneId: directContext?.schedule.primaryMilestoneId || '',
      riskIds: directContext?.risks.ids || [],
      docId: directContext?.documents.sourceDocIds?.[0] || '',
      moduleKey: directContext?.simulation.moduleKeys?.[0] || '',
    };
  }

  if (shared.milestone) {
    const milestoneContext = state.crosswalk?.schedule?.byMilestoneId?.[shared.milestone];
    if (milestoneContext) {
      return {
        title: milestoneContext.primaryWbsId
          ? `Showing risks related to WBS ${milestoneContext.primaryWbsId}`
          : `Showing risks related to milestone ${shared.milestone}`,
        body: milestoneContext.reason,
        wbsId: milestoneContext.primaryWbsId || '',
        milestoneId: shared.milestone,
        riskIds: milestoneContext.risks.ids || [],
        docId: milestoneContext.documents.sourceDocIds?.[0] || '',
        moduleKey: milestoneContext.simulation.moduleKeys?.[0] || '',
      };
    }
  }

  if (shared.module) {
    const moduleContext = state.crosswalk?.simulation?.byModuleKey?.[shared.module];
    const moduleWbsContext = moduleContext?.primaryWbsId
      ? state.crosswalk?.wbs?.byId?.[moduleContext.primaryWbsId]
      : null;
    if (moduleWbsContext) {
      return {
        title: `Showing risks related to ${shared.module}`,
        body: moduleContext.note,
        wbsId: moduleWbsContext.id,
        milestoneId: moduleWbsContext.schedule.primaryMilestoneId || '',
        riskIds: moduleWbsContext.risks.ids,
        docId: moduleWbsContext.documents.sourceDocIds?.[0] || '',
        moduleKey: shared.module,
      };
    }
  }

  if (shared.risk) {
    const riskContext = state.crosswalk?.risk?.byId?.[shared.risk];
    if (riskContext) {
      return {
        title: `Showing risk ${shared.risk}`,
        body: riskContext.reason,
        wbsId: riskContext.primaryWbsId || '',
        milestoneId: riskContext.primaryMilestoneId || '',
        riskIds: [],
        docId: riskContext.documents.sourceDocIds?.[0] || '',
        moduleKey: riskContext.simulation.moduleKeys?.[0] || '',
      };
    }
  }

  return null;
}

// Item-level "Open in X" links only: an explicit scope wins, otherwise the
// risk's own derived context fills in. Never used for the top suite nav.
function navWbsValue(riskContext = null) {
  return getScope()?.id || riskContext?.primaryWbsId || state.context?.wbsId || '';
}

// Top suite nav carries only the origin and an explicitly set scope. It never
// derives wbs/milestone/risk/doc/module from the current selection.
function buildTopNavContext() {
  return {
    from: 'risk',
    wbs: getScope()?.id || '',
  };
}

function syncSuiteNavigation() {
  applySuiteNav(buildTopNavContext(), { currentRoute: 'risk' });
}

function syncUrlState() {
  const defaultRiskId = state.visibleRisks[0]?.id || state.allRisks[0]?.id || '';
  const shouldPersistRiskId =
    hasSharedContext(state.sharedContext) ||
    Boolean(state.searchQuery) ||
    Boolean(state.category) ||
    Boolean(state.status) ||
    Boolean(state.priorityBand) ||
    Boolean(state.matrixCell) ||
    state.sortBy !== 'priority_desc' ||
    (state.selectedRiskId && state.selectedRiskId !== defaultRiskId);

  mergeQueryState({
    ...getSharedContextEntries(state.sharedContext),
    risk: shouldPersistRiskId ? state.selectedRiskId || '' : '',
    cell: state.matrixCell ? `${state.matrixCell.likelihood}x${state.matrixCell.impact}` : '',
  });
}

export function filterRisks(risks, filters = {}) {
  const query = normalizeText(filters.searchQuery);
  const category = normalizeText(filters.category);
  const status = normalizeText(filters.status);
  const selectedPriorityBand = normalizeText(filters.priorityBand);

  return risks.filter((risk) => {
    const matchesQuery = !query || riskSearchIndex(risk).includes(query);
    const matchesCategory = !category || normalizeText(risk.category) === category;
    const matchesStatus = !status || normalizeText(risk.status) === status;
    const matchesPriority =
      !selectedPriorityBand || priorityBand(Number(risk.priority)) === selectedPriorityBand;
    const matchesCell =
      !filters.cell ||
      (Number(risk.likelihood) === filters.cell.likelihood && Number(risk.impact) === filters.cell.impact);

    return matchesQuery && matchesCategory && matchesStatus && matchesPriority && matchesCell;
  });
}

const BAND_ORDER = ['critical', 'high', 'moderate', 'watch'];

function bandRank(risk) {
  return BAND_ORDER.indexOf(priorityBand(Number(risk.priority)));
}

export function sortRisks(risks, sortBy = 'priority_desc') {
  const clone = [...risks];

  clone.sort((left, right) => {
    if (sortBy === 'impact_desc') {
      return (
        Number(right.impact) - Number(left.impact) ||
        Number(right.priority) - Number(left.priority) ||
        left.title.localeCompare(right.title)
      );
    }

    if (sortBy === 'likelihood_desc') {
      return (
        Number(right.likelihood) - Number(left.likelihood) ||
        Number(right.priority) - Number(left.priority) ||
        left.title.localeCompare(right.title)
      );
    }

    if (sortBy === 'title_asc') {
      return left.title.localeCompare(right.title);
    }

    // Default order groups by band, then applies the deterministic
    // within-band tiebreak: impact desc, likelihood desc, id asc.
    return (
      bandRank(left) - bandRank(right) ||
      Number(right.impact) - Number(left.impact) ||
      Number(right.likelihood) - Number(left.likelihood) ||
      left.id.localeCompare(right.id)
    );
  });

  return clone;
}

function getSelectedRisk() {
  if (!state.selectedRiskId) return null;
  return state.visibleRisks.find((risk) => risk.id === state.selectedRiskId) || null;
}

function syncSelectedRiskId() {
  if (!state.visibleRisks.length) {
    state.selectedRiskId = null;
    return;
  }

  const selectedStillVisible = state.visibleRisks.some(
    (risk) => risk.id === state.selectedRiskId,
  );

  if (!selectedStillVisible) {
    state.selectedRiskId = state.visibleRisks[0].id;
  }
}

function updateVisibleRisks() {
  // A scoped base is honored even when empty; only derived (non-scope)
  // contexts fall back to the full register when they carry no risk ids.
  const baseRisks = state.context?.scoped
    ? state.allRisks.filter((risk) => state.context.riskIds.includes(risk.id))
    : state.context?.riskIds?.length
      ? state.allRisks.filter((risk) => state.context.riskIds.includes(risk.id))
      : state.allRisks;

  const filters = {
    searchQuery: state.searchQuery,
    category: state.category,
    status: state.status,
    priorityBand: state.priorityBand,
  };
  // The matrix counts every other active filter, so each cell shows what
  // picking it would return.
  state.matrixRisks = filterRisks(baseRisks, filters);
  const filtered = filterRisks(baseRisks, { ...filters, cell: state.matrixCell });

  state.visibleRisks = sortRisks(filtered, state.sortBy);
  syncSelectedRiskId();
}

function parseMatrixCell(value) {
  const match = /^([1-5])x([1-5])$/.exec(String(value || ''));
  return match ? { likelihood: Number(match[1]), impact: Number(match[2]) } : null;
}

// Likelihood x impact grid. Each cell is a filter toggle.
function renderMatrix() {
  if (!elements.riskMatrix) return;
  const risks = state.matrixRisks || [];
  const cells = [];
  for (let likelihood = 5; likelihood >= 1; likelihood -= 1) {
    for (let impact = 1; impact <= 5; impact += 1) {
      const count = risks.filter(
        (risk) => Number(risk.likelihood) === likelihood && Number(risk.impact) === impact,
      ).length;
      const band = priorityBand(likelihood * impact);
      const selected =
        state.matrixCell && state.matrixCell.likelihood === likelihood && state.matrixCell.impact === impact;
      cells.push(`
        <button
          class="risk-matrix__cell risk-matrix__cell--${band}${count ? ' has-risks' : ''}${selected ? ' is-selected' : ''}"
          type="button"
          data-likelihood="${likelihood}"
          data-impact="${impact}"
          aria-pressed="${String(Boolean(selected))}"
          aria-label="Likelihood ${likelihood}, impact ${impact}, ${priorityBandLabel(band)}: ${count} ${count === 1 ? 'risk' : 'risks'}"
          title="Likelihood ${likelihood} x Impact ${impact} = ${likelihood * impact} (${priorityBandLabel(band)})"
          ${count || selected ? '' : 'disabled'}
        >${count || ''}</button>`);
    }
  }

  elements.riskMatrix.innerHTML = `
    <span class="risk-matrix__axis risk-matrix__axis--y">Likelihood</span>
    <div class="risk-matrix__grid">${cells.join('')}</div>
    <span class="risk-matrix__axis risk-matrix__axis--x">Impact</span>
  `;
}

function renderContextBanner() {
  if (!elements.contextBannerHost) return;
  if (!state.context || !hasSharedContext(state.sharedContext)) {
    elements.contextBannerHost.innerHTML = '';
    return;
  }

  const scope = getScope();
  if (scope) {
    elements.contextBannerHost.innerHTML = buildScopePillHtml(scope);
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
  if (state.context.moduleKey) {
    chips.push(`<span class="suite-context-chip"><strong>Module</strong>${escapeHtml(state.context.moduleKey)}</span>`);
  }

  elements.contextBannerHost.innerHTML = `
    <section class="suite-context-banner">
      <p class="suite-context-banner__eyebrow">Cross-App Context</p>
      <h3 class="suite-context-banner__title">${escapeHtml(state.context.title || 'Risk context')}</h3>
      <p class="suite-context-banner__body">${escapeHtml(state.context.body || 'Showing the risk slice tied to what you were viewing elsewhere in the suite.')}</p>
      <div class="suite-context-banner__chips">
        ${chips.join('')}
      </div>
      <div class="suite-context-actions">
        <button class="suite-context-action" type="button" data-action="reset-view">Reset view</button>
      </div>
    </section>
  `;
}

function renderFilters(allRisks) {
  const categories = Array.from(new Set(allRisks.map((risk) => risk.category).filter(Boolean))).sort();
  const statuses = Array.from(new Set(allRisks.map((risk) => risk.status).filter(Boolean))).sort();

  elements.categoryFilter.innerHTML =
    '<option value="">All categories</option>' +
    categories.map((category) => `<option value="${category}">${category}</option>`).join('');

  elements.statusFilter.innerHTML =
    '<option value="">All statuses</option>' +
    statuses.map((status) => `<option value="${status}">${status}</option>`).join('');

  elements.categoryFilter.value = state.category;
  elements.statusFilter.value = state.status;
  elements.priorityFilter.value = state.priorityBand;
  elements.sortSelect.value = state.sortBy;
}

// The search box, selects and matrix show their own state; this only decides
// whether there is anything to clear.
function renderActiveFilters() {
  const active = Boolean(
    state.searchQuery ||
      state.category ||
      state.status ||
      state.priorityBand ||
      state.matrixCell ||
      state.sortBy !== 'priority_desc' ||
      hasSharedContext(state.sharedContext),
  );
  elements.clearFiltersButton.hidden = !active;
}

function renderListState(message, isError = false) {
  elements.listState.hidden = false;
  elements.listState.innerHTML = isError
    ? `<strong>Unable to load the risk set.</strong><br />${escapeHtml(message)}`
    : `<strong>No matching risks.</strong><br />${escapeHtml(message)}`;
  elements.riskList.innerHTML = '';
}

function renderRiskList() {
  const selectedRisk = getSelectedRisk();
  const risks = state.visibleRisks;

  elements.resultsLabel.textContent = state.loadState === 'error'
    ? 'Load error'
    : risks.length === 1
      ? '1 result'
      : `${risks.length} results`;

  if (state.loadState === 'error') {
    renderListState(state.loadError, true);
    return;
  }

  if (!risks.length) {
    const scope = getScope();
    if (scope && state.context?.scoped && !state.context.riskIds.length) {
      elements.listState.hidden = false;
      elements.listState.innerHTML = buildScopeEmptyStateHtml(scope, 'risks');
      elements.riskList.innerHTML = '';
      return;
    }
    renderListState(
      'Try a broader search, another category, or a different priority band.',
      false,
    );
    return;
  }

  elements.listState.hidden = true;
  elements.listState.textContent = '';

  // Band section headers only make sense in the default band-grouped order;
  // explicit sorts render the flat list.
  const showBandSections = state.sortBy === 'priority_desc';
  let previousBand = '';

  elements.riskList.innerHTML = risks
    .map((risk) => {
      let sectionHeader = '';
      if (showBandSections) {
        const band = priorityBand(Number(risk.priority));
        if (band !== previousBand) {
          previousBand = band;
          sectionHeader = `
            <div class="band-header band-header--${band}" role="presentation">
              <span class="band-header__label">${priorityBandLabel(band)}</span>
              <span class="band-header__range">${escapeHtml(bandRangeText(band))}</span>
            </div>
          `;
        }
      }
      const isSelected = selectedRisk?.id === risk.id;
      const band = priorityBand(Number(risk.priority));

      return `
        ${sectionHeader}
        <button
          class="risk-item risk-item--${band}${isSelected ? ' is-selected' : ''}"
          type="button"
          data-risk-id="${escapeHtml(risk.id)}"
          role="option"
          aria-selected="${String(isSelected)}"
        >
          <div class="risk-item__topline">
            <span class="risk-code">${escapeHtml(risk.id)}</span>
            <span class="score-pill score-pill--${band}">${priorityLabel(risk.priority)} ${escapeHtml(risk.priority)}</span>
          </div>
          <h3 class="risk-item__title">${escapeHtml(risk.title)}</h3>
          <p class="risk-item__meta">${escapeHtml(risk.category)} · ${escapeHtml(risk.status)}</p>
        </button>
      `;
    })
    .join('');
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

function likelihoodMeaning(score) {
  const s = Number(score);
  if (s >= 5) return 'Very likely — expected to occur based on current evidence or trends';
  if (s >= 4) return 'Likely — probable under current program posture';
  if (s >= 3) return 'Possible — credible exposure under current assumptions';
  if (s >= 2) return 'Unlikely — requires specific conditions to materialize';
  return 'Remote — theoretically possible but low probability';
}

function impactMeaning(score) {
  const s = Number(score);
  if (s >= 5) return 'Mission-defining — compromises the core mission objective';
  if (s >= 4) return 'Major — forces significant replanning of cost, schedule, or scope';
  if (s >= 3) return 'Material — meaningful effect on program execution';
  if (s >= 2) return 'Moderate — absorbable with management attention';
  return 'Minor — limited consequence to program outcome';
}

function renderRiskDetail(risk) {
  const band = priorityBand(Number(risk.priority));
  const categoryTone = categoryBand(risk.category);
  const likelihood = Number(risk.likelihood) || 0;
  const impact = Number(risk.impact) || 0;
  const score = Number(risk.priority) || 0;
  const plainLanguage = risk.plainLanguage || risk.description;
  const riskContext = state.crosswalk?.risk?.byId?.[risk.id];

  const openIn = buildOpenInHtml([
    {
      label: 'WBS',
      href: buildSuiteHref('wbs', { from: 'risk', wbs: navWbsValue(riskContext), risk: risk.id }),
    },
    {
      label: 'Schedule',
      href: buildSuiteHref('schedule', {
        from: 'risk',
        wbs: navWbsValue(riskContext),
        milestone: riskContext?.primaryMilestoneId || state.context?.milestoneId || '',
        risk: risk.id,
      }),
    },
    {
      label: 'Cost',
      href: buildSuiteHref('cost', { from: 'risk', wbs: navWbsValue(riskContext), risk: risk.id, view: 'module' }),
    },
    {
      label: 'Documents',
      href: buildSuiteHref('documents', {
        from: 'risk',
        wbs: navWbsValue(riskContext),
        risk: risk.id,
        doc: riskContext?.documents.sourceDocIds?.[0] || state.context?.docId || '',
      }),
    },
  ]);

  elements.detailPaneContent.innerHTML = `
    <article class="risk-card risk-card--${band} risk-card--${categoryTone}">
      <header class="risk-card__hero">
        <div class="risk-card__hero-copy">
          <div class="risk-card__hero-topline">
            <p class="risk-card__eyebrow">${escapeHtml(risk.category)}</p>
            <span class="risk-code">${escapeHtml(risk.id)}</span>
          </div>
          <h2>${escapeHtml(risk.title)}</h2>
          ${openIn}
        </div>
        <aside class="risk-signature risk-signature--${band}">
          <span class="risk-signature__score-value">${escapeHtml(risk.priority)}</span>
          <div class="risk-signature__score-copy">
            <strong>${priorityLabel(risk.priority)}</strong>
            <span>Likelihood ${escapeHtml(risk.likelihood)} × impact ${escapeHtml(risk.impact)}</span>
          </div>
        </aside>
      </header>

      <section class="risk-story">
        <p class="risk-story__lede">${escapeHtml(plainLanguage)}</p>
      </section>

      <dl class="risk-facts">
        <div><dt>Status</dt><dd>${escapeHtml(risk.status)}</dd></div>
        <div><dt>Owner</dt><dd>${escapeHtml(risk.owner)}</dd></div>
        ${confidenceLabel(risk.confidenceLevel) ? `<div><dt>Confidence</dt><dd>${escapeHtml(confidenceLabel(risk.confidenceLevel).replace(/ confidence$/, ''))}</dd></div>` : ''}
        ${basisLabel(risk.basisType) ? `<div><dt>Basis</dt><dd>${escapeHtml(basisLabel(risk.basisType))}</dd></div>` : ''}
      </dl>

      <section class="risk-section">
        <h3 class="risk-section__title">Mitigation</h3>
        <p class="risk-section__body">${escapeHtml(risk.mitigation)}</p>
      </section>

      ${risk.plainLanguage ? `<details class="risk-disclosure">
        <summary>
          <span>Technical framing</span>
          <span class="risk-disclosure__chevron" aria-hidden="true">▾</span>
        </summary>
        <p class="risk-disclosure__body">${escapeHtml(risk.description)}</p>
      </details>` : ''}

      <details class="risk-disclosure">
        <summary>
          <span>How the score is computed</span>
          <span class="risk-disclosure__chevron" aria-hidden="true">▾</span>
        </summary>
        <div class="risk-disclosure__body">
          <div class="score-breakdown">
            <div class="score-breakdown__row">
              <span class="score-breakdown__label">Likelihood (${escapeHtml(likelihood)}/5)</span>
              <span class="score-breakdown__meaning">${escapeHtml(likelihoodMeaning(likelihood))}</span>
            </div>
            <div class="score-breakdown__row">
              <span class="score-breakdown__label">Impact (${escapeHtml(impact)}/5)</span>
              <span class="score-breakdown__meaning">${escapeHtml(impactMeaning(impact))}</span>
            </div>
            <div class="score-breakdown__result">
              <span>${escapeHtml(likelihood)} × ${escapeHtml(impact)} = <strong>${escapeHtml(score)}</strong></span>
              <span class="score-breakdown__band"><strong>${priorityLabel(score)}</strong> band (${escapeHtml(bandRangeText(band))})</span>
            </div>
          </div>
        </div>
      </details>
    </article>
  `;
}

function renderDetailPane() {
  if (state.loadState === 'error') {
    renderDetailEmptyState('Load Error', 'Unable to load risks.', state.loadError);
    return;
  }

  const selectedRisk = getSelectedRisk();

  if (!selectedRisk) {
    renderDetailEmptyState(
      'No Results',
      'No risks match the current filters.',
      'Clear or broaden the filter set to repopulate the detail pane.',
    );
    return;
  }

  renderRiskDetail(selectedRisk);
}

// Keeps the selected row in view when the selection came from a link or a
// search result rather than a click in the list.
function revealSelectedRow() {
  const list = elements.riskList;
  const selected = list?.querySelector('.is-selected');
  if (!list || !selected) return;
  const top = selected.offsetTop - list.offsetTop;
  const bottom = top + selected.offsetHeight;
  if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = Math.max(0, top - 48);
  }
}

function render() {
  renderContextBanner();
  renderActiveFilters();
  renderMatrix();
  renderRiskList();
  renderDetailPane();
  revealSelectedRow();
  syncUrlState();
  syncSuiteNavigation();
}

function resetView() {
  state.searchQuery = '';
  state.category = '';
  state.status = '';
  state.priorityBand = '';
  state.matrixCell = null;
  state.sortBy = 'priority_desc';
  state.sharedContext = {};
  state.context = null;
  state.selectedRiskId = null;

  elements.searchInput.value = '';
  elements.categoryFilter.value = '';
  elements.statusFilter.value = '';
  elements.priorityFilter.value = '';
  elements.sortSelect.value = 'priority_desc';

  updateVisibleRisks();
  render();
}

function clearScope() {
  if (!state.sharedContext?.wbs) return;
  delete state.sharedContext.wbs;
  state.context = deriveRiskContext();
  state.selectedRiskId = null;
  updateVisibleRisks();
  render();
}

function setScope(wbsId) {
  if (!wbsId) return;
  state.sharedContext.wbs = wbsId;
  state.context = deriveRiskContext();
  state.selectedRiskId = null;
  updateVisibleRisks();
  render();
}

function handleRiskListClick(event) {
  const button = event.target.closest('[data-risk-id]');
  if (!button) return;

  state.selectedRiskId = button.getAttribute('data-risk-id');
  syncSelectedRiskId();
  render();
}

function attachEvents() {
  elements.searchInput.addEventListener('input', (event) => {
    state.searchQuery = event.target.value.trim();
    updateVisibleRisks();
    render();
  });

  elements.categoryFilter.addEventListener('change', (event) => {
    state.category = event.target.value;
    updateVisibleRisks();
    render();
  });

  elements.statusFilter.addEventListener('change', (event) => {
    state.status = event.target.value;
    updateVisibleRisks();
    render();
  });

  elements.priorityFilter.addEventListener('change', (event) => {
    state.priorityBand = event.target.value;
    updateVisibleRisks();
    render();
  });

  elements.sortSelect.addEventListener('change', (event) => {
    state.sortBy = event.target.value;
    updateVisibleRisks();
    render();
  });

  elements.clearFiltersButton.addEventListener('click', resetView);

  elements.riskMatrix?.addEventListener('click', (event) => {
    const cell = event.target.closest('.risk-matrix__cell');
    if (!cell) return;
    const likelihood = Number(cell.getAttribute('data-likelihood'));
    const impact = Number(cell.getAttribute('data-impact'));
    const same =
      state.matrixCell && state.matrixCell.likelihood === likelihood && state.matrixCell.impact === impact;
    state.matrixCell = same ? null : { likelihood, impact };
    updateVisibleRisks();
    render();
  });

  elements.contextBannerHost.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="clear-scope"]')) {
      clearScope();
      return;
    }
    if (event.target.closest('[data-action="reset-view"]')) {
      resetView();
    }
  });
  elements.listState.addEventListener('click', (event) => {
    const parentControl = event.target.closest('[data-action="scope-view-parent"]');
    if (parentControl) {
      setScope(parentControl.getAttribute('data-parent-id'));
      return;
    }
    if (event.target.closest('[data-action="clear-scope"]')) {
      clearScope();
    }
  });
  elements.riskList.addEventListener('click', handleRiskListClick);
}

function cacheElements() {
  elements.appTitle = document.getElementById('appTitle');
  elements.searchInput = document.getElementById('searchInput');
  elements.categoryFilter = document.getElementById('categoryFilter');
  elements.statusFilter = document.getElementById('statusFilter');
  elements.priorityFilter = document.getElementById('priorityFilter');
  elements.clearFiltersButton = document.getElementById('clearFiltersButton');
  elements.riskMatrix = document.getElementById('riskMatrix');
  elements.contextBannerHost = document.getElementById('contextBannerHost');
  elements.resultsLabel = document.getElementById('resultsLabel');
  elements.sortSelect = document.getElementById('sortSelect');
  elements.listState = document.getElementById('listState');
  elements.riskList = document.getElementById('riskList');
  elements.detailPaneContent = document.getElementById('detailPaneContent');
}

async function loadManifest() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Unable to load risk manifest (${response.status})`);
  }

  return response.json();
}

function initializeFromManifest(manifest) {
  state.allRisks = Array.isArray(manifest.risks) ? manifest.risks : [];
  state.context = deriveRiskContext();
  state.selectedRiskId =
    hasSharedContext(state.sharedContext) && state.sharedContext.risk ? state.sharedContext.risk : null;
  state.loadState = 'ready';
  state.loadError = '';

  elements.appTitle.textContent = 'Risk Explorer';

  renderFilters(state.allRisks);
  updateVisibleRisks();
  render();
}

function renderFatalError(message) {
  state.loadState = 'error';
  state.loadError = message;
  state.allRisks = [];
  state.visibleRisks = [];
  state.selectedRiskId = null;
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
    state.matrixCell = parseMatrixCell(new URLSearchParams(window.location.search).get('cell'));
    initializeFromManifest(manifest);
  } catch (error) {
    console.error('Failed to load risks.json', error);
    renderFatalError(error instanceof Error ? error.message : 'Unknown error');
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initializeApp);
}
