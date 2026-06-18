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
  wbsIsScope,
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

function scoreFormulaText() {
  return 'Priority score = Likelihood x Impact';
}

function bandThresholdText() {
  return 'Band logic: Critical 16-25, High 12-15, Moderate 8-11, Watch 1-7. Within a band, risks order by impact, then likelihood, then id.';
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

function statusLabel(status) {
  return String(status ?? '');
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

function clampText(text, maxLength = 120) {
  const value = String(text ?? '').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function getScope() {
  if (!wbsIsScope(state.sharedContext)) return null;
  return resolveScope(state.crosswalk, state.sharedContext?.wbs);
}

function deriveRiskContext() {
  const shared = state.sharedContext || {};
  if (!hasSharedContext(shared)) return null;

  // An explicit WBS scope wins over every derived context. The scoped base
  // list is exactly the crosswalk node's risk union - never silently widened.
  // A `wbs` riding with an item id is not a scope (wbsIsScope is false), so we
  // fall through and center on the item instead.
  if (wbsIsScope(shared)) {
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

function buildSuiteAction(route, label, params) {
  return `
    <a class="suite-context-action" href="${escapeHtml(buildSuiteHref(route, params))}">
      ${escapeHtml(label)}
    </a>
  `;
}

// Item-level "Open in X" links only: only an active scope travels. Item links
// never inject a derived wbs (that would silently scope the destination), so an
// unscoped link carries no wbs and the destination centers via the item id.
// Never used for the top suite nav.
function navWbsValue() {
  return getScope()?.id || '';
}

// Explicit scope marker for item links. Only an active scope travels, and only
// then does the link carry `scope=1` so the destination keeps the scope (a
// `wbs` without this marker is treated as a derived item association, not a
// scope). Empty when unscoped, so buildSuiteHref omits it entirely.
function navScopeMarker() {
  return getScope() ? '1' : '';
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
    state.sortBy !== 'priority_desc' ||
    (state.selectedRiskId && state.selectedRiskId !== defaultRiskId);

  mergeQueryState({
    ...getSharedContextEntries(state.sharedContext),
    risk: shouldPersistRiskId ? state.selectedRiskId || '' : '',
  });
}

function buildConsequenceCue(risk) {
  const description = clampText(risk.description, 112);
  return description;
}

function renderRiskScale(label, value, band) {
  const numericValue = Math.max(0, Math.min(5, Number(value) || 0));
  const cells = Array.from({ length: 5 }, (_, index) => {
    const filled = index < numericValue;
    return `<span class="risk-scale__cell risk-scale__cell--${band}${filled ? ' is-filled' : ''}"></span>`;
  }).join('');

  return `
    <div class="risk-scale">
      <span class="risk-scale__label">${escapeHtml(label)}</span>
      <div class="risk-scale__track" aria-hidden="true">${cells}</div>
      <span class="risk-scale__value">${escapeHtml(numericValue)}</span>
    </div>
  `;
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

    return matchesQuery && matchesCategory && matchesStatus && matchesPriority;
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

  const filtered = filterRisks(baseRisks, {
    searchQuery: state.searchQuery,
    category: state.category,
    status: state.status,
    priorityBand: state.priorityBand,
  });

  state.visibleRisks = sortRisks(filtered, state.sortBy);
  syncSelectedRiskId();
}

function renderHeaderCount() {
  const visible = state.visibleRisks.length;
  const total = state.allRisks.length;
  const scope = getScope();

  elements.headerCount.textContent = scope
    ? `${visible} of ${total} risks linked to WBS ${scope.id}${scope.name ? ` ${scope.name}` : ''}`
    : `${visible} of ${total} risks`;
}

function renderSummary() {
  const risks = state.visibleRisks;
  const attentionCount = risks.filter((risk) => Number(risk.priority) >= 12).length;
  const openCount = risks.filter((risk) => normalizeText(risk.status).startsWith('open')).length;
  const categoryCount = new Set(risks.map((risk) => risk.category).filter(Boolean)).size;
  const topRisk = risks[0] || null;

  elements.totalRisksStat.textContent = String(risks.length);
  elements.attentionStat.textContent = String(attentionCount);
  elements.openStat.textContent = String(openCount);
  elements.categoryStat.textContent = String(categoryCount);

  if (!risks.length) {
    elements.summaryNarrative.textContent = state.context?.scoped
      ? `${state.context.title}.`
      : 'No risks are visible with the current filters. Clear or broaden the filter set to repopulate the review surface.';
    elements.summaryMethod.textContent =
      `Scoring: ${scoreFormulaText()}. ${bandThresholdText()}`;
    return;
  }

  if (!topRisk) {
    elements.summaryNarrative.textContent =
      state.context?.title
        ? `${state.context.title}. ${state.context.body}`
        : 'The current risk set keeps priority, ownership, and mitigation visible without overwhelming the first screen.';
    elements.summaryMethod.textContent =
      `Scoring: ${scoreFormulaText()}. ${bandThresholdText()}`;
    return;
  }

  const contextLead =
    state.context?.title && (state.context.wbsId || state.context.milestoneId || state.sharedContext.from)
      ? `${state.context.title}. `
      : '';
  elements.summaryNarrative.textContent =
    `${contextLead}${topRisk.title} currently sets the tone for this view at ${priorityLabel(topRisk.priority)} priority, while ${attentionCount} visible risks still sit in the high-attention range.`;
  elements.summaryMethod.textContent =
    `Scoring: ${scoreFormulaText()}. ${bandThresholdText()}`;
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

function renderActiveFilters() {
  const chips = [];

  if (state.searchQuery) chips.push(`Search: ${state.searchQuery}`);
  if (state.category) chips.push(`Category: ${state.category}`);
  if (state.status) chips.push(`Status: ${state.status}`);
  if (state.priorityBand) chips.push(`Priority: ${priorityBandLabel(state.priorityBand)}`);

  elements.activeFilters.innerHTML = chips
    .map((label) => `<span class="filter-chip">${escapeHtml(label)}</span>`)
    .join('');
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

  renderHeaderCount();
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
      const categoryTone = categoryBand(risk.category);
      const ownerLabel = risk.owner.length > 36 ? `${risk.owner.slice(0, 36)}...` : risk.owner;
      const consequenceCue = buildConsequenceCue(risk);

      return `
        ${sectionHeader}
        <button
          class="risk-item risk-item--${band} risk-item--${categoryTone}${isSelected ? ' is-selected' : ''}"
          type="button"
          data-risk-id="${escapeHtml(risk.id)}"
          role="option"
          aria-selected="${String(isSelected)}"
        >
          <div class="risk-item__topline">
            <div class="risk-item__identity">
              <span class="risk-category risk-category--${categoryTone}">${escapeHtml(risk.category)}</span>
              <span class="risk-code">${escapeHtml(risk.id)}</span>
            </div>
            <div class="risk-item__severity">
              <span class="risk-pill risk-pill--${band}">${priorityLabel(risk.priority)}</span>
              <span class="score-pill score-pill--${band}">Score ${escapeHtml(risk.priority)}</span>
            </div>
          </div>
          <h3 class="risk-item__title">${escapeHtml(risk.title)}</h3>
          <p class="risk-item__cue">${escapeHtml(consequenceCue)}</p>
          <div class="risk-item__profile">
            ${renderRiskScale('L', risk.likelihood, band)}
            ${renderRiskScale('I', risk.impact, band)}
          </div>
          <div class="risk-item__footer">
            <span class="meta-chip">${escapeHtml(risk.status)}</span>
            ${confidenceLabel(risk.confidenceLevel) ? `<span class="meta-chip confidence-chip">${escapeHtml(confidenceLabel(risk.confidenceLevel))}</span>` : ''}
            <span class="risk-item__owner">${escapeHtml(ownerLabel)}</span>
          </div>
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
  const summary =
    `${priorityLabel(risk.priority)} ${risk.category.toLowerCase()} risk owned by ${risk.owner}. The current posture is ${statusLabel(risk.status).toLowerCase()}.`;
  const plainLanguage = risk.plainLanguage || risk.description;
  const driverTags = (Array.isArray(risk.tags) ? risk.tags : []).slice(0, 4);
  const riskContext = state.crosswalk?.risk?.byId?.[risk.id];

  elements.detailPaneContent.innerHTML = `
    <article class="risk-card risk-card--${band} risk-card--${categoryTone}">
      <header class="risk-card__hero">
        <div class="risk-card__hero-copy">
          <div class="risk-card__hero-topline">
            <p class="risk-card__eyebrow">${escapeHtml(risk.category)}</p>
            <span class="risk-code">${escapeHtml(risk.id)}</span>
          </div>
          <h2>${escapeHtml(risk.title)}</h2>
        </div>
        <aside class="risk-signature risk-signature--${band}">
          <span class="risk-signature__score-value">${escapeHtml(risk.priority)}</span>
          <div class="risk-signature__score-copy">
            <strong>${priorityLabel(risk.priority)}</strong>
            <span>L ${escapeHtml(risk.likelihood)} · I ${escapeHtml(risk.impact)}</span>
          </div>
        </aside>
      </header>

      <section class="risk-story">
        <p class="risk-story__lede"><strong>In plain terms:</strong> ${escapeHtml(plainLanguage)}</p>
        ${risk.plainLanguage ? `<details class="risk-story__technical">
          <summary><span>Technical framing</span><span class="risk-disclosure__chevron" aria-hidden="true">▾</span></summary>
          <p class="risk-story__what">${escapeHtml(risk.description)}</p>
        </details>` : ''}
      </section>

      <section class="risk-status-line">
        <span class="risk-status-line__item"><span class="risk-status-line__label">Status</span> ${escapeHtml(risk.status)}</span>
        <span class="risk-status-line__sep">·</span>
        <span class="risk-status-line__item"><span class="risk-status-line__label">Owner</span> ${escapeHtml(risk.owner)}</span>
        ${confidenceLabel(risk.confidenceLevel) ? `
          <span class="risk-status-line__sep">·</span>
          <span class="risk-status-line__item"><span class="risk-status-line__label">Confidence</span> <span class="meta-chip confidence-chip">${escapeHtml(confidenceLabel(risk.confidenceLevel))}</span></span>
        ` : ''}
        ${basisLabel(risk.basisType) ? `
          <span class="risk-status-line__sep">·</span>
          <span class="risk-status-line__item"><span class="risk-status-line__label">Basis</span> ${escapeHtml(basisLabel(risk.basisType))}</span>
        ` : ''}
        ${driverTags.length ? `
          <span class="risk-status-line__sep">·</span>
          <span class="risk-status-line__item">
            ${driverTags.map(t => `<span class="tag-chip tag-chip--inline">${escapeHtml(t)}</span>`).join(' ')}
          </span>
        ` : ''}
      </section>

      <details class="risk-disclosure">
        <summary>
          <span>Mitigation and current response</span>
          <span class="risk-disclosure__chevron" aria-hidden="true">▾</span>
        </summary>
        <p class="risk-disclosure__body">${escapeHtml(risk.mitigation)}</p>
      </details>

      <details class="risk-disclosure">
        <summary>
          <span>How this score is computed</span>
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

      <details class="cross-app-collapsed">
        <summary class="cross-app-collapsed__summary">
          <span>Open this risk elsewhere</span>
          <span class="cross-app-collapsed__chevron" aria-hidden="true">▾</span>
        </summary>
        <div class="cross-app-collapsed__actions">
          ${buildSuiteAction('wbs', 'Open in WBS', {
            from: 'risk',
            wbs: navWbsValue(),
            scope: navScopeMarker(),
            risk: risk.id,
          })}
          ${buildSuiteAction('schedule', 'Open in Schedule', {
            from: 'risk',
            wbs: navWbsValue(),
            scope: navScopeMarker(),
            milestone: riskContext?.primaryMilestoneId || state.context?.milestoneId || '',
            risk: risk.id,
          })}
          ${buildSuiteAction('documents', 'Open in Documents', {
            from: 'risk',
            wbs: navWbsValue(),
            scope: navScopeMarker(),
            risk: risk.id,
            doc: riskContext?.documents.sourceDocIds?.[0] || state.context?.docId || '',
          })}
          ${buildSuiteAction('cost', 'Open in Cost', {
            from: 'risk',
            wbs: navWbsValue(),
            scope: navScopeMarker(),
            risk: risk.id,
            view: 'module',
          })}
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

function render() {
  renderContextBanner();
  renderActiveFilters();
  renderSummary();
  renderRiskList();
  renderDetailPane();
  syncUrlState();
  syncSuiteNavigation();
}

function resetView() {
  state.searchQuery = '';
  state.category = '';
  state.status = '';
  state.priorityBand = '';
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
  delete state.sharedContext.scope;
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
  elements.appSubtitle = document.getElementById('appSubtitle');
  elements.headerCount = document.getElementById('headerCount');
  elements.searchInput = document.getElementById('searchInput');
  elements.categoryFilter = document.getElementById('categoryFilter');
  elements.statusFilter = document.getElementById('statusFilter');
  elements.priorityFilter = document.getElementById('priorityFilter');
  elements.clearFiltersButton = document.getElementById('clearFiltersButton');
  elements.totalRisksStat = document.getElementById('totalRisksStat');
  elements.attentionStat = document.getElementById('attentionStat');
  elements.openStat = document.getElementById('openStat');
  elements.categoryStat = document.getElementById('categoryStat');
  elements.summaryNarrative = document.getElementById('summaryNarrative');
  elements.summaryMethod = document.getElementById('summaryMethod');
  elements.contextBannerHost = document.getElementById('contextBannerHost');
  elements.resultsLabel = document.getElementById('resultsLabel');
  elements.sortSelect = document.getElementById('sortSelect');
  elements.activeFilters = document.getElementById('activeFilters');
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

  elements.appTitle.textContent = manifest.appTitle || 'Risk Explorer';
  elements.appSubtitle.textContent =
    manifest.appSubtitle ||
    'Focus on the risks that matter most, then inspect why they matter and what mitigation is in motion.';

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
    initializeFromManifest(manifest);
  } catch (error) {
    console.error('Failed to load risks.json', error);
    renderFatalError(error instanceof Error ? error.message : 'Unknown error');
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initializeApp);
}
