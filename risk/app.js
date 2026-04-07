import {
  applySuiteNav,
  buildSuiteHref,
  getSharedContextEntries,
  hasSharedContext,
  loadSuiteCrosswalk,
  mergeQueryState,
  readSharedContext,
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
  return 'Band logic: Critical 16-25, High 12-15, Moderate 8-11, Watch 1-7.';
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

function findNearestRiskBearingWbs(wbsId) {
  let currentId = wbsId;
  while (currentId) {
    const context = state.crosswalk?.wbs?.byId?.[currentId];
    if (!context) return null;
    if (context.risks.ids.length) return context;
    currentId = context.parentId || '';
  }
  return null;
}

function deriveRiskContext() {
  const shared = state.sharedContext || {};
  if (!hasSharedContext(shared)) return null;

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

  if (shared.wbs) {
    const directContext = state.crosswalk?.wbs?.byId?.[shared.wbs];
    if (directContext?.risks.ids.length) {
      return {
        title: `Showing risks related to WBS ${shared.wbs}`,
        body: directContext.risks.reason,
        wbsId: shared.wbs,
        milestoneId: directContext.schedule.primaryMilestoneId || '',
        riskIds: directContext.risks.ids,
        docId: directContext.documents.sourceDocIds?.[0] || '',
        moduleKey: directContext.simulation.moduleKeys?.[0] || '',
      };
    }

    const broaderContext = findNearestRiskBearingWbs(shared.wbs);
    if (broaderContext) {
      return {
        title: `Showing the nearest broader risk context for WBS ${shared.wbs}`,
        body: `No direct risks are linked to WBS ${shared.wbs}. Showing the nearest broader branch with linked risks: WBS ${broaderContext.id}.`,
        wbsId: broaderContext.id,
        milestoneId: broaderContext.schedule.primaryMilestoneId || '',
        riskIds: broaderContext.risks.ids,
        docId: broaderContext.documents.sourceDocIds?.[0] || '',
        moduleKey: broaderContext.simulation.moduleKeys?.[0] || '',
      };
    }
  }

  if (shared.module) {
    const moduleContext = state.crosswalk?.simulation?.byModuleKey?.[shared.module];
    if (moduleContext?.primaryWbsId) {
      const broaderContext = findNearestRiskBearingWbs(moduleContext.primaryWbsId);
      if (broaderContext) {
        return {
          title: `Showing risks related to ${shared.module}`,
          body: moduleContext.note,
          wbsId: broaderContext.id,
          milestoneId: broaderContext.schedule.primaryMilestoneId || '',
          riskIds: broaderContext.risks.ids,
          docId: broaderContext.documents.sourceDocIds?.[0] || '',
          moduleKey: shared.module,
        };
      }
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

function buildRiskNavContext(risk = getSelectedRisk()) {
  const riskContext = risk ? state.crosswalk?.risk?.byId?.[risk.id] : null;
  return {
    from: 'risk',
    wbs: riskContext?.primaryWbsId || state.context?.wbsId || '',
    module: riskContext?.simulation.moduleKeys?.[0] || state.context?.moduleKey || '',
    milestone: riskContext?.primaryMilestoneId || state.context?.milestoneId || '',
    risk: risk?.id || '',
    doc: riskContext?.documents.sourceDocIds?.[0] || state.context?.docId || '',
  };
}

function syncSuiteNavigation() {
  applySuiteNav(buildRiskNavContext(), { currentRoute: 'risk' });
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

function buildSeverityReason(risk) {
  const impact = Number(risk.impact);
  const likelihood = Number(risk.likelihood);
  const band = priorityBand(Number(risk.priority));
  const status = normalizeText(risk.status);

  const impactReason =
    impact >= 5
      ? 'the consequence reaches a mission-defining outcome'
      : impact >= 4
        ? 'the consequence can force major program replanning'
        : 'the consequence is still material to mission execution';

  const likelihoodReason =
    likelihood >= 4
      ? 'the current posture says it is relatively likely to surface'
      : likelihood >= 3
        ? 'the exposure remains credible under current assumptions'
        : 'the trigger is less likely, but the downside is still significant';

  const statusReason = status.startsWith('open')
    ? 'It remains open rather than retired.'
    : 'It remains on the watch list and still needs active attention.';

  const bandReason =
    band === 'critical'
      ? 'This sits at the top of the current risk stack.'
      : band === 'high'
        ? 'This is still one of the risks shaping program decisions.'
        : 'This is not the highest item, but it still carries visible consequence.';

  return `${bandReason} It matters because ${impactReason}, and ${likelihoodReason}. ${statusReason}`;
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

    return (
      Number(right.priority) - Number(left.priority) ||
      Number(right.impact) - Number(left.impact) ||
      left.title.localeCompare(right.title)
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
  const baseRisks = state.context?.riskIds?.length
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

  elements.headerCount.textContent =
    visible === total ? `${total} risks` : `${visible} of ${total} risks`;
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
    elements.summaryNarrative.textContent =
      'No risks are visible with the current filters. Clear or broaden the filter set to repopulate the review surface.';
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
    renderListState(
      'Try a broader search, another category, or a different priority band.',
      false,
    );
    return;
  }

  elements.listState.hidden = true;
  elements.listState.textContent = '';

  elements.riskList.innerHTML = risks
    .map((risk) => {
      const isSelected = selectedRisk?.id === risk.id;
      const band = priorityBand(Number(risk.priority));
      const categoryTone = categoryBand(risk.category);
      const ownerLabel = risk.owner.length > 36 ? `${risk.owner.slice(0, 36)}...` : risk.owner;
      const consequenceCue = buildConsequenceCue(risk);

      return `
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

function renderRiskDetail(risk) {
  const band = priorityBand(Number(risk.priority));
  const categoryTone = categoryBand(risk.category);
  const likelihood = Number(risk.likelihood) || 0;
  const impact = Number(risk.impact) || 0;
  const score = Number(risk.priority) || 0;
  const summary =
    `${priorityLabel(risk.priority)} ${risk.category.toLowerCase()} risk owned by ${risk.owner}. The current posture is ${statusLabel(risk.status).toLowerCase()}.`;
  const severityReason = buildSeverityReason(risk);
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
          <p class="risk-card__summary">${escapeHtml(summary)}</p>
        </div>
        <aside class="risk-signature risk-signature--${band}">
          <p class="risk-signature__eyebrow">Risk Signature</p>
          <div class="risk-signature__score">
            <span class="risk-signature__score-value">${escapeHtml(risk.priority)}</span>
            <div class="risk-signature__score-copy">
              <strong>${priorityLabel(risk.priority)}</strong>
              <span>${escapeHtml(risk.status)}</span>
            </div>
          </div>
          <div class="risk-signature__profile">
            ${renderRiskScale('Likelihood', risk.likelihood, band)}
            ${renderRiskScale('Impact', risk.impact, band)}
          </div>
        </aside>
      </header>

      <section class="suite-context-card">
        <p class="suite-context-card__eyebrow">Program Mapping</p>
        <h3 class="suite-context-card__title">Where this risk sits in the suite</h3>
        <p class="suite-context-card__body">${escapeHtml(riskContext?.reason || state.context?.body || 'This risk remains linked to the strongest available WBS, schedule, and document context in the current crosswalk.')}</p>
        <div class="suite-context-card__grid">
          <div class="suite-context-stat">
            <span class="suite-context-stat__label">WBS</span>
            <span class="suite-context-stat__value">${escapeHtml(riskContext?.primaryWbsId || state.context?.wbsId || 'No direct WBS branch')}</span>
          </div>
          <div class="suite-context-stat">
            <span class="suite-context-stat__label">Schedule</span>
            <span class="suite-context-stat__value">${escapeHtml(riskContext?.primaryMilestoneId || state.context?.milestoneId || 'No direct milestone')}</span>
          </div>
          <div class="suite-context-stat">
            <span class="suite-context-stat__label">Documents</span>
            <span class="suite-context-stat__value">${escapeHtml(String(riskContext?.documents.sourceDocIds?.length || 0))}</span>
          </div>
          <div class="suite-context-stat">
            <span class="suite-context-stat__label">Module</span>
            <span class="suite-context-stat__value">${escapeHtml(riskContext?.simulation.moduleKeys?.[0] || state.context?.moduleKey || 'Not mapped')}</span>
          </div>
        </div>
        <div class="suite-context-actions">
          ${buildSuiteAction('wbs', 'Open in WBS', {
            from: 'risk',
            wbs: riskContext?.primaryWbsId || state.context?.wbsId || '',
            risk: risk.id,
          })}
          ${buildSuiteAction('schedule', 'Open in Schedule', {
            from: 'risk',
            wbs: riskContext?.primaryWbsId || state.context?.wbsId || '',
            milestone: riskContext?.primaryMilestoneId || state.context?.milestoneId || '',
            risk: risk.id,
          })}
          ${buildSuiteAction('documents', 'Open in Documents', {
            from: 'risk',
            wbs: riskContext?.primaryWbsId || state.context?.wbsId || '',
            risk: risk.id,
            doc: riskContext?.documents.sourceDocIds?.[0] || state.context?.docId || '',
          })}
          ${buildSuiteAction('cost', 'Open in Cost', {
            from: 'risk',
            wbs: riskContext?.primaryWbsId || state.context?.wbsId || '',
            risk: risk.id,
            view: 'module',
          })}
        </div>
      </section>

      <section class="risk-signal-grid" aria-label="Risk signal">
        <div class="risk-signal-card">
          <p class="detail-section__eyebrow">Why This Is Serious</p>
          <p class="risk-signal-card__body">${escapeHtml(severityReason)}</p>
        </div>
        <div class="risk-signal-card">
          <p class="detail-section__eyebrow">Risk Drivers</p>
          <div class="tag-row">
            ${driverTags.map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')}
          </div>
        </div>
      </section>

      <section class="scoring-logic" aria-label="Scoring logic">
        <div class="scoring-logic__header">
          <div>
            <p class="detail-section__eyebrow">Scoring Logic</p>
            <h3>How this score is computed</h3>
          </div>
          <p class="scoring-logic__note">
            Priority score is calculated directly from the visible likelihood and impact values. The app does not imply a more complex model than the source data supports.
          </p>
        </div>

        <div class="scoring-logic__grid">
          <div class="scoring-card scoring-card--input">
            <span class="scoring-card__label">Input</span>
            <strong>Likelihood</strong>
            <span class="scoring-card__value">${escapeHtml(likelihood)} / 5</span>
          </div>
          <div class="scoring-card scoring-card--input">
            <span class="scoring-card__label">Input</span>
            <strong>Impact</strong>
            <span class="scoring-card__value">${escapeHtml(impact)} / 5</span>
          </div>
          <div class="scoring-card scoring-card--derived">
            <span class="scoring-card__label">Derived</span>
            <strong>Priority Score</strong>
            <span class="scoring-card__value">${escapeHtml(score)}</span>
          </div>
          <div class="scoring-card scoring-card--band">
            <span class="scoring-card__label">Assigned Band</span>
            <strong>${priorityLabel(score)}</strong>
            <span class="scoring-card__value">${escapeHtml(bandRangeText(band))}</span>
          </div>
        </div>

        <div class="scoring-logic__formula" aria-label="Score formula">
          <span class="scoring-logic__token">Likelihood ${escapeHtml(likelihood)}</span>
          <span class="scoring-logic__operator">x</span>
          <span class="scoring-logic__token">Impact ${escapeHtml(impact)}</span>
          <span class="scoring-logic__operator">=</span>
          <strong class="scoring-logic__result">Score ${escapeHtml(score)}</strong>
        </div>

        <p class="scoring-logic__thresholds">${escapeHtml(bandThresholdText())}</p>
      </section>

      <section class="risk-card__meta-grid" aria-label="Risk posture">
        <div class="risk-meta-card">
          <p class="risk-meta-card__label">Likelihood</p>
          <p class="risk-meta-card__value risk-meta-card__value--mono">${escapeHtml(risk.likelihood)} / 5</p>
        </div>
        <div class="risk-meta-card">
          <p class="risk-meta-card__label">Impact</p>
          <p class="risk-meta-card__value risk-meta-card__value--mono">${escapeHtml(risk.impact)} / 5</p>
        </div>
        <div class="risk-meta-card">
          <p class="risk-meta-card__label">Status</p>
          <p class="risk-meta-card__value">${escapeHtml(risk.status)}</p>
        </div>
        <div class="risk-meta-card">
          <p class="risk-meta-card__label">Owner</p>
          <p class="risk-meta-card__value">${escapeHtml(risk.owner)}</p>
        </div>
        <div class="risk-meta-card">
          <p class="risk-meta-card__label">Category</p>
          <p class="risk-meta-card__value">${escapeHtml(risk.category)}</p>
        </div>
        <div class="risk-meta-card">
          <p class="risk-meta-card__label">Risk ID</p>
          <p class="risk-meta-card__value risk-meta-card__value--mono">${escapeHtml(risk.id)}</p>
        </div>
      </section>

      <section class="detail-section">
        <div class="detail-section__header">
          <p class="detail-section__eyebrow">What This Risk Is</p>
          <h3>Program meaning</h3>
        </div>
        <p class="detail-section__body">${escapeHtml(risk.description)}</p>
      </section>

      <section class="detail-section">
        <div class="detail-section__header">
          <p class="detail-section__eyebrow">Mitigation</p>
          <h3>Current response and ownership</h3>
        </div>
        <p class="detail-section__body">${escapeHtml(risk.mitigation)}</p>
      </section>

      <section class="detail-section">
        <div class="detail-section__header">
          <p class="detail-section__eyebrow">Tags</p>
          <h3>Related handles</h3>
        </div>
        <div class="tag-row">
          ${(Array.isArray(risk.tags) ? risk.tags : [])
            .map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`)
            .join('')}
        </div>
      </section>
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
  renderActiveFilters();
  renderSummary();
  renderRiskList();
  renderDetailPane();
  syncUrlState();
  syncSuiteNavigation();
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

  elements.clearFiltersButton.addEventListener('click', () => {
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
