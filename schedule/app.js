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

const DATA_URL = './data/gateway-schedule.json';
const CROSSWALK_URL = '../suite-assets/data/gateway-crosswalk.json';

const appTitle = document.getElementById('appTitle');
const appSubtitle = document.getElementById('appSubtitle');
const generatedAt = document.getElementById('generatedAt');
const storySignals = document.getElementById('storySignals');
const stageFrame = document.getElementById('stageFrame');
const overviewContent = document.getElementById('overviewContent');
const timelineChart = document.getElementById('timelineChart');
const milestoneStrip = document.getElementById('milestoneStrip');
const detailPanel = document.getElementById('detailPanel');
const detailHeading = document.getElementById('detailHeading');
const detailSubtitle = document.getElementById('detailSubtitle');
const detailContent = document.getElementById('detailContent');

// The six dates that anchor the chart's Key set alongside every phase's
// curated keyMilestoneIds. No other milestone id list exists in the app;
// everything else derives from the dataset.
const TIMELINE_ANCHORS = ['M-001', 'M-009', 'M-017', 'M-024', 'M-030', 'M-037'];

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const state = {
  data: null,
  milestonesById: new Map(),
  phasesById: new Map(),
  yearsById: new Map(),
  driversById: new Map(),
  selection: null,
  activeDriverId: null,
  milestoneDensity: 'key',
  crosswalk: null,
  sharedContext: {},
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function firstSentence(value) {
  const text = cleanText(value);
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  return match ? match[0].trim() : text;
}

function pluralize(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function dateValue(value) {
  return new Date(`${value}T00:00:00Z`).getTime();
}

function uniqueById(items) {
  const seen = new Map();
  items.filter(Boolean).forEach((item) => {
    if (!seen.has(item.id)) seen.set(item.id, item);
  });
  return [...seen.values()];
}

function tagClass(tone) {
  switch (tone) {
    case 'forest':
      return 'tag tag--forest';
    case 'copper':
      return 'tag tag--copper';
    case 'plum':
      return 'tag tag--plum';
    case 'danger':
      return 'tag tag--danger';
    default:
      return 'tag tag--brand';
  }
}

function buildMaps(data) {
  state.milestonesById = new Map(data.milestones.map((item) => [item.id, item]));
  state.phasesById = new Map(data.phases.map((item) => [item.id, item]));
  state.yearsById = new Map(data.years.map((item) => [String(item.year), item]));
  state.driversById = new Map(data.drivers.map((item) => [item.id, item]));
}

function getScope() {
  if (!wbsIsScope(state.sharedContext)) return null;
  return resolveScope(state.crosswalk, state.sharedContext?.wbs);
}

// The crosswalk is the join table between WBS and schedule: the scoped
// milestone set is the union of schedule.milestoneIds over every crosswalk
// WBS node inside the scope subtree. Returns null when no scope is active.
function getScopedMilestoneIdSet() {
  const scope = getScope();
  if (!scope) return null;

  const ids = new Set();
  Object.values(state.crosswalk?.wbs?.byId || {}).forEach((node) => {
    if (!scope.has(node.id)) return;
    (node.schedule?.milestoneIds || []).forEach((id) => ids.add(id));
  });
  return ids;
}

function isMilestoneInScope(milestoneId, scopedIds = getScopedMilestoneIdSet()) {
  return !scopedIds || scopedIds.has(milestoneId);
}

function getSelectedMilestone() {
  return state.selection?.type === 'milestone' ? state.milestonesById.get(state.selection.id) || null : null;
}

function getSelectedPhase() {
  return state.selection?.type === 'phase' ? state.phasesById.get(state.selection.id) || null : null;
}

function getFocusedPhase() {
  const milestone = getSelectedMilestone();
  if (milestone) return state.phasesById.get(milestone.phaseId) || null;
  return getSelectedPhase();
}

function getPhaseDrivers(phaseId) {
  return state.data.drivers.filter((driver) => driver.primaryPhaseId === phaseId);
}

function getMilestoneDrivers(milestone) {
  return state.data.drivers.filter((driver) => driver.linkedMilestones.some((item) => item.id === milestone.id));
}

function getActiveDriver() {
  return state.driversById.get(state.activeDriverId) || state.driversById.get(state.data.defaultDriverId) || state.data.drivers[0] || null;
}

function getSelectedContext() {
  const milestone = getSelectedMilestone();
  if (milestone) {
    const milestoneContext = state.crosswalk?.schedule?.byMilestoneId?.[milestone.id];
    return {
      milestone,
      phase: state.phasesById.get(milestone.phaseId) || null,
      wbsId: milestoneContext?.primaryWbsId || milestone.task?.wbsId || '',
      riskId: milestoneContext?.risks.ids?.[0] || milestone.linkedRisks[0]?.id || '',
      docId: milestoneContext?.documents.sourceDocIds?.[0] || '',
      moduleKey: milestoneContext?.simulation.moduleKeys?.[0] || '',
      body: milestoneContext?.reason || `Selected because ${milestone.shortName} is the strongest linked schedule anchor in the current crosswalk.`,
    };
  }

  const phase = getSelectedPhase();
  if (phase) {
    const phaseContext = state.crosswalk?.schedule?.byPhaseId?.[phase.id];
    return {
      milestone: phaseContext?.primaryMilestoneId ? state.milestonesById.get(phaseContext.primaryMilestoneId) || null : null,
      phase,
      wbsId: phaseContext?.primaryWbsId || '',
      riskId: phaseContext?.riskIds?.[0] || '',
      docId: phaseContext?.documents.sourceDocIds?.[0] || '',
      moduleKey: phaseContext?.simulation.moduleKeys?.[0] || '',
      body: phaseContext?.reason || `Selected because ${phase.name} is the clearest phase-level schedule grouping in the current data.`,
    };
  }

  return {
    milestone: null,
    phase: null,
    wbsId: '',
    riskId: '',
    docId: '',
    moduleKey: '',
    body: '',
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
    from: 'schedule',
    wbs: getScope()?.id || '',
  };
}

function syncSuiteNavigation() {
  applySuiteNav(buildTopNavContext(), { currentRoute: 'schedule' });
}

function getDefaultSelection() {
  return state.data?.defaultSelection || null;
}

function isDefaultSelection(selection) {
  const defaultSelection = getDefaultSelection();
  if (!selection && !defaultSelection) return true;
  if (!selection || !defaultSelection) return false;
  return selection.type === defaultSelection.type && selection.id === defaultSelection.id;
}

function syncUrlState() {
  const milestone = getSelectedMilestone();
  const phase = getSelectedPhase();
  const contextIsActive = hasSharedContext(state.sharedContext);
  const selectionIsDefault = isDefaultSelection(state.selection);
  const shouldPersistSelection = contextIsActive || !selectionIsDefault;

  mergeQueryState({
    ...getSharedContextEntries(state.sharedContext),
    milestone: shouldPersistSelection ? milestone?.id || '' : '',
    phase: shouldPersistSelection ? (milestone ? milestone.phaseId : phase?.id || '') : '',
  });
}

function resolveInitialSelection() {
  const milestoneFromUrl = state.sharedContext.milestone;
  if (milestoneFromUrl && state.milestonesById.has(milestoneFromUrl)) {
    return { type: 'milestone', id: milestoneFromUrl };
  }

  const phaseFromUrl = state.sharedContext.phase;
  if (phaseFromUrl && state.phasesById.has(phaseFromUrl)) {
    return { type: 'phase', id: phaseFromUrl };
  }

  const wbsContext = state.sharedContext.wbs ? state.crosswalk?.wbs?.byId?.[state.sharedContext.wbs] : null;
  if (wbsContext?.schedule.primaryMilestoneId && state.milestonesById.has(wbsContext.schedule.primaryMilestoneId)) {
    return { type: 'milestone', id: wbsContext.schedule.primaryMilestoneId };
  }
  if (wbsContext?.schedule.phaseId && state.phasesById.has(wbsContext.schedule.phaseId)) {
    return { type: 'phase', id: wbsContext.schedule.phaseId };
  }

  const riskContext = state.sharedContext.risk ? state.crosswalk?.risk?.byId?.[state.sharedContext.risk] : null;
  if (riskContext?.primaryMilestoneId && state.milestonesById.has(riskContext.primaryMilestoneId)) {
    return { type: 'milestone', id: riskContext.primaryMilestoneId };
  }

  const moduleContext = state.sharedContext.module
    ? state.crosswalk?.simulation?.byModuleKey?.[state.sharedContext.module]
    : null;
  if (moduleContext?.primaryMilestoneId && state.milestonesById.has(moduleContext.primaryMilestoneId)) {
    return { type: 'milestone', id: moduleContext.primaryMilestoneId };
  }

  return state.data.defaultSelection || null;
}

function renderContextBanner() {
  if (getScope()) return '';
  const context = getSelectedContext();
  if (!hasSharedContext(state.sharedContext) || (!context.milestone && !context.phase)) return '';

  const title = context.wbsId
    ? `Showing schedule activity related to WBS ${context.wbsId}`
    : context.milestone
      ? `Showing schedule activity for ${context.milestone.shortName}`
      : `Showing schedule activity for ${context.phase.name}`;

  return `
    <section class="suite-context-banner">
      <p class="suite-context-banner__eyebrow">Cross-App Context</p>
      <h3 class="suite-context-banner__title">${escapeHtml(title)}</h3>
      <p class="suite-context-banner__body">${escapeHtml(context.body)}</p>
      <div class="suite-context-banner__chips">
        ${context.phase ? `<span class="suite-context-chip"><strong>Phase</strong>${escapeHtml(context.phase.name)}</span>` : ''}
        ${context.milestone ? `<span class="suite-context-chip"><strong>Milestone</strong>${escapeHtml(context.milestone.id)}</span>` : ''}
        ${context.wbsId ? `<span class="suite-context-chip"><strong>WBS</strong>${escapeHtml(context.wbsId)}</span>` : ''}
      </div>
      <div class="suite-context-actions">
        <button class="suite-context-action" type="button" data-action="reset-view">Reset view</button>
      </div>
    </section>
  `;
}

function renderContextActions() {
  const context = getSelectedContext();
  return `
    <div class="suite-context-actions">
      ${buildSuiteAction('wbs', 'Open in WBS', {
        from: 'schedule',
        wbs: getScope()?.id || '',
        milestone: context.milestone?.id || '',
      })}
      ${buildSuiteAction('cost', 'Open in Cost', {
        from: 'schedule',
        wbs: getScope()?.id || '',
        milestone: context.milestone?.id || '',
        view: 'module',
      })}
      ${buildSuiteAction('risk', 'Open in Risk', {
        from: 'schedule',
        wbs: getScope()?.id || '',
        milestone: context.milestone?.id || '',
        risk: context.riskId,
      })}
      ${buildSuiteAction('documents', 'Open in Documents', {
        from: 'schedule',
        wbs: getScope()?.id || '',
        milestone: context.milestone?.id || '',
        doc: context.docId,
      })}
    </div>
  `;
}

function buildEmptyState(title, body) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
}

function syncActiveDriver(selection) {
  if (!selection) {
    state.activeDriverId = state.data.defaultDriverId;
    return;
  }

  if (selection.type === 'phase') {
    const driver = getPhaseDrivers(selection.id)[0];
    state.activeDriverId = driver?.id || state.data.defaultDriverId;
    return;
  }

  if (selection.type === 'milestone') {
    const milestone = state.milestonesById.get(selection.id);
    if (!milestone) {
      state.activeDriverId = state.data.defaultDriverId;
      return;
    }

    const driver = getMilestoneDrivers(milestone)[0] || getPhaseDrivers(milestone.phaseId)[0];
    state.activeDriverId = driver?.id || state.data.defaultDriverId;
    return;
  }

  state.activeDriverId = state.data.defaultDriverId;
}

function setSelection(selection) {
  state.selection = selection;
  syncActiveDriver(selection);
  renderApp();
}

function buildSignalPills() {
  storySignals.innerHTML = '';
}

function getKeyMilestoneIdSet() {
  return new Set([
    ...TIMELINE_ANCHORS,
    ...state.data.phases.flatMap((phase) => phase.keyMilestoneIds || []),
  ]);
}

// Milestones drawn on the lanes: scope-filtered, then thinned to the Key set
// unless density is `all`. The current selection always stays visible.
function getTimelineMilestones() {
  const scopedIds = getScopedMilestoneIdSet();
  const keyIds = getKeyMilestoneIdSet();
  const selectedId = state.selection?.type === 'milestone' ? state.selection.id : '';

  return state.data.milestones
    .filter((milestone) => isMilestoneInScope(milestone.id, scopedIds))
    .filter(
      (milestone) =>
        state.milestoneDensity === 'all' || keyIds.has(milestone.id) || milestone.id === selectedId,
    )
    .sort((left, right) => dateValue(left.date) - dateValue(right.date));
}

function getScopedMilestoneCount() {
  const scopedIds = getScopedMilestoneIdSet();
  if (!scopedIds) return state.data.milestones.length;
  return state.data.milestones.filter((milestone) => scopedIds.has(milestone.id)).length;
}

function getTimelineMetrics() {
  const minTime = dateValue(state.data.timeline.start);
  const maxTime = dateValue(state.data.timeline.end);
  const total = maxTime - minTime;
  return { minTime, maxTime, total };
}

function getTimelinePosition(date) {
  const { minTime, total } = getTimelineMetrics();
  return ((dateValue(date) - minTime) / total) * 100;
}

function buildStageOverview() {
  const scope = getScope();
  const totalMilestones = state.data.milestones.length;
  const inScopeCount = getScopedMilestoneCount();
  const milestonePill = scope
    ? `${inScopeCount} of ${totalMilestones} milestones in scope`
    : pluralize(totalMilestones, 'milestone');

  overviewContent.innerHTML = `
    ${scope ? buildScopePillHtml(scope) : ''}
    ${renderContextBanner()}
    <div class="stage-strip" aria-label="Schedule overview key">
      <span class="stage-pill stage-pill--primary mono">${escapeHtml(state.data.overview.spanValue)}</span>
      <span class="stage-pill">${escapeHtml(pluralize(state.data.phases.length, 'major phase'))}</span>
      <span class="stage-pill">${escapeHtml(milestonePill)}</span>
    </div>
  `;
}

function buildScheduleAxis() {
  return state.data.years
    .map((year) => {
      const position = getTimelinePosition(year.start);
      return `
        <div class="schedule-axis__year" style="left:${position}%;">
          <span class="schedule-axis__label">${escapeHtml(year.label)}</span>
        </div>
      `;
    })
    .join('');
}

function buildLaneMilestones(phase, visibleMilestones) {
  const selectedMilestone = getSelectedMilestone();

  const keyIds = getKeyMilestoneIdSet();

  return visibleMilestones
    .filter((milestone) => milestone.phaseId === phase.id)
    .map((milestone) => {
      const classes = [
        'lane-milestone',
        `lane-milestone--${milestone.tone || 'brand'}`,
        keyIds.has(milestone.id) ? 'lane-milestone--key' : '',
        selectedMilestone?.id === milestone.id ? 'lane-milestone--active' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `
        <button
          class="${classes}"
          type="button"
          data-select-type="milestone"
          data-select-id="${escapeHtml(milestone.id)}"
          style="left:${getTimelinePosition(milestone.date)}%;"
          aria-label="${escapeHtml(`${milestone.shortName}, ${milestone.dateLabel}`)}"
          title="${escapeHtml(`${milestone.shortName}, ${milestone.dateLabel}`)}"
          aria-pressed="${String(selectedMilestone?.id === milestone.id)}"
        ><span class="lane-milestone__diamond" aria-hidden="true"></span></button>
      `;
    })
    .join('');
}

function buildScheduleLanes() {
  const focusedPhase = getFocusedPhase();
  const visibleMilestones = getTimelineMilestones();

  return state.data.phases
    .map((phase) => {
      const left = getTimelinePosition(phase.start);
      const width = Math.max(getTimelinePosition(phase.end) - left, 7);
      const classes = [
        'schedule-lane',
        `schedule-lane--${phase.tone || 'brand'}`,
        focusedPhase?.id === phase.id ? 'schedule-lane--active' : '',
        focusedPhase && focusedPhase.id !== phase.id ? 'schedule-lane--muted' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const barClasses = [
        'schedule-lane__bar',
        `schedule-lane__bar--${phase.tone || 'brand'}`,
        focusedPhase?.id === phase.id ? 'schedule-lane__bar--active' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `
        <div class="${classes}">
          <button
            class="schedule-lane__select"
            type="button"
            data-select-type="phase"
            data-select-id="${escapeHtml(phase.id)}"
            aria-pressed="${String(focusedPhase?.id === phase.id)}"
            title="${escapeHtml(`${phase.name}: ${phase.rangeLabel}`)}"
          >
            <div class="schedule-lane__label">
              <strong>${escapeHtml(phase.name)}</strong>
              <span class="mono">${escapeHtml(phase.rangeLabel)}</span>
            </div>
          </button>
          <div class="schedule-lane__plot">
            <div class="schedule-lane__baseline"></div>
            <button
              class="${barClasses}"
              type="button"
              data-select-type="phase"
              data-select-id="${escapeHtml(phase.id)}"
              aria-label="${escapeHtml(`${phase.name}: ${phase.rangeLabel}`)}"
              style="left:${left}%; width:${Math.max(width, 8)}%;"
            ></button>
            ${buildLaneMilestones(phase, visibleMilestones)}
          </div>
        </div>
      `;
    })
    .join('');
}

function buildDensityToggle() {
  const options = [
    { id: 'key', label: 'Key' },
    { id: 'all', label: 'All' },
  ];

  return `
    <div class="density-toggle" role="group" aria-label="Milestone density">
      ${options
        .map(
          (option) => `
            <button
              class="density-toggle__button${state.milestoneDensity === option.id ? ' is-active' : ''}"
              type="button"
              data-density="${option.id}"
              aria-pressed="${String(state.milestoneDensity === option.id)}"
            >
              ${escapeHtml(option.label)}
            </button>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderTimeline() {
  const scope = getScope();
  const scopeIsEmpty = scope && !getScopedMilestoneCount();

  timelineChart.innerHTML = `
    <div class="schedule-map">
      <div class="schedule-map__heading">
        <span class="schedule-map__hint">Milestones shown</span>
        ${buildDensityToggle()}
      </div>

      <div class="schedule-axis">
        <div class="schedule-axis__gutter"></div>
        <div class="schedule-axis__plot">${buildScheduleAxis()}</div>
      </div>

      <div class="schedule-lane-stack">
        ${buildScheduleLanes()}
      </div>

      ${scopeIsEmpty ? buildScopeEmptyStateHtml(scope, 'milestones') : ''}
    </div>
  `;
}

function renderMilestoneStrip() {
  const milestone = getSelectedMilestone();

  if (!milestone) {
    milestoneStrip.innerHTML = `
      <p class="milestone-strip__empty">No milestone selected.</p>
    `;
    return;
  }

  const confidenceTone = (milestone.confidenceLabel || 'unknown')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-confidence$/, '');

  milestoneStrip.innerHTML = `
    <span class="milestone-strip__date mono">${escapeHtml(milestone.dateLabel)}</span>
    <strong class="milestone-strip__name">${escapeHtml(milestone.shortName)}</strong>
    <span class="milestone-strip__phase">${escapeHtml(milestone.phaseName)}</span>
    <span class="milestone-slim__pill milestone-slim__pill--${escapeHtml(confidenceTone)}">${escapeHtml(milestone.confidenceLabel)}</span>
  `;
}

function buildPhaseMilestoneRows(phase) {
  const scopedIds = getScopedMilestoneIdSet();
  const keyIds = getKeyMilestoneIdSet();
  const phaseMilestones = (phase.milestones || [])
    .map((item) => state.milestonesById.get(item.id) || item)
    .filter((milestone) => isMilestoneInScope(milestone.id, scopedIds))
    .sort((left, right) => dateValue(left.date) - dateValue(right.date));

  if (!phaseMilestones.length) {
    const scope = getScope();
    if (scope) return buildScopeEmptyStateHtml(scope, 'milestones in this phase');
    return buildEmptyState('No milestones', 'No milestones are recorded for this phase in the current dataset.');
  }

  return `
    <div class="milestone-choice-grid">
      ${phaseMilestones
        .map(
          (item) => `
            <button
              class="linked-moment${state.selection?.id === item.id ? ' linked-moment--active' : ''}"
              type="button"
              data-select-type="milestone"
              data-select-id="${escapeHtml(item.id)}"
              aria-pressed="${String(state.selection?.id === item.id)}"
            >
              <span class="linked-moment__date mono">${escapeHtml(item.dateLabel)}${keyIds.has(item.id) ? ' <span class="key-badge">Key</span>' : ''}</span>
              <strong>${escapeHtml(item.shortName)}</strong>
            </button>
          `,
        )
        .join('')}
    </div>
  `;
}

function buildPhaseDetail(phase) {
  const scopedIds = getScopedMilestoneIdSet();
  const totalCount = (phase.milestones || []).length;
  const inScopeCount = scopedIds
    ? (phase.milestones || []).filter((item) => scopedIds.has(item.id)).length
    : totalCount;
  const keyIds = getKeyMilestoneIdSet();
  const keyCount = (phase.milestones || []).filter((item) => keyIds.has(item.id)).length;
  const countCopy = scopedIds
    ? `${inScopeCount} of ${totalCount} milestones in scope, ${keyCount} key`
    : `${pluralize(totalCount, 'milestone')}, ${keyCount} key`;

  detailHeading.textContent = phase.name;
  detailSubtitle.textContent = `${phase.rangeLabel} · ${countCopy}`;

  return `
    <div class="focus-layout focus-layout--phase">
      <section class="focus-card focus-card--primary">
        <div class="focus-header">
          <h3>${escapeHtml(phase.name)}</h3>
          <div class="focus-meta">
            <span class="mono">${escapeHtml(phase.rangeLabel)}</span>
            <span>${escapeHtml(countCopy)}</span>
          </div>
        </div>

        <p class="focus-summary">${escapeHtml(firstSentence(phase.whyItMatters || phase.summary))}</p>

        ${renderContextActions()}
      </section>

      <section class="focus-card focus-card--secondary">
        <div class="focus-header">
          <h3>Milestones in ${escapeHtml(phase.name)}</h3>
        </div>
        ${buildPhaseMilestoneRows(phase)}
      </section>
    </div>
  `;
}

function buildMilestoneSupport(milestone) {
  const phase = state.phasesById.get(milestone.phaseId);
  const driver = getMilestoneDrivers(milestone)[0] || getPhaseDrivers(milestone.phaseId)[0] || null;

  // Plain-language explanation with fallback to whyItMatters
  const explanation = milestone.plainLanguage || milestone.whyItMatters;
  const hasPlainLanguage = Boolean(milestone.plainLanguage);

  // Build inline evidence strings (not ID dumps)
  const taskStory = milestone.task
    ? `Anchored to task <strong>${escapeHtml(milestone.task.name)}</strong> (${escapeHtml(milestone.task.windowLabel)}, WBS ${escapeHtml(milestone.task.wbsId)}).`
    : '';

  const riskStory = milestone.linkedRisks.length
    ? `<strong>${escapeHtml(milestone.linkedRisks.length)} risk${milestone.linkedRisks.length === 1 ? '' : 's'}</strong> tied to this date: ${milestone.linkedRisks.slice(0, 3).map(r => escapeHtml(r.title)).join('; ')}${milestone.linkedRisks.length > 3 ? '; …' : ''}.`
    : '';

  const docStory = milestone.linkedDocuments.length
    ? `Backed by <strong>${escapeHtml(milestone.linkedDocuments.length)} document${milestone.linkedDocuments.length === 1 ? '' : 's'}</strong>: ${milestone.linkedDocuments.slice(0, 3).map(d => escapeHtml(d.name)).join('; ')}${milestone.linkedDocuments.length > 3 ? '; …' : ''}.`
    : '';

  const sourceStory = milestone.linkedSources.length
    ? `Public source${milestone.linkedSources.length === 1 ? '' : 's'}: ${milestone.linkedSources.slice(0, 2).map(s => s.href ? `<a class="evidence-inline-link" href="${escapeHtml(s.href)}" target="_blank" rel="noreferrer">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)).join('; ')}.`
    : '';

  const driverStory = driver
    ? `Pacing driver: <strong>${escapeHtml(driver.name)}</strong> (${escapeHtml(driver.windowLabel)}).`
    : '';

  const evidenceParts = [taskStory, driverStory, riskStory, docStory, sourceStory].filter(Boolean);

  return `
    <div class="milestone-slim">
      <header class="milestone-slim__header">
        <div>
          <p class="milestone-slim__eyebrow">${escapeHtml(phase?.name || milestone.phaseName)} · ${escapeHtml(milestone.dateLabel)}</p>
          <h3 class="milestone-slim__title">${escapeHtml(milestone.shortName)}</h3>
          <p class="milestone-slim__fullname">${escapeHtml(milestone.name)}</p>
        </div>
        <span class="milestone-slim__pill milestone-slim__pill--${escapeHtml((milestone.confidenceLabel || 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/-confidence$/, ''))}">${escapeHtml(milestone.confidenceLabel)}</span>
      </header>

      <p class="milestone-slim__why"><strong>What this is:</strong> ${escapeHtml(explanation)}</p>

      ${evidenceParts.length ? `
        <div class="milestone-slim__evidence-inline">
          <p class="milestone-slim__evidence-label">Evidence behind this date</p>
          <ul class="evidence-inline-list">
            ${evidenceParts.map(part => `<li>${part}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${hasPlainLanguage ? `
        <details class="milestone-slim__technical">
          <summary><span>Technical framing</span><span class="milestone-slim__chevron" aria-hidden="true">▾</span></summary>
          <p>${escapeHtml(milestone.whyItMatters)}</p>
        </details>
      ` : ''}

      ${renderContextActions()}
    </div>
  `;
}

// One detail panel below the timeline: a phase selection shows the phase's
// full milestone list; a milestone selection shows the evidence content.
function renderDetail() {
  const milestone = getSelectedMilestone();
  const phase = getFocusedPhase();

  if (milestone) {
    detailPanel.hidden = false;
    detailHeading.textContent = milestone.shortName;
    detailSubtitle.textContent = `${milestone.dateLabel} · ${milestone.phaseName}`;
    detailContent.innerHTML = buildMilestoneSupport(milestone);
    return;
  }

  if (phase) {
    detailPanel.hidden = false;
    detailContent.innerHTML = buildPhaseDetail(phase);
    return;
  }

  detailPanel.hidden = true;
  detailContent.innerHTML = '';
}

function renderApp() {
  appTitle.textContent = state.data.appTitle;
  appSubtitle.textContent = 'Visual schedule map of Gateway across major phases and milestone dates.';
  generatedAt.textContent = `Updated ${dateTimeFormatter.format(new Date(state.data.generatedAt))}`;

  const totalMilestones = state.data.milestones.length;
  const inScopeCount = getScopedMilestoneCount();
  stageFrame.textContent = `${state.data.overview.spanLabel}. ${pluralize(state.data.phases.length, 'phase')}. ${
    getScope() ? `${inScopeCount} of ${totalMilestones} milestones in scope.` : `${pluralize(totalMilestones, 'milestone')}.`
  }`;

  buildSignalPills();
  buildStageOverview();
  renderTimeline();
  renderMilestoneStrip();
  renderDetail();
  syncUrlState();
  syncSuiteNavigation();
}

function clearScope() {
  if (!state.sharedContext?.wbs) return;
  delete state.sharedContext.wbs;
  renderApp();
}

function setScope(wbsId) {
  if (!wbsId) return;
  state.sharedContext.wbs = wbsId;
  renderApp();
}

function handleAction(target) {
  const action = target.dataset.action;
  if (!action) return;

  if (action === 'clear-scope') {
    clearScope();
    return;
  }

  if (action === 'scope-view-parent') {
    setScope(target.dataset.parentId);
    return;
  }

  if (action === 'clear-focus') {
    state.selection = null;
    syncActiveDriver(null);
    renderApp();
    return;
  }

  if (action === 'reset-view') {
    state.sharedContext = {};
    state.selection = getDefaultSelection();
    syncActiveDriver(state.selection);
    renderApp();
  }
}

function handleSelection(target) {
  const type = target.dataset.selectType;
  const id = target.dataset.selectId;
  if (!type || !id) return;

  setSelection({ type, id });
}

function handleDensity(target) {
  const density = target.dataset.density;
  if (!density || density === state.milestoneDensity) return;
  state.milestoneDensity = density === 'all' ? 'all' : 'key';
  renderApp();
}

async function loadData() {
  const [response, crosswalk] = await Promise.all([
    fetch(DATA_URL),
    loadSuiteCrosswalk(CROSSWALK_URL),
  ]);
  if (!response.ok) {
    throw new Error(`Unable to load schedule data (${response.status})`);
  }

  const data = await response.json();
  state.data = data;
  state.crosswalk = crosswalk;
  state.sharedContext = readSharedContext();
  buildMaps(data);
  state.activeDriverId = data.defaultDriverId;
  state.selection = resolveInitialSelection();
  syncActiveDriver(state.selection);

  renderApp();
}

function renderError(error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  overviewContent.innerHTML = `
    <section class="loading-state">
      <h3>Unable to load the Schedule Explorer</h3>
      <p>${escapeHtml(message)}</p>
    </section>
  `;
  timelineChart.innerHTML = '';
  milestoneStrip.innerHTML = '';
  detailPanel.hidden = true;
  generatedAt.textContent = 'Schedule data unavailable';
}

document.body.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (actionTarget) {
    handleAction(actionTarget);
    return;
  }

  const densityTarget = event.target.closest('[data-density]');
  if (densityTarget) {
    handleDensity(densityTarget);
    return;
  }

  const selectionTarget = event.target.closest('[data-select-type]');
  if (selectionTarget) {
    handleSelection(selectionTarget);
  }
});

document.body.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const selectionTarget = event.target.closest('[data-select-type]');
  if (!selectionTarget) return;
  event.preventDefault();
  handleSelection(selectionTarget);
});

loadData().catch(renderError);
