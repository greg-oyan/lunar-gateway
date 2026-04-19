import {
  applySuiteNav,
  buildSuiteHref,
  getSharedContextEntries,
  hasSharedContext,
  loadSuiteCrosswalk,
  mergeQueryState,
  readSharedContext,
} from '../suite-assets/suite-context.js';

const CROSSWALK_URL = '../suite-assets/data/gateway-crosswalk.json';
const WBS_DATA_URL = '../wbs/data/gateway-wbs.json';

const state = {
  data: null,
  error: null,
  view: 'module',
  selectedAnchorId: null,
  selectedYearId: null,
  selectedMethodId: null,
  anchors: [],
  anchorsById: new Map(),
  categoriesById: new Map(),
  yearsById: new Map(),
  methodsById: new Map(),
  crosswalk: null,
  sharedContext: {},
  wbsNodesById: null,
  wbsNodesPromise: null,
};

const elements = {
  appTitle: document.querySelector('#appTitle'),
  appSubtitle: document.querySelector('#appSubtitle'),
  storySignals: document.querySelector('#storySignals'),
  viewSwitcher: document.querySelector('#viewSwitcher'),
  snapshotStamp: document.querySelector('#snapshotStamp'),
  activeViewKicker: document.querySelector('#activeViewKicker'),
  activeViewHeading: document.querySelector('#activeViewHeading'),
  activeViewSubcopy: document.querySelector('#activeViewSubcopy'),
  activeViewContent: document.querySelector('#activeViewContent'),
};

const viewDefinitions = {
  module: {
    kicker: 'Gateway Cost Map',
    heading: 'Where the money sits',
    subcopy: 'Physical hardware on the station; program cost beside it.',
  },
  year: {
    kicker: 'Yearly Spend',
    heading: 'Spend over time',
    subcopy: 'Click a year to see its total, reserve, and top drivers.',
  },
  method: {
    kicker: 'Defensibility',
    heading: 'Why the estimate is defensible',
    subcopy: 'Sourcing, reserve logic, and where judgment enters the estimate.',
  },
};

const anchorBlueprints = [
  {
    id: 'ppe',
    shortLabel: 'PPE',
    label: 'Power and Propulsion',
    groupIds: ['1.3'],
    tone: 'brand',
    visualId: 'ppe',
    summary: 'Power, propulsion, and early stack control sit here.',
    why: 'This is one of the earliest direct contract anchors in the station stack.',
  },
  {
    id: 'halo',
    shortLabel: 'HALO',
    label: 'HALO / Logistics',
    groupIds: ['1.4'],
    tone: 'copper',
    visualId: 'halo',
    summary: 'HALO and logistics form the early habitation core.',
    why: 'This is one of the largest physical cost areas and the clearest center of the Gateway build.',
  },
  {
    id: 'airlock',
    shortLabel: 'Airlock',
    label: 'Lunar Airlock',
    groupIds: ['1.7'],
    tone: 'danger',
    visualId: 'airlock',
    summary: 'The airlock is a later attached module rather than part of the early core.',
    why: 'It is physically mappable, but its cost arrives later and should not crowd the main stack story.',
  },
  {
    id: 'ihab',
    shortLabel: 'I-HAB',
    label: 'International Habitation',
    groupIds: ['1.5'],
    tone: 'forest',
    visualId: 'ihab',
    summary: 'I-HAB expands the long-duration habitation capability.',
    why: 'It is a major partner-reference module with clear integration significance.',
  },
  {
    id: 'esprit',
    shortLabel: 'ESPRIT',
    label: 'ESPRIT Module',
    groupIds: ['1.6'],
    tone: 'plum',
    visualId: 'esprit',
    summary: 'ESPRIT adds refueling, communications, and logistics support.',
    why: 'It is a distinct partner-reference module that rounds out the later station stack.',
  },
  {
    id: 'canadarm3',
    shortLabel: 'Canadarm3',
    label: 'Canadarm3',
    groupIds: ['1.8'],
    tone: 'brand',
    visualId: 'arm',
    summary: 'The robotic arm is a distinct cost area.',
    why: 'It is easy to recognize spatially and carries a substantial partner-reference value.',
  },
  {
    id: 'launch',
    shortLabel: 'Launch',
    label: 'Launch Services',
    groupIds: ['1.10'],
    tone: 'copper',
    visualId: null,
    summary: 'Launch is essential program cost, but it is not part of the on-orbit station body.',
    why: 'It belongs beside the station story, not on the station itself.',
  },
  {
    id: 'backbone',
    shortLabel: 'Backbone',
    label: 'Mission and Program Backbone',
    groupIds: ['1.1', '1.2', '1.9', '1.11', '1.12'],
    tone: 'forest',
    visualId: null,
    summary:
      'Program management, systems engineering, operations, ground systems, and integration/test live here.',
    why: 'These costs are structurally essential but conceptually separate from the visible hardware.',
  },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function formatCompactCurrency(value) {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  });
}

function formatMillionCurrency(value) {
  return formatCompactCurrency(Number(value || 0) * 1000000);
}

function formatPercent(value) {
  return `${Math.round((Number(value || 0) * 1000)) / 10}%`;
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function repoSourceHref(relativePath) {
  return `../${encodeURI(relativePath)}`;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function getTopLevelWbsId(wbsId) {
  const parts = String(wbsId || '').split('.').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length < 2) return parts[0];
  return `${parts[0]}.${parts[1]}`;
}

async function ensureWbsNodesById() {
  if (state.wbsNodesById) return state.wbsNodesById;
  if (!state.wbsNodesPromise) {
    state.wbsNodesPromise = fetch(WBS_DATA_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        state.wbsNodesById = new Map((data?.nodes || []).map((node) => [node.id, node]));
        return state.wbsNodesById;
      })
      .catch(() => {
        state.wbsNodesById = new Map();
        return state.wbsNodesById;
      })
      .finally(() => {
        state.wbsNodesPromise = null;
      });
  }
  return state.wbsNodesPromise;
}

function getCategoryYearValue(category, fy) {
  return category.yearly.find((entry) => entry.fy === fy)?.totalUsd || 0;
}

function buildAnchors(data) {
  return anchorBlueprints
    .map((blueprint) => {
      const categories = blueprint.groupIds
        .map((id) => state.categoriesById.get(id))
        .filter(Boolean);
      if (!categories.length) return null;

      const totalUsd = sum(categories.map((category) => category.baseUsd));
      const yearly = data.years.map((year) => ({
        fy: year.fy,
        totalUsd: sum(categories.map((category) => getCategoryYearValue(category, year.fy))),
      }));
      const topYear = [...yearly].sort((left, right) => right.totalUsd - left.totalUsd)[0] || null;
      const linkedSources = uniqueById(categories.flatMap((category) => category.linkedSources));
      const representativeDetails = categories
        .flatMap((category) => category.representativeDetails)
        .sort((left, right) => right.amountUsd - left.amountUsd)
        .slice(0, 6);
      const pricedLines = uniqueById(
        categories
          .flatMap((category) => category.pricedLines)
          .sort((left, right) => right.totalUsd - left.totalUsd)
          .slice(0, 6),
      );

      const contributors = (
        categories.length === 1
          ? categories[0].children.length
            ? categories[0].children.map((child) => ({
                id: child.id,
                name: child.name,
                value: child.baseUsd,
                note: child.scopeLabel || child.basisLabel,
              }))
            : categories[0].componentTotals.map((component, index) => ({
                id: `${categories[0].id}-component-${index}`,
                name: component.label,
                value: component.amountUsd,
                note: component.component,
              }))
          : categories.map((category) => ({
              id: category.id,
              name: category.name,
              value: category.baseUsd,
              note: category.scopeLabel,
            }))
      )
        .sort((left, right) => right.value - left.value)
        .slice(0, 5);

      return {
        ...blueprint,
        categories,
        totalUsd,
        yearly,
        yearlyById: new Map(yearly.map((entry) => [entry.fy, entry.totalUsd])),
        shareOfProgram: data.overview.totalCostUsd ? totalUsd / data.overview.totalCostUsd : 0,
        topYear,
        linkedSources,
        representativeDetails,
        pricedLines,
        contributors,
        primaryNote:
          categories.length === 1 ? categories[0].meaning || blueprint.summary : blueprint.summary,
        judgmentNote:
          categories.length === 1
            ? categories[0].judgmentNote || categories[0].includedNote
            : 'Combines several non-physical program categories.',
      };
    })
    .filter(Boolean);
}

function getDefaultAnchorId() {
  return state.anchorsById.has('halo') ? 'halo' : state.anchors[0]?.id || null;
}

function getCurrentAnchor() {
  return state.anchorsById.get(state.selectedAnchorId) || state.anchors[0] || null;
}

function getCurrentYear() {
  return state.yearsById.get(state.selectedYearId) || state.data?.years?.[0] || null;
}

function getCurrentMethod() {
  return state.methodsById.get(state.selectedMethodId) || state.data?.methodology?.cards?.[0] || null;
}

function getAnchorContext(anchorId = state.selectedAnchorId) {
  return state.crosswalk?.cost?.byAnchorId?.[anchorId] || null;
}

function resolveAnchorIdFromContext(sharedContext, explicitAnchorId = '') {
  if (explicitAnchorId && state.anchorsById.has(explicitAnchorId)) {
    return explicitAnchorId;
  }

  const wbsContext = sharedContext.wbs ? state.crosswalk?.wbs?.byId?.[sharedContext.wbs] : null;
  if (wbsContext?.cost.anchorId && state.anchorsById.has(wbsContext.cost.anchorId)) {
    return wbsContext.cost.anchorId;
  }

  const milestoneContext = sharedContext.milestone
    ? state.crosswalk?.schedule?.byMilestoneId?.[sharedContext.milestone]
    : null;
  if (milestoneContext?.cost.anchorId && state.anchorsById.has(milestoneContext.cost.anchorId)) {
    return milestoneContext.cost.anchorId;
  }

  const phaseContext = sharedContext.phase
    ? state.crosswalk?.schedule?.byPhaseId?.[sharedContext.phase]
    : null;
  if (phaseContext?.primaryWbsId) {
    const phaseWbsContext = state.crosswalk?.wbs?.byId?.[phaseContext.primaryWbsId];
    if (phaseWbsContext?.cost.anchorId && state.anchorsById.has(phaseWbsContext.cost.anchorId)) {
      return phaseWbsContext.cost.anchorId;
    }
  }

  const riskContext = sharedContext.risk ? state.crosswalk?.risk?.byId?.[sharedContext.risk] : null;
  if (riskContext?.cost.anchorId && state.anchorsById.has(riskContext.cost.anchorId)) {
    return riskContext.cost.anchorId;
  }

  const moduleContext = sharedContext.module
    ? state.crosswalk?.simulation?.byModuleKey?.[sharedContext.module]
    : null;
  if (moduleContext?.costAnchorId && state.anchorsById.has(moduleContext.costAnchorId)) {
    return moduleContext.costAnchorId;
  }

  return getDefaultAnchorId();
}

function buildCostNavContext(anchor = getCurrentAnchor()) {
  const sharedContext = buildCurrentContext(anchor);
  return {
    from: 'cost',
    wbs: sharedContext.wbsId || '',
    module: sharedContext.moduleKey || '',
    milestone: sharedContext.milestoneId || '',
    risk: sharedContext.riskId || '',
    doc: sharedContext.docId || '',
  };
}

function syncSuiteNavigation() {
  applySuiteNav(buildCostNavContext(), { currentRoute: 'cost' });
}

function getDefaultYearId() {
  return (
    state.data?.defaultSelection?.defaultYear ||
    state.data?.overview?.busiestYear?.fy ||
    state.data?.years?.[0]?.fy ||
    null
  );
}

function getDefaultMethodId() {
  return state.methodsById.has('methods')
    ? 'methods'
    : state.data?.methodology?.cards?.[0]?.id || null;
}

function syncUrlState() {
  const defaultAnchorId = getDefaultAnchorId();
  const defaultYearId = getDefaultYearId();
  const defaultMethodId = getDefaultMethodId();
  const contextIsActive = hasSharedContext(state.sharedContext);

  mergeQueryState({
    ...getSharedContextEntries(state.sharedContext),
    view: state.view !== 'module' ? state.view : '',
    anchor:
      contextIsActive || (state.selectedAnchorId && state.selectedAnchorId !== defaultAnchorId)
        ? state.selectedAnchorId || ''
        : '',
    year:
      state.view === 'year' && (contextIsActive || state.selectedYearId !== defaultYearId)
        ? state.selectedYearId || ''
        : '',
    method:
      state.view === 'method' && (contextIsActive || state.selectedMethodId !== defaultMethodId)
        ? state.selectedMethodId || ''
        : '',
  });
}

function buildCurrentContext(anchor = getCurrentAnchor()) {
  const anchorContext = getAnchorContext(anchor?.id);
  const sharedContext = state.sharedContext || {};
  const selectedWbsNode = sharedContext.wbs ? state.wbsNodesById?.get(sharedContext.wbs) : null;
  const selectedWbsCostM = Number.isFinite(Number(selectedWbsNode?.related?.cost?.totalBaseCost))
    ? Number(selectedWbsNode.related.cost.totalBaseCost)
    : null;
  const selectedWbsLabel = selectedWbsCostM !== null ? selectedWbsNode?.name || selectedWbsNode?.id || '' : '';
  const selectedWbsCostDisplay = selectedWbsCostM !== null ? formatMillionCurrency(selectedWbsCostM) : '';
  const candidateWbsId =
    sharedContext.wbs && anchor?.groupIds?.includes(getTopLevelWbsId(sharedContext.wbs))
      ? sharedContext.wbs
      : anchorContext?.primaryWbsId || anchor?.groupIds?.[0] || '';
  const wbsContext = candidateWbsId ? state.crosswalk?.wbs?.byId?.[candidateWbsId] : null;
  const milestoneId =
    sharedContext.milestone && anchorContext?.primaryMilestoneId === sharedContext.milestone
      ? sharedContext.milestone
      : wbsContext?.schedule.primaryMilestoneId || anchorContext?.primaryMilestoneId || '';
  const riskId =
    sharedContext.risk && anchorContext?.riskIds?.includes(sharedContext.risk)
      ? sharedContext.risk
      : wbsContext?.risks.primaryRiskId || anchorContext?.riskIds?.[0] || '';
  const moduleKey =
    sharedContext.module && (wbsContext?.simulation.moduleKeys || []).includes(sharedContext.module)
      ? sharedContext.module
      : wbsContext?.simulation.moduleKeys?.[0] || anchorContext?.simulation.moduleKeys?.[0] || '';
  const docId =
    sharedContext.doc && (wbsContext?.documents.sourceDocIds || anchorContext?.documents.sourceDocIds || []).includes(sharedContext.doc)
      ? sharedContext.doc
      : wbsContext?.documents.sourceDocIds?.[0] || anchorContext?.documents.sourceDocIds?.[0] || '';
  const title = candidateWbsId
    ? `Cost area for WBS ${candidateWbsId}`
    : `Cost area: ${anchor?.label || 'Gateway'}`;
  const body = selectedWbsCostDisplay && selectedWbsLabel
    ? `${selectedWbsLabel} (${selectedWbsCostDisplay}) is shown here within the broader ${anchor?.label || 'Gateway'} roll-up.`
    : candidateWbsId && wbsContext
      ? `${anchor?.label || 'This cost area'} is the best-matching roll-up for WBS ${candidateWbsId}.`
      : anchorContext?.reason || 'The best-matching cost roll-up for what you were viewing.';

  return {
    anchor,
    anchorContext,
    wbsId: candidateWbsId,
    wbsName: candidateWbsId ? state.categoriesById.get(candidateWbsId)?.name || '' : '',
    selectedWbsLabel,
    selectedWbsCostM,
    selectedWbsCostDisplay,
    milestoneId,
    riskId,
    moduleKey,
    docId,
    title,
    body,
    riskCount: wbsContext?.risks.ids?.length || anchorContext?.riskIds?.length || 0,
    documentCount: wbsContext?.documents.sourceDocIds?.length || anchorContext?.documents.sourceDocIds?.length || 0,
  };
}

function buildSuiteAction(route, label, params) {
  return `
    <a class="suite-context-action" href="${escapeHtml(buildSuiteHref(route, params))}">
      ${escapeHtml(label)}
    </a>
  `;
}

function renderContextBanner(anchor = getCurrentAnchor()) {
  const context = buildCurrentContext(anchor);
  if (!context.anchor || !hasSharedContext(state.sharedContext)) return '';

  return `
    <section class="suite-context-banner">
      <h3 class="suite-context-banner__title">${escapeHtml(context.title)}</h3>
      <p class="suite-context-banner__body">${escapeHtml(context.body)}</p>
      <div class="suite-context-banner__chips">
        <span class="suite-context-chip"><strong>Cost area</strong>${escapeHtml(context.anchor.label)}</span>
        ${context.wbsId ? `<span class="suite-context-chip"><strong>WBS</strong>${escapeHtml(context.wbsId)}</span>` : ''}
        ${context.selectedWbsCostDisplay ? `<span class="suite-context-chip"><strong>Selected cost</strong>${escapeHtml(context.selectedWbsCostDisplay)}</span>` : ''}
        ${context.milestoneId ? `<span class="suite-context-chip"><strong>Schedule</strong>${escapeHtml(context.milestoneId)}</span>` : ''}
        ${context.riskId ? `<span class="suite-context-chip"><strong>Risk</strong>${escapeHtml(context.riskId)}</span>` : ''}
      </div>
      <div class="suite-context-actions">
        <button class="suite-context-action" type="button" data-action="reset-view">Reset view</button>
      </div>
    </section>
  `;
}

function renderAnchorConnections(anchor) {
  const context = buildCurrentContext(anchor);
  if (!context.anchor) return '';

  return `
    <section class="suite-context-card">
      <h4 class="suite-context-card__title">Open ${escapeHtml(context.anchor.label)} elsewhere</h4>
      <div class="suite-context-card__grid">
        <div class="suite-context-stat">
          <span class="suite-context-stat__label">Mapped WBS</span>
          <span class="suite-context-stat__value">${escapeHtml(context.wbsId ? `${context.wbsId}${context.wbsName ? ` - ${context.wbsName}` : ''}` : 'No direct WBS branch')}</span>
        </div>
        <div class="suite-context-stat">
          <span class="suite-context-stat__label">Schedule anchor</span>
          <span class="suite-context-stat__value">${escapeHtml(context.milestoneId || 'No direct schedule anchor')}</span>
        </div>
        <div class="suite-context-stat">
          <span class="suite-context-stat__label">Linked risks</span>
          <span class="suite-context-stat__value">${escapeHtml(String(context.riskCount))}</span>
        </div>
        <div class="suite-context-stat">
          <span class="suite-context-stat__label">Source docs</span>
          <span class="suite-context-stat__value">${escapeHtml(String(context.documentCount))}</span>
        </div>
      </div>
      <div class="suite-context-actions">
        ${buildSuiteAction('wbs', 'Open in WBS', {
          from: 'cost',
          wbs: context.wbsId,
          module: context.moduleKey,
        })}
        ${buildSuiteAction('schedule', 'Open in Schedule', {
          from: 'cost',
          wbs: context.wbsId,
          milestone: context.milestoneId,
        })}
        ${buildSuiteAction('documents', 'Open in Documents', {
          from: 'cost',
          wbs: context.wbsId,
          doc: context.docId,
        })}
        ${buildSuiteAction('risk', 'Open in Risk', {
          from: 'cost',
          wbs: context.wbsId,
          risk: context.riskId,
        })}
      </div>
    </section>
  `;
}

function normalizeSelections() {
  if (!state.selectedAnchorId || !state.anchorsById.has(state.selectedAnchorId)) {
    state.selectedAnchorId = getDefaultAnchorId();
  }

  if (!state.selectedYearId || !state.yearsById.has(state.selectedYearId)) {
    state.selectedYearId = getDefaultYearId();
  }

  if (!state.selectedMethodId || !state.methodsById.has(state.selectedMethodId)) {
    state.selectedMethodId = getDefaultMethodId();
  }
}

function resetView() {
  state.sharedContext = {};
  state.view = 'module';
  state.selectedAnchorId = getDefaultAnchorId();
  state.selectedYearId = getDefaultYearId();
  state.selectedMethodId = getDefaultMethodId();
  normalizeSelections();
  render();
}

function setView(view) {
  if (!viewDefinitions[view]) return;
  state.view = view;
  render();
}

function setAnchor(anchorId) {
  if (!state.anchorsById.has(anchorId)) return;
  state.selectedAnchorId = anchorId;
  render();
}

function setYear(fy) {
  if (!state.yearsById.has(fy)) return;
  state.selectedYearId = fy;
  render();
}

function setMethod(methodId) {
  if (!state.methodsById.has(methodId)) return;
  state.selectedMethodId = methodId;
  render();
}

function buildHeroSignals() {
  const busiestYear = state.data.overview.busiestYear;
  return [
    { label: 'Current estimate', value: formatCompactCurrency(state.data.overview.totalCostUsd) },
    { label: 'Time span', value: `FY${state.data.overview.startFy} - FY${state.data.overview.endFy}` },
    {
      label: 'Peak year',
      value: busiestYear ? `${busiestYear.fy} - ${formatCompactCurrency(busiestYear.totalUsd)}` : 'Not stated',
    },
  ];
}

function renderViewSwitcher() {
  const primaryViews = [
    { id: 'module', label: 'Gateway cost map' },
    { id: 'year', label: 'Yearly spend' },
  ];

  elements.viewSwitcher.innerHTML = `
    <div class="view-switcher__main">
      ${primaryViews
        .map(
          (view) => `
            <button
              class="view-switcher__button${state.view === view.id ? ' is-active' : ''}"
              type="button"
              data-view="${view.id}"
              aria-pressed="${String(state.view === view.id)}"
            >
              ${escapeHtml(view.label)}
            </button>
          `,
        )
        .join('')}
    </div>

    <button
      class="view-switcher__support${state.view === 'method' ? ' is-active' : ''}"
      type="button"
      data-view="method"
      aria-pressed="${String(state.view === 'method')}"
    >
      Defensibility
    </button>
  `;
}

function renderHero() {
  elements.appTitle.textContent = 'Cost Explorer';
  elements.appSubtitle.textContent =
    'Where the money sits across Gateway, by module and by year.';
  elements.snapshotStamp.textContent = `Updated ${new Date(state.data.generatedAt).toLocaleString()}`;
  elements.storySignals.innerHTML = buildHeroSignals()
    .map(
      (signal) => `
        <article class="signal-pill">
          <span class="signal-pill__label">${escapeHtml(signal.label)}</span>
          <span class="signal-pill__value">${escapeHtml(signal.value)}</span>
        </article>
      `,
    )
    .join('');
  renderViewSwitcher();
}

function buildMetricStrip(items) {
  return `
    <div class="detail-metrics">
      ${items
        .map(
          (item) => `
            <div class="detail-metric">
              <span class="detail-metric__label">${escapeHtml(item.label)}</span>
              <span class="detail-metric__value">${escapeHtml(item.value)}</span>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

function buildContributors(items, emptyCopy) {
  if (!items.length) {
    return `
      <div class="detail-item">
        <p class="detail-item__title">${escapeHtml(emptyCopy)}</p>
      </div>
    `;
  }

  return items
    .map(
      (item) => `
        <div class="detail-item">
          <div class="detail-item__topline">
            <span class="detail-item__title">${escapeHtml(item.name)}</span>
            <span class="detail-item__value mono">${formatCurrency(item.value || item.totalUsd || item.amountUsd)}</span>
          </div>
          ${item.note ? `<p class="detail-item__copy">${escapeHtml(item.note)}</p>` : ''}
        </div>
      `,
    )
    .join('');
}

function buildSourceCards(sources) {
  if (!sources.length) {
    return `
      <div class="detail-item">
        <p class="detail-item__title">No direct source links are attached to this view.</p>
      </div>
    `;
  }

  return sources
    .slice(0, 5)
    .map(
      (source) => `
        <article class="support-card">
          <div class="support-card__topline">
            <div>
              <h4>${escapeHtml(source.title)}</h4>
              <p class="support-card__meta">${escapeHtml(source.publisher || 'Source')}</p>
            </div>
            ${source.href ? `<a class="support-link" href="${escapeHtml(source.href)}" target="_blank" rel="noreferrer">Open</a>` : ''}
          </div>
        </article>
      `,
    )
    .join('');
}

function buildEvidenceDisclosure(title, bodyMarkup) {
  return `
    <details class="support-disclosure">
      <summary>${escapeHtml(title)}</summary>
      <div class="support-disclosure__body">
        ${bodyMarkup}
      </div>
    </details>
  `;
}

function buildDefensibilityDisclosure(note, title = 'How this was estimated') {
  const cards = state.data.methodology.cards.filter((card) =>
    ['methods', 'authority', 'judgment', 'reserve'].includes(card.id),
  );

  return `
    <details class="support-disclosure">
      <summary>${escapeHtml(title)}</summary>
      <div class="support-disclosure__body">
        <p class="support-copy">${escapeHtml(note)}</p>
        <div class="support-grid">
          ${cards
            .slice(0, 3)
            .map(
              (card) => `
                <article class="support-card">
                  <p class="support-card__eyebrow">${escapeHtml(card.eyebrow)}</p>
                  <h4>${escapeHtml(card.title)}</h4>
                  <p>${escapeHtml(card.summary)}</p>
                </article>
              `,
            )
            .join('')}
        </div>
      </div>
    </details>
  `;
}

function renderHotspot(anchor) {
  const isActive = anchor.id === state.selectedAnchorId;
  return `
    <button
      class="module-hit module-hit--${escapeHtml(anchor.visualId)}${isActive ? ' is-active' : ''}"
      type="button"
      data-anchor="${escapeHtml(anchor.id)}"
      aria-pressed="${String(isActive)}"
      aria-label="${escapeHtml(`${anchor.label} ${formatCompactCurrency(anchor.totalUsd)}`)}"
    >
      <span class="module-hit__label">${escapeHtml(anchor.shortLabel)}</span>
      <strong class="module-hit__value mono">${formatCompactCurrency(anchor.totalUsd)}</strong>
    </button>
  `;
}

function renderProgramNode(anchor) {
  const isActive = anchor.id === state.selectedAnchorId;
  return `
    <button
      class="program-node program-node--${escapeHtml(anchor.tone)}${isActive ? ' is-active' : ''}"
      type="button"
      data-anchor="${escapeHtml(anchor.id)}"
      aria-pressed="${String(isActive)}"
    >
      <span class="program-node__label">${escapeHtml(anchor.label)}</span>
      <strong class="program-node__value mono">${formatCompactCurrency(anchor.totalUsd)}</strong>
    </button>
  `;
}

function renderGatewayScene(selectedAnchor) {
  const physicalAnchors = state.anchors.filter((anchor) => anchor.visualId);
  const adjacentAnchors = state.anchors.filter((anchor) => !anchor.visualId);

  return `
    <div class="gateway-map">
      <div class="gateway-map__scene" aria-hidden="true">
        <svg class="gateway-svg" viewBox="0 0 1080 720" role="presentation">
          <defs>
            <radialGradient id="sceneGlow" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stop-color="rgba(103, 204, 255, 0.18)" />
              <stop offset="100%" stop-color="rgba(103, 204, 255, 0)" />
            </radialGradient>
            <pattern id="solarPattern" width="18" height="18" patternUnits="userSpaceOnUse">
              <rect width="18" height="18" fill="rgba(103, 204, 255, 0.04)" />
              <path d="M0 0H18M0 0V18" stroke="rgba(103, 204, 255, 0.16)" stroke-width="1" />
            </pattern>
          </defs>

          <ellipse class="gateway-svg__orbit" cx="540" cy="360" rx="430" ry="214" />
          <ellipse class="gateway-svg__halo" cx="540" cy="360" rx="290" ry="156" fill="url(#sceneGlow)" />

          <g class="gateway-svg__solar gateway-svg__solar--left">
            <rect x="38" y="246" width="220" height="226" rx="24" class="gateway-svg__solar-frame" />
            <rect x="56" y="262" width="184" height="194" rx="18" fill="url(#solarPattern)" />
          </g>

          <g class="gateway-svg__solar gateway-svg__solar--right">
            <rect x="822" y="246" width="220" height="226" rx="24" class="gateway-svg__solar-frame" />
            <rect x="840" y="262" width="184" height="194" rx="18" fill="url(#solarPattern)" />
          </g>

          <g class="gateway-svg__backbone">
            <rect x="248" y="348" width="586" height="18" rx="9" class="gateway-svg__truss" />
            <rect x="298" y="330" width="18" height="54" rx="9" class="gateway-svg__truss" />
            <rect x="764" y="330" width="18" height="54" rx="9" class="gateway-svg__truss" />
          </g>

          <g class="gateway-svg__element gateway-svg__element--ppe${selectedAnchor.visualId === 'ppe' ? ' is-active' : ''}">
            <rect x="264" y="314" width="118" height="84" rx="36" class="gateway-svg__body" />
            <circle cx="276" cy="356" r="16" class="gateway-svg__cap" />
            <circle cx="370" cy="356" r="16" class="gateway-svg__cap" />
          </g>

          <g class="gateway-svg__element gateway-svg__element--halo${selectedAnchor.visualId === 'halo' ? ' is-active' : ''}">
            <rect x="382" y="286" width="210" height="140" rx="52" class="gateway-svg__body" />
            <circle cx="398" cy="356" r="18" class="gateway-svg__cap" />
            <circle cx="576" cy="356" r="18" class="gateway-svg__cap" />
          </g>

          <g class="gateway-svg__element gateway-svg__element--ihab${selectedAnchor.visualId === 'ihab' ? ' is-active' : ''}">
            <rect x="602" y="288" width="208" height="136" rx="52" class="gateway-svg__body" />
            <circle cx="618" cy="356" r="18" class="gateway-svg__cap" />
            <circle cx="794" cy="356" r="18" class="gateway-svg__cap" />
          </g>

          <g class="gateway-svg__element gateway-svg__element--esprit${selectedAnchor.visualId === 'esprit' ? ' is-active' : ''}">
            <rect x="820" y="322" width="118" height="72" rx="30" class="gateway-svg__body" />
            <circle cx="834" cy="358" r="14" class="gateway-svg__cap" />
            <circle cx="924" cy="358" r="14" class="gateway-svg__cap" />
          </g>

          <g class="gateway-svg__element gateway-svg__element--airlock${selectedAnchor.visualId === 'airlock' ? ' is-active' : ''}">
            <circle cx="546" cy="520" r="46" class="gateway-svg__body gateway-svg__body--round" />
            <circle cx="546" cy="520" r="18" class="gateway-svg__cap" />
            <rect x="534" y="426" width="24" height="52" rx="12" class="gateway-svg__strut" />
          </g>

          <g class="gateway-svg__element gateway-svg__element--arm${selectedAnchor.visualId === 'arm' ? ' is-active' : ''}">
            <path d="M744 248L872 172L976 108" class="gateway-svg__arm" />
            <circle cx="744" cy="248" r="14" class="gateway-svg__joint" />
            <circle cx="872" cy="172" r="14" class="gateway-svg__joint" />
            <circle cx="976" cy="108" r="14" class="gateway-svg__joint" />
          </g>

          <g class="gateway-svg__tag gateway-svg__tag--ppe${selectedAnchor.visualId === 'ppe' ? ' is-active' : ''}">
            <line x1="322" y1="298" x2="322" y2="254" class="gateway-svg__tag-line" />
            <rect x="268" y="224" width="108" height="32" rx="16" class="gateway-svg__tag-box" />
            <text x="322" y="244" class="gateway-svg__tag-text">PPE</text>
          </g>

          <g class="gateway-svg__tag gateway-svg__tag--halo${selectedAnchor.visualId === 'halo' ? ' is-active' : ''}">
            <line x1="488" y1="270" x2="488" y2="226" class="gateway-svg__tag-line" />
            <rect x="424" y="194" width="128" height="32" rx="16" class="gateway-svg__tag-box" />
            <text x="488" y="214" class="gateway-svg__tag-text">HALO</text>
          </g>

          <g class="gateway-svg__tag gateway-svg__tag--ihab${selectedAnchor.visualId === 'ihab' ? ' is-active' : ''}">
            <line x1="706" y1="272" x2="706" y2="226" class="gateway-svg__tag-line" />
            <rect x="634" y="194" width="144" height="32" rx="16" class="gateway-svg__tag-box" />
            <text x="706" y="214" class="gateway-svg__tag-text">I-HAB</text>
          </g>

          <g class="gateway-svg__tag gateway-svg__tag--esprit${selectedAnchor.visualId === 'esprit' ? ' is-active' : ''}">
            <line x1="880" y1="318" x2="880" y2="280" class="gateway-svg__tag-line" />
            <rect x="812" y="248" width="136" height="32" rx="16" class="gateway-svg__tag-box" />
            <text x="880" y="268" class="gateway-svg__tag-text">ESPRIT</text>
          </g>

          <g class="gateway-svg__tag gateway-svg__tag--arm${selectedAnchor.visualId === 'arm' ? ' is-active' : ''}">
            <line x1="934" y1="104" x2="934" y2="68" class="gateway-svg__tag-line" />
            <rect x="854" y="36" width="160" height="32" rx="16" class="gateway-svg__tag-box" />
            <text x="934" y="56" class="gateway-svg__tag-text">Canadarm3</text>
          </g>

          <g class="gateway-svg__tag gateway-svg__tag--airlock${selectedAnchor.visualId === 'airlock' ? ' is-active' : ''}">
            <line x1="546" y1="566" x2="546" y2="604" class="gateway-svg__tag-line" />
            <rect x="476" y="604" width="140" height="32" rx="16" class="gateway-svg__tag-box" />
            <text x="546" y="624" class="gateway-svg__tag-text">Airlock</text>
          </g>
        </svg>
      </div>

      <div class="gateway-map__hotspots">
        ${physicalAnchors.map((anchor) => renderHotspot(anchor)).join('')}
      </div>
    </div>

    <div class="adjacent-program">
      <p class="adjacent-program__label">Adjacent program cost</p>
      <div class="adjacent-program__nodes">
        ${adjacentAnchors.map((anchor) => renderProgramNode(anchor)).join('')}
      </div>
    </div>
  `;
}

function renderAnchorFocus(anchor) {
  const topDrivers = anchor.contributors.slice(0, 4);
  const peakYears = [...anchor.yearly]
    .filter((entry) => entry.totalUsd > 0)
    .sort((left, right) => right.totalUsd - left.totalUsd)
    .slice(0, 3)
    .map((entry) => ({ name: entry.fy, value: entry.totalUsd }));

  return `
    <aside class="focus-panel detail-panel">
      <div>
        <h3>${escapeHtml(anchor.label)}</h3>
        <p class="focus-panel__summary">${escapeHtml(anchor.primaryNote)}</p>
      </div>

      <div class="focus-panel__value mono">${formatCurrency(anchor.totalUsd)}</div>

      ${buildMetricStrip([
        { label: 'Share of total', value: formatPercent(anchor.shareOfProgram) },
        {
          label: 'Peak year',
          value: anchor.topYear ? `${anchor.topYear.fy} - ${formatCompactCurrency(anchor.topYear.totalUsd)}` : 'Not stated',
        },
        { label: 'Linked categories', value: String(anchor.categories.length) },
        { label: 'Source links', value: String(anchor.linkedSources.length) },
      ])}

      <section class="focus-statement">
        <h4>Why it matters</h4>
        <p>${escapeHtml(anchor.why)}</p>
      </section>

      <details class="focus-disclosure">
        <summary class="focus-disclosure__summary">
          <span class="focus-disclosure__title">Main cost drivers</span>
          <span class="focus-disclosure__chevron" aria-hidden="true">▾</span>
        </summary>
        <div class="focus-disclosure__body">
          <div class="detail-list">
            ${buildContributors(topDrivers, 'No cost drivers.')}
          </div>
        </div>
      </details>

      <details class="focus-disclosure">
        <summary class="focus-disclosure__summary">
          <span class="focus-disclosure__title">When cost peaks</span>
          <span class="focus-disclosure__chevron" aria-hidden="true">▾</span>
        </summary>
        <div class="focus-disclosure__body">
          <div class="detail-list">
            ${buildContributors(peakYears, 'No annual phasing.')}
          </div>
        </div>
      </details>

      ${renderAnchorConnections(anchor)}
    </aside>
  `;
}

function renderAnchorSupport(anchor) {
  return `
    <section class="module-support">
      <div class="module-support__heading">
        <div>
          <h3>Evidence and sources for ${escapeHtml(anchor.label)}</h3>
        </div>
      </div>

      ${buildEvidenceDisclosure(
        'Show evidence',
        `
          <div class="support-grid support-grid--wide">
            <section class="support-block">
              <h4>Representative evidence</h4>
              <div class="detail-list">
                ${buildContributors(
                  anchor.representativeDetails.map((detail) => ({
                    name: detail.name,
                    value: detail.amountUsd,
                    note: `${detail.fy || 'No FY stated'} - ${detail.component || 'detail'}`,
                  })),
                  'No detail rows.',
                )}
              </div>
            </section>

            <section class="support-block">
              <h4>Direct priced support</h4>
              <div class="detail-list">
                ${buildContributors(
                  anchor.pricedLines.map((line) => ({
                    name: line.description,
                    value: line.totalUsd,
                    note: line.contractType || 'Priced line evidence',
                  })),
                  'No priced lines.',
                )}
              </div>
            </section>
          </div>
        `,
      )}

      ${buildEvidenceDisclosure(
        'Show source support',
        `
          <div class="support-source-list">
            ${buildSourceCards(anchor.linkedSources)}
          </div>
        `,
      )}

      ${buildDefensibilityDisclosure(anchor.judgmentNote, 'How this area was estimated')}
    </section>
  `;
}

function renderModuleView() {
  const anchor = getCurrentAnchor();

  return `
    <div class="module-story">
      ${renderContextBanner(anchor)}
      <div class="module-story__primary">
        <section class="hero-map">
          <div class="hero-map__topline">
            <div>
              <h3>Where the money sits across Gateway</h3>
            </div>
            <p class="hero-map__note">
              Click a module to see its cost detail.
            </p>
          </div>

          ${renderGatewayScene(anchor)}
        </section>

        ${renderAnchorFocus(anchor)}
      </div>

      ${renderAnchorSupport(anchor)}
    </div>
  `;
}

function renderYearChart() {
  const maxYearTotal = Math.max(...state.data.years.map((year) => year.totalUsd), 1);

  return `
    <div class="year-chart">
      ${state.data.years
        .map((year) => {
          const totalWidth = `${Math.max((year.totalUsd / maxYearTotal) * 100, 7)}%`;
          const total = year.totalUsd || 1;
          const laborWidth = `${(year.laborUsd / total) * 100}%`;
          const materialWidth = `${(year.materialUsd / total) * 100}%`;
          const integrationWidth = `${(year.integrationUsd / total) * 100}%`;
          const reserveWidth = `${(year.reserveUsd / total) * 100}%`;

          return `
            <button
              class="year-row${year.fy === state.selectedYearId ? ' year-row--active' : ''}"
              type="button"
              data-year="${escapeHtml(year.fy)}"
              aria-pressed="${String(year.fy === state.selectedYearId)}"
            >
              <div class="year-row__head">
                <span class="year-row__fy">${escapeHtml(year.fy)}</span>
                ${year.fy === state.selectedYearId ? '<span class="row-flag">Selected year</span>' : ''}
              </div>

              <div class="year-row__track">
                <span class="year-row__fill" style="width:${totalWidth}">
                  <span class="year-row__segment year-row__segment--labor" style="width:${laborWidth}"></span>
                  <span class="year-row__segment year-row__segment--material" style="width:${materialWidth}"></span>
                  <span class="year-row__segment year-row__segment--integration" style="width:${integrationWidth}"></span>
                  <span class="year-row__segment year-row__segment--reserve" style="width:${reserveWidth}"></span>
                </span>
              </div>

              <div class="year-row__value mono">${formatCompactCurrency(year.totalUsd)}</div>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function buildCategorySourceList(categoryIds) {
  const sources = [];
  categoryIds.forEach((categoryId) => {
    const category = state.categoriesById.get(categoryId);
    if (!category) return;
    category.linkedSources.forEach((source) => sources.push(source));
  });
  return uniqueById(sources);
}

function renderYearFocus(year) {
  const drivers = year.topBreakdown.slice(0, 4).map((entry) => ({
    name: entry.name,
    value: entry.totalUsd,
    note: entry.scopeLabel,
  }));
  const yearSources = buildCategorySourceList(year.topBreakdown.map((entry) => entry.id));

  return `
    <aside class="focus-panel detail-panel">
      <div>
        <h3>${escapeHtml(year.fy)}</h3>
        <p class="focus-panel__summary">${escapeHtml(year.narrative)}</p>
      </div>

      <div class="focus-panel__value mono">${formatCurrency(year.totalUsd)}</div>

      ${buildMetricStrip([
        { label: 'Direct cost', value: formatCompactCurrency(year.directUsd) },
        { label: 'Reserve', value: formatCompactCurrency(year.reserveUsd) },
        { label: 'Labor', value: formatCompactCurrency(year.laborUsd) },
        { label: 'Top driver', value: drivers[0] ? drivers[0].name : 'Not stated' },
      ])}

      <section class="focus-statement">
        <h4>Why this year matters</h4>
        <p>${escapeHtml(year.narrative)}</p>
      </section>

      <details class="focus-disclosure">
        <summary class="focus-disclosure__summary">
          <span class="focus-disclosure__title">Main drivers in ${escapeHtml(year.fy)}</span>
          <span class="focus-disclosure__chevron" aria-hidden="true">▾</span>
        </summary>
        <div class="focus-disclosure__body">
          <div class="detail-list">
            ${buildContributors(drivers, 'No cost drivers.')}
          </div>
        </div>
      </details>

      <details class="focus-disclosure">
        <summary class="focus-disclosure__summary">
          <span class="focus-disclosure__title">Reserve and timing</span>
          <span class="focus-disclosure__chevron" aria-hidden="true">▾</span>
        </summary>
        <div class="focus-disclosure__body">
          <div class="detail-list">
            <div class="detail-item">
              <p class="detail-item__title">
                ${year.reserveUsd
                  ? `Reserve carries ${formatCurrency(year.reserveUsd)} in ${year.fy}.`
                  : `No explicit reserve is carried in ${year.fy}.`}
              </p>
            </div>
            <div class="detail-item">
              <p class="detail-item__title">Direct cost in ${escapeHtml(year.fy)} is ${formatCurrency(year.directUsd)}.</p>
            </div>
          </div>
        </div>
      </details>
    </aside>
  `;
}

function renderYearSupport(year) {
  const drivers = year.topBreakdown.slice(0, 4).map((entry) => ({
    name: entry.name,
    value: entry.totalUsd,
    note: entry.scopeLabel,
  }));
  const yearSources = buildCategorySourceList(year.topBreakdown.map((entry) => entry.id));

  return `
    <section class="module-support">
      <div class="module-support__heading">
        <div>
          <h3>Evidence and sources for ${escapeHtml(year.fy)}</h3>
        </div>
      </div>

      ${buildEvidenceDisclosure(
        'Show evidence',
        `
          <div class="support-grid support-grid--wide">
            <section class="support-block">
              <h4>Driver evidence</h4>
              <div class="detail-list">
                ${buildContributors(drivers, 'No drivers.')}
              </div>
            </section>

            <section class="support-block">
              <h4>Reserve and phasing context</h4>
              <p class="support-copy">${escapeHtml(state.data.overview.directSummary)}</p>
            </section>
          </div>
        `,
      )}

      ${buildEvidenceDisclosure(
        'Show source support',
        `
          <div class="support-source-list">
            ${buildSourceCards(yearSources)}
          </div>
        `,
      )}

      ${buildDefensibilityDisclosure(state.data.overview.judgmentSummary, 'How this year was estimated')}
    </section>
  `;
}

function renderYearView() {
  const year = getCurrentYear();

  return `
    <div class="year-story">
      ${renderContextBanner(getCurrentAnchor())}
      <div class="year-story__primary">
        <section class="year-panel">
          <div class="year-panel__topline">
            <div>
              <h3>How annual spend moves over time</h3>
            </div>
            <p class="year-panel__note">
              Click a year for detail.
            </p>
          </div>

          <div class="year-legend">
            <span class="legend-pill"><span class="legend-pill__swatch legend-pill__swatch--labor"></span>Labor</span>
            <span class="legend-pill"><span class="legend-pill__swatch legend-pill__swatch--material"></span>Material</span>
            <span class="legend-pill"><span class="legend-pill__swatch legend-pill__swatch--integration"></span>Integration</span>
            <span class="legend-pill"><span class="legend-pill__swatch legend-pill__swatch--reserve"></span>Reserve</span>
          </div>

          ${renderYearChart()}
        </section>

        ${renderYearFocus(year)}
      </div>

      ${renderYearSupport(year)}
    </div>
  `;
}

function getMethodSupportingFiles(cardId) {
  const files = [];

  if (['included', 'methods', 'reserve', 'judgment'].includes(cardId)) {
    files.push(
      {
        id: 'gateway_cost_basis_of_estimate.rtf',
        title: 'Cost basis of estimate',
        href: repoSourceHref('Contract_Cost_Schedule Documents/docs/gateway_cost_basis_of_estimate.rtf'),
        publisher: 'Source file',
        authorityTier: 'methodology',
      },
      {
        id: 'gateway_cost_estimate_detail.csv',
        title: 'Grouped cost detail',
        href: repoSourceHref('Contract_Cost_Schedule Documents/data/gateway_cost_estimate_detail.csv'),
        publisher: 'Source file',
        authorityTier: 'detail data',
      },
    );
  }

  if (['authority', 'judgment', 'methods'].includes(cardId)) {
    files.push(
      {
        id: 'gateway_data_authority_guide.rtf',
        title: 'Data guide',
        href: repoSourceHref('Contract_Cost_Schedule Documents/docs/gateway_data_authority_guide.rtf'),
        publisher: 'Source file',
        authorityTier: 'traceability',
      },
      {
        id: 'gateway_source_reference_register.csv',
        title: 'Source reference register',
        href: repoSourceHref('Contract_Cost_Schedule Documents/data/gateway_source_reference_register.csv'),
        publisher: 'Source file',
        authorityTier: 'source register',
      },
    );
  }

  return uniqueById(files);
}

function renderMethodView() {
  const supportFiles = getMethodSupportingFiles('methods');

  return `
    <div class="method-story">
      ${renderContextBanner(getCurrentAnchor())}

      <section class="method-panel">
        <div class="method-panel__topline">
          <p class="method-panel__summary">${escapeHtml(state.data.methodology.summary)}</p>
        </div>

        <div class="method-accordion">
          ${state.data.methodology.cards
            .map(
              (card) => `
                <details class="method-accordion-item">
                  <summary class="method-accordion-item__summary">
                    <span class="method-accordion-item__eyebrow">${escapeHtml(card.eyebrow)}</span>
                    <span class="method-accordion-item__title">${escapeHtml(card.title)}</span>
                    <span class="method-accordion-item__preview">${escapeHtml(card.summary)}</span>
                    <span class="method-accordion-item__chevron" aria-hidden="true">▾</span>
                  </summary>
                  <div class="method-accordion-item__body">
                    <ul class="method-accordion-item__list">
                      ${card.items
                        .map(
                          (item) => `<li>${escapeHtml(item)}</li>`,
                        )
                        .join('')}
                    </ul>
                  </div>
                </details>
              `,
            )
            .join('')}
        </div>

        ${buildEvidenceDisclosure(
          'Show source support',
          `
            <div class="support-source-list">
              ${buildSourceCards(supportFiles)}
            </div>
          `,
        )}
      </section>
    </div>
  `;
}

function renderActiveView() {
  const definition = viewDefinitions[state.view];
  elements.activeViewKicker.textContent = definition.kicker;
  elements.activeViewHeading.textContent = definition.heading;
  elements.activeViewSubcopy.textContent = definition.subcopy;

  if (state.view === 'module') {
    elements.activeViewContent.innerHTML = renderModuleView();
    return;
  }

  if (state.view === 'year') {
    elements.activeViewContent.innerHTML = renderYearView();
    return;
  }

  elements.activeViewContent.innerHTML = renderMethodView();
}

function renderError(message) {
  const safeMessage = escapeHtml(message);
  elements.storySignals.innerHTML = '';
  elements.viewSwitcher.innerHTML = '';
  elements.snapshotStamp.textContent = 'Data unavailable';
  elements.activeViewKicker.textContent = 'Cost Explorer';
  elements.activeViewHeading.textContent = 'Could not load data';
  elements.activeViewSubcopy.textContent = '';
  elements.activeViewContent.innerHTML = `
    <section class="loading-state">
      <h3>Could not load data</h3>
      <p>${safeMessage}</p>
    </section>
  `;
}

function render() {
  if (state.error) {
    renderError(state.error);
    return;
  }

  renderHero();
  renderActiveView();
  syncUrlState();
  syncSuiteNavigation();
}

function handleClick(event) {
  const actionButton = event.target.closest('[data-action]');
  if (actionButton?.dataset.action === 'reset-view') {
    resetView();
    return;
  }

  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    setView(viewButton.dataset.view);
    return;
  }

  const anchorButton = event.target.closest('[data-anchor]');
  if (anchorButton) {
    setAnchor(anchorButton.dataset.anchor);
    return;
  }

  const yearButton = event.target.closest('[data-year]');
  if (yearButton) {
    setYear(yearButton.dataset.year);
    return;
  }

  const methodButton = event.target.closest('[data-method]');
  if (methodButton) {
    setMethod(methodButton.dataset.method);
  }
}

async function loadDataset() {
  try {
    const [response, crosswalk] = await Promise.all([
      fetch('./data/gateway-cost.json'),
      loadSuiteCrosswalk(CROSSWALK_URL),
    ]);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while loading gateway-cost.json`);
    }

    const data = await response.json();
    const urlParams = new URLSearchParams(window.location.search);
    state.data = data;
    state.crosswalk = crosswalk;
    state.sharedContext = readSharedContext();
    if (state.sharedContext.wbs) {
      await ensureWbsNodesById();
    }
    state.categoriesById = new Map(data.categories.map((category) => [category.id, category]));
    state.yearsById = new Map(data.years.map((year) => [year.fy, year]));
    state.methodsById = new Map(data.methodology.cards.map((card) => [card.id, card]));
    state.anchors = buildAnchors(data);
    state.anchorsById = new Map(state.anchors.map((anchor) => [anchor.id, anchor]));
    state.view = ['module', 'year', 'method'].includes(urlParams.get('view')) ? urlParams.get('view') : 'module';
    state.selectedAnchorId = resolveAnchorIdFromContext(state.sharedContext, urlParams.get('anchor') || '');
    state.selectedYearId = urlParams.get('year') || data.defaultSelection?.defaultYear || null;
    state.selectedMethodId = urlParams.get('method') || null;
    normalizeSelections();
    render();
  } catch (error) {
    console.error('Failed to load cost data', error);
    state.error = error instanceof Error ? error.message : 'Unknown load failure';
    render();
  }
}

document.addEventListener('click', handleClick);
loadDataset();

