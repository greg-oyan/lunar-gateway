import {
  applySuiteNav,
  buildSuiteHref,
  getSharedContextEntries,
  hasSharedContext,
  loadSuiteCrosswalk,
  mergeQueryState,
  readSharedContext,
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
const focusLayer = document.getElementById('focusLayer');
const focusHeading = document.getElementById('focusHeading');
const focusSubtitle = document.getElementById('focusSubtitle');
const focusContent = document.getElementById('focusContent');
const supportLayer = document.getElementById('supportLayer');
const supportHeading = document.getElementById('supportHeading');
const supportSubtitle = document.getElementById('supportSubtitle');
const supportTabs = document.getElementById('supportTabs');
const supportContent = document.getElementById('supportContent');

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
  support: {
    open: false,
  },
  reveal: {
    phaseMilestones: false,
    artifacts: false,
    sources: false,
  },
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

function compactText(value, wordLimit = 18) {
  const words = cleanText(value).split(' ').filter(Boolean);
  if (words.length <= wordLimit) return words.join(' ');
  return `${words.slice(0, wordLimit).join(' ')}...`;
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

function buildScheduleNavContext() {
  const context = getSelectedContext();
  return {
    from: 'schedule',
    wbs: context.wbsId,
    module: context.moduleKey,
    milestone: context.milestone?.id || '',
    phase: context.phase?.id || '',
    risk: context.riskId,
    doc: context.docId,
  };
}

function syncSuiteNavigation() {
  applySuiteNav(buildScheduleNavContext(), { currentRoute: 'schedule' });
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
        wbs: context.wbsId,
        milestone: context.milestone?.id || '',
      })}
      ${buildSuiteAction('cost', 'Open in Cost', {
        from: 'schedule',
        wbs: context.wbsId,
        milestone: context.milestone?.id || '',
        view: 'module',
      })}
      ${buildSuiteAction('risk', 'Open in Risk', {
        from: 'schedule',
        wbs: context.wbsId,
        milestone: context.milestone?.id || '',
        risk: context.riskId,
      })}
      ${buildSuiteAction('documents', 'Open in Documents', {
        from: 'schedule',
        wbs: context.wbsId,
        milestone: context.milestone?.id || '',
        doc: context.docId,
      })}
    </div>
  `;
}

function scrollToId(id) {
  const element = document.getElementById(id);
  if (!element) return;
  window.requestAnimationFrame(() => {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
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

function setSelection(selection, options = {}) {
  state.selection = selection;
  state.reveal.phaseMilestones = false;
  state.reveal.artifacts = false;
  state.reveal.sources = false;

  if (!selection || selection.type === 'phase') {
    state.support.open = false;
  } else if (selection.type === 'milestone') {
    state.support.open = true;
  }

  syncActiveDriver(selection);
  renderApp();

  if (selection?.type === 'milestone' && state.support.open) {
    scrollToId('supportLayer');
    return;
  }

  scrollToId('focusLayer');
}

function buildSignalPills() {
  storySignals.innerHTML = '';
}

function getAnchorMilestones() {
  const preferredIds = ['M-001', 'M-009', 'M-017', 'M-024', 'M-030', 'M-037'];
  return preferredIds.map((id) => state.milestonesById.get(id)).filter(Boolean);
}

function getTimelineMilestones() {
  return getAnchorMilestones().sort((left, right) => dateValue(left.date) - dateValue(right.date));
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
  overviewContent.innerHTML = `
    ${renderContextBanner()}
    <div class="stage-strip" aria-label="Schedule overview key">
      <span class="stage-pill stage-pill--primary mono">${escapeHtml(state.data.overview.spanValue)}</span>
      <span class="stage-pill">${escapeHtml(pluralize(state.data.phases.length, 'major phase'))}</span>
      <span class="stage-pill">${escapeHtml(pluralize(getAnchorMilestones().length, 'key milestone date', 'key milestone dates'))}</span>
      <span class="stage-pill stage-pill--ghost">Click a band or marker to focus</span>
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

function buildScheduleLanes() {
  const focusedPhase = getFocusedPhase();

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
        <button
          class="${classes}"
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
          <div class="schedule-lane__plot">
            <div class="schedule-lane__baseline"></div>
            <div class="${barClasses}" style="left:${left}%; width:${Math.max(width, 8)}%;"></div>
          </div>
        </button>
      `;
    })
    .join('');
}

function buildScheduleMarkers() {
  const selectedMilestone = getSelectedMilestone();
  const focusedPhase = getFocusedPhase();
  const milestones = getTimelineMilestones();

  return milestones
    .map((milestone, index) => {
      const align = index === 0 ? 'start' : index === milestones.length - 1 ? 'end' : 'center';
      const level = index % 2 === 0 ? 'upper' : 'lower';
      const classes = [
        'schedule-marker',
        `schedule-marker--${milestone.tone || 'brand'}`,
        `schedule-marker--${level}`,
        `schedule-marker--${align}`,
        selectedMilestone?.id === milestone.id ? 'schedule-marker--active' : '',
        focusedPhase && milestone.phaseId !== focusedPhase.id ? 'schedule-marker--muted' : '',
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
          aria-label="${escapeHtml(`${milestone.shortName} on ${milestone.dateLabel}`)}"
          title="${escapeHtml(`${milestone.shortName} - ${milestone.dateLabel}`)}"
          aria-pressed="${String(selectedMilestone?.id === milestone.id)}"
        >
          <span class="schedule-marker__stem"></span>
          <span class="schedule-marker__dot"></span>
          <span class="schedule-marker__card">
            <span class="schedule-marker__date mono">${escapeHtml(milestone.dateLabel)}</span>
            <strong>${escapeHtml(milestone.shortName)}</strong>
            <span class="schedule-marker__phase">${escapeHtml(milestone.phaseName)}</span>
          </span>
        </button>
      `;
    })
    .join('');
}

function buildScheduleVisualHint() {
  const milestone = getSelectedMilestone();
  const phase = getFocusedPhase();
  if (milestone) return `${milestone.shortName} is highlighted. Layer 2 now explains this date before the evidence layer opens.`;
  if (phase) return `${phase.name} is highlighted. Layer 2 now shows the key milestones inside this phase.`;
  return 'The big-picture schedule comes first. Click a phase band, then choose a key date to go deeper.';
}

function renderTimeline() {
  timelineChart.innerHTML = `
    <div class="schedule-map">
      <div class="schedule-map__heading">
        <p class="schedule-map__hint">${escapeHtml(buildScheduleVisualHint())}</p>
      </div>

      <div class="schedule-axis">
        <div class="schedule-axis__gutter"></div>
        <div class="schedule-axis__plot">${buildScheduleAxis()}</div>
      </div>

      <div class="schedule-lane-stack">
        ${buildScheduleLanes()}
      </div>

      <div class="schedule-milestones">
      <div class="schedule-milestones__label">
        <span class="section-kicker">Key milestone dates</span>
          <strong>Click a marker to open the selected milestone view.</strong>
      </div>
        <div class="schedule-milestones__plot">
          <div class="schedule-milestones__spine"></div>
          ${buildScheduleMarkers()}
        </div>
      </div>
    </div>
  `;
}

function buildLinkedMomentButtons(items) {
  if (!items.length) {
    return buildEmptyState('No additional linked moments', 'This selected item is already one of the key schedule anchors.');
  }

  return `
    <div class="milestone-choice-grid">
      ${items
        .map(
          (item) => `
            <button
              class="linked-moment${state.selection?.id === item.id ? ' linked-moment--active' : ''}"
              type="button"
              data-select-type="milestone"
              data-select-id="${escapeHtml(item.id)}"
              aria-pressed="${String(state.selection?.id === item.id)}"
            >
              <span class="linked-moment__date mono">${escapeHtml(item.dateLabel)}</span>
              <strong>${escapeHtml(item.shortName)}</strong>
              <span class="linked-moment__summary">${escapeHtml(compactText(item.whyItMatters, 14))}</span>
            </button>
          `,
        )
        .join('')}
    </div>
  `;
}

function buildFocusPhaseView(phase) {
  const selectedMilestone = getSelectedMilestone();
  const focusMilestones = phase.keyMilestoneIds.map((id) => state.milestonesById.get(id)).filter(Boolean);
  const relatedRisks = uniqueById(focusMilestones.flatMap((item) => item.linkedRisks));
  const relatedDocuments = uniqueById(focusMilestones.flatMap((item) => item.linkedDocuments));

  focusHeading.textContent = 'Selected phase';
  focusSubtitle.textContent =
    'Choose one key milestone in this phase to open the evidence behind that date.';

  return `
    <div class="focus-layout focus-layout--phase">
      <section class="focus-card focus-card--primary">
        <div class="focus-header">
          <p class="section-kicker">Selected phase</p>
          <h3>${escapeHtml(phase.name)}</h3>
          <div class="focus-meta">
            <span class="mono">${escapeHtml(phase.rangeLabel)}</span>
            <span>${escapeHtml(pluralize(focusMilestones.length, 'anchor milestone'))}</span>
          </div>
        </div>

        <p class="focus-summary">${escapeHtml(firstSentence(phase.whyItMatters || phase.summary))}</p>

        <div class="phase-summary-strip" aria-label="Selected phase summary">
          <div class="phase-summary-stat">
            <span class="phase-summary-stat__label">Date span</span>
            <strong class="phase-summary-stat__value mono">${escapeHtml(phase.rangeLabel)}</strong>
          </div>
          <div class="phase-summary-stat">
            <span class="phase-summary-stat__label">Key milestones</span>
            <strong class="phase-summary-stat__value">${escapeHtml(String(focusMilestones.length))}</strong>
          </div>
          <div class="phase-summary-stat">
            <span class="phase-summary-stat__label">Linked tasks</span>
            <strong class="phase-summary-stat__value">${escapeHtml(String(phase.representativeTasks.length))}</strong>
          </div>
          <div class="phase-summary-stat">
            <span class="phase-summary-stat__label">Risks / docs</span>
            <strong class="phase-summary-stat__value">${escapeHtml(`${relatedRisks.length} / ${relatedDocuments.length}`)}</strong>
          </div>
        </div>
        ${renderContextActions()}
      </section>

      <section class="focus-card focus-card--secondary">
        <div class="focus-header">
          <p class="section-kicker">Key milestones in this phase</p>
          <h3>Choose one date to inspect</h3>
          <p class="focus-summary">Each card below opens the evidence behind that milestone.</p>
        </div>

        ${buildLinkedMomentButtons(focusMilestones)}

        ${
          selectedMilestone && selectedMilestone.phaseId === phase.id
            ? `
              <div class="focus-note" aria-live="polite">
                <span class="focus-note__label">Selected milestone</span>
                <strong>${escapeHtml(selectedMilestone.shortName)}</strong>
                <p>${escapeHtml(`Evidence for ${selectedMilestone.dateLabel} is open below.`)}</p>
              </div>
            `
            : ''
        }
      </section>
    </div>
  `;
}

function renderFocus() {
  const phase = getFocusedPhase();

  if (!phase) {
    focusHeading.textContent = 'Selected phase';
    focusSubtitle.textContent = 'Choose one key milestone in this phase to open the evidence behind that date.';
    focusLayer.hidden = true;
    return;
  }

  focusLayer.hidden = false;
  focusContent.innerHTML = buildFocusPhaseView(phase);
}

function buildSupportList(items, builder) {
  if (!items.length) return buildEmptyState('Nothing linked here yet', 'No stronger direct source is attached to this group in the current dataset.');

  return `
    <div class="support-list">
      ${items.map(builder).join('')}
    </div>
  `;
}

function buildMilestoneSupport(milestone) {
  const phase = state.phasesById.get(milestone.phaseId);
  const driver = getMilestoneDrivers(milestone)[0] || getPhaseDrivers(milestone.phaseId)[0] || null;
  const methodology = state.data.methodology;
  const traceability = state.data.traceability;
  const artifacts = state.reveal.artifacts ? traceability.artifacts : traceability.artifacts.slice(0, 3);
  const sources = state.reveal.sources ? traceability.sources : traceability.sources.slice(0, 4);

  return `
    <div class="support-shell">
      <section class="support-card support-card--hero">
        <div class="support-card__header">
          <p class="support-card__eyebrow">Selected milestone</p>
          <h3>${escapeHtml(milestone.shortName)}</h3>
          <div class="focus-meta">
            <span class="mono">${escapeHtml(milestone.dateLabel)}</span>
            <span>${escapeHtml(phase?.name || milestone.phaseName)}</span>
          </div>
          <p class="support-card__summary">${escapeHtml(firstSentence(milestone.whyItMatters))}</p>
        </div>

        <div class="phase-summary-strip phase-summary-strip--compact" aria-label="Selected milestone summary">
          <div class="phase-summary-stat">
            <span class="phase-summary-stat__label">Date</span>
            <strong class="phase-summary-stat__value mono">${escapeHtml(milestone.dateLabel)}</strong>
          </div>
          <div class="phase-summary-stat">
            <span class="phase-summary-stat__label">Type</span>
            <strong class="phase-summary-stat__value">${escapeHtml(milestone.typeLabel)}</strong>
          </div>
          <div class="phase-summary-stat">
            <span class="phase-summary-stat__label">Source basis</span>
            <strong class="phase-summary-stat__value">${escapeHtml(milestone.directnessLabel)}</strong>
          </div>
          <div class="phase-summary-stat">
            <span class="phase-summary-stat__label">Confidence</span>
            <strong class="phase-summary-stat__value">${escapeHtml(milestone.confidenceLabel)}</strong>
          </div>
        </div>
        ${renderContextActions()}
      </section>

      <div class="support-grid support-grid--primary">
        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Task behind this milestone</p>
            <h3>${escapeHtml(milestone.task ? milestone.task.name : 'No direct task linked')}</h3>
            <p class="support-card__summary">This is the clearest task-level schedule evidence connected to the selected date.</p>
          </div>
          ${
            milestone.task
              ? `
                <div class="support-list">
                  <div class="support-item">
                    <span class="item-meta mono">${escapeHtml(milestone.task.id)} - ${escapeHtml(milestone.task.windowLabel)}</span>
                    <strong>${escapeHtml(milestone.task.name)}</strong>
                    <p class="support-item__copy">${escapeHtml(`WBS ${milestone.task.wbsId}`)}</p>
                  </div>
                </div>
              `
              : buildEmptyState('No direct task record', 'The current source set does not tie this milestone to one specific task line.')
          }
        </section>

        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Risks tied to this milestone</p>
            <h3>${escapeHtml(pluralize(milestone.linkedRisks.length, 'risk'))}</h3>
            <p class="support-card__summary">These are the clearest schedule-pressure items connected to the selected date.</p>
          </div>
          ${buildSupportList(
            milestone.linkedRisks,
            (risk) => `
              <div class="support-item">
                <span class="item-meta">${escapeHtml(`${risk.id} - ${risk.status}`)}</span>
                <strong>${escapeHtml(risk.title)}</strong>
                <p class="support-item__copy">${escapeHtml(`Risk score ${risk.score}`)}</p>
                <div class="card-actions">
                  <a class="artifact-card__link" href="${escapeHtml(buildSuiteHref('risk', { from: 'schedule', milestone: milestone.id, wbs: milestone.task?.wbsId || '', risk: risk.id }))}">
                    Open in Risk
                  </a>
                </div>
              </div>
            `,
          )}
        </section>

        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Supporting documents</p>
            <h3>${escapeHtml(pluralize(milestone.linkedDocuments.length, 'document'))}</h3>
            <p class="support-card__summary">These documents explain or reinforce why this date exists in the schedule story.</p>
          </div>
          ${buildSupportList(
            milestone.linkedDocuments,
            (document) => `
              <div class="support-item">
                <span class="item-meta">${escapeHtml(`${document.id} - ${document.type}`)}</span>
                <strong>${escapeHtml(document.name)}</strong>
                <p class="support-item__copy">${escapeHtml(`${document.status} - ${document.evidenceRole}`)}</p>
                <div class="card-actions">
                  <a class="artifact-card__link" href="${escapeHtml(buildSuiteHref('documents', { from: 'schedule', milestone: milestone.id, wbs: milestone.task?.wbsId || '', doc: getSelectedContext().docId }))}">
                    Open in Documents
                  </a>
                </div>
              </div>
            `,
          )}
        </section>

        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Source references</p>
            <h3>${escapeHtml(pluralize(milestone.linkedSources.length, 'source'))}</h3>
            <p class="support-card__summary">These are the named sources most directly linked to this date. Additional supporting files appear below.</p>
          </div>
          ${buildSupportList(
            milestone.linkedSources,
            (source) => `
              <div class="support-item">
                <span class="item-meta">${escapeHtml(`${source.id} - ${source.publisher}`)}</span>
                <strong>${escapeHtml(source.title)}</strong>
                <p class="support-item__copy">${escapeHtml(source.href ? 'External or linked source.' : 'Local source file in the schedule dataset.')}</p>
                <div class="card-actions">
                  <a class="artifact-card__link" href="${escapeHtml(buildSuiteHref('documents', { from: 'schedule', milestone: milestone.id, wbs: milestone.task?.wbsId || '', doc: getSelectedContext().docId }))}">
                    Open in Documents
                  </a>
                  ${source.href ? `<a class="source-card__link" href="${escapeHtml(source.href)}" target="_blank" rel="noreferrer">Open raw source</a>` : ''}
                </div>
              </div>
            `,
          )}
        </section>
      </div>

      <div class="support-grid support-grid--secondary">
        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">What drives this date</p>
            <h3>${escapeHtml(driver ? driver.name : 'No driver group linked')}</h3>
            <p class="support-card__summary">This is the clearest timing-pressure branch connected to the selected milestone.</p>
          </div>
          ${
            driver
              ? `
                <div class="support-list">
                  <div class="support-item">
                    <span class="item-meta">${escapeHtml(driver.windowLabel)}</span>
                    <strong>${escapeHtml(driver.name)}</strong>
                    <p class="support-item__copy">${escapeHtml(compactText(driver.summary, 20))}</p>
                  </div>
                </div>
                <div class="phase-summary-strip phase-summary-strip--compact" aria-label="Timing pressure summary">
                  <div class="phase-summary-stat">
                    <span class="phase-summary-stat__label">Tasks</span>
                    <strong class="phase-summary-stat__value">${escapeHtml(String(driver.representativeTasks.length))}</strong>
                  </div>
                  <div class="phase-summary-stat">
                    <span class="phase-summary-stat__label">Milestones</span>
                    <strong class="phase-summary-stat__value">${escapeHtml(String(driver.linkedMilestones.length))}</strong>
                  </div>
                  <div class="phase-summary-stat">
                    <span class="phase-summary-stat__label">Risks</span>
                    <strong class="phase-summary-stat__value">${escapeHtml(String(driver.linkedRisks.length))}</strong>
                  </div>
                </div>
              `
              : buildEmptyState('No linked timing driver', 'The current evidence model does not expose a stronger timing-pressure branch for this date.')
          }
        </section>

        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">How this schedule was derived</p>
            <h3>${escapeHtml(methodology.title)}</h3>
            <p class="support-card__summary">${escapeHtml(compactText(methodology.summary, 24))}</p>
          </div>
          <div class="support-list">
            ${methodology.cards
              .slice(0, 3)
              .map(
                (card) => `
                  <div class="support-item">
                    <span class="item-meta">${escapeHtml(card.eyebrow)}</span>
                    <strong>${escapeHtml(card.title)}</strong>
                    <p class="support-item__copy">${escapeHtml(compactText(card.body, 18))}</p>
                  </div>
                `,
              )
              .join('')}
          </div>
        </section>
      </div>

      <section class="support-card support-card--span">
        <div class="support-card__header">
          <p class="support-card__eyebrow">Files behind this schedule view</p>
          <h3>Files and sources supporting the schedule</h3>
          <p class="support-card__summary">${escapeHtml(compactText(traceability.summary, 24))}</p>
        </div>

        <div class="artifact-list">
          ${artifacts
            .map(
              (artifact) => `
                <section class="artifact-card">
                  <div class="artifact-card__row">
                    <span class="item-meta">${escapeHtml(artifact.meta)}</span>
                    <span class="${tagClass(artifact.tone)}">${escapeHtml(artifact.fileType)}</span>
                  </div>
                  <h3>${escapeHtml(artifact.title)}</h3>
                  <p>${escapeHtml(compactText(artifact.description, 14))}</p>
                  <div class="card-actions">
                    <a class="artifact-card__link" href="${escapeHtml(artifact.href)}" target="_blank" rel="noreferrer">
                      ${escapeHtml(artifact.linkLabel)}
                    </a>
                  </div>
                </section>
              `,
            )
            .join('')}
        </div>

        ${
          traceability.artifacts.length > 3
            ? `
              <div class="card-actions">
                <button class="trace-button" type="button" data-action="toggle-reveal" data-reveal="artifacts">
                  ${state.reveal.artifacts ? 'Show fewer files' : `Show all ${traceability.artifacts.length} files`}
                </button>
              </div>
            `
            : ''
        }

        <div class="source-list">
          ${sources
            .map(
              (source) => `
                <section class="source-card">
                  <div class="source-card__row">
                    <span class="item-meta">${escapeHtml(`${source.id} - ${source.publisher}`)}</span>
                    <span class="${tagClass(source.tone)}">${escapeHtml(source.sourceTypeLabel)}</span>
                  </div>
                  <h3>${escapeHtml(source.title)}</h3>
                  <p>${escapeHtml(compactText(source.relevance, 14))}</p>
                  <p>${escapeHtml(source.usageLabel)}</p>
                  ${
                    source.href
                      ? `
                        <div class="card-actions">
                          <a class="source-card__link" href="${escapeHtml(source.href)}" target="_blank" rel="noreferrer">
                            ${escapeHtml(source.linkLabel)}
                          </a>
                        </div>
                      `
                      : ''
                  }
                </section>
              `,
            )
            .join('')}
        </div>

        ${
          traceability.sources.length > 4
            ? `
              <div class="card-actions">
                <button class="trace-button" type="button" data-action="toggle-reveal" data-reveal="sources">
                  ${state.reveal.sources ? 'Show fewer sources' : `Show all ${traceability.sources.length} sources`}
                </button>
              </div>
            `
            : ''
        }
      </section>
    </div>
  `;
}

function buildSupportTabContent() {
  const milestone = getSelectedMilestone();

  supportHeading.textContent = 'Evidence behind the selected milestone';

  if (milestone) {
    supportSubtitle.textContent =
      `${milestone.shortName} is selected. This view explains why the date matters and what evidence supports it.`;
    return buildMilestoneSupport(milestone);
  }

  supportSubtitle.textContent =
    'Choose a milestone first so the evidence view can stay specific and easy to follow.';

  return buildEmptyState('Choose a milestone first', 'Select one milestone in Layer 2 to open the evidence behind that date.');
}

function renderSupport() {
  const milestone = getSelectedMilestone();

  if (!state.support.open || !milestone) {
    supportLayer.hidden = true;
    supportTabs.hidden = true;
    supportTabs.innerHTML = '';
    return;
  }

  supportLayer.hidden = false;
  supportTabs.hidden = true;
  supportTabs.innerHTML = '';
  supportContent.innerHTML = buildSupportTabContent();
}

function renderApp() {
  appTitle.textContent = state.data.appTitle;
  appSubtitle.textContent = 'Visual schedule map of Gateway across major phases and milestone dates.';
  generatedAt.textContent = `Updated ${dateTimeFormatter.format(new Date(state.data.generatedAt))}`;
  stageFrame.textContent = '2017 to 2031. Major phases. Key milestone dates.';

  buildSignalPills();
  buildStageOverview();
  renderTimeline();
  renderFocus();
  renderSupport();
  syncUrlState();
  syncSuiteNavigation();
}

function handleAction(target) {
  const action = target.dataset.action;
  if (!action) return;

  if (action === 'clear-focus') {
    state.selection = null;
    state.support.open = false;
    syncActiveDriver(null);
    renderApp();
    scrollToId('stageHeading');
    return;
  }

  if (action === 'home') {
    state.sharedContext = {};
    state.selection = getDefaultSelection();
    state.support.open = state.selection?.type === 'milestone';
    state.reveal.phaseMilestones = false;
    state.reveal.artifacts = false;
    state.reveal.sources = false;
    syncActiveDriver(state.selection);
    renderApp();
    scrollToId('stageHeading');
    return;
  }

  if (action === 'reset-view') {
    state.sharedContext = {};
    state.selection = getDefaultSelection();
    state.support.open = state.selection?.type === 'milestone';
    state.reveal.phaseMilestones = false;
    state.reveal.artifacts = false;
    state.reveal.sources = false;
    syncActiveDriver(state.selection);
    renderApp();
    scrollToId('stageHeading');
    return;
  }

  if (action === 'close-support') {
    state.support.open = false;
    renderApp();
    scrollToId('focusLayer');
    return;
  }

  if (action === 'toggle-reveal') {
    state.reveal[target.dataset.reveal] = !state.reveal[target.dataset.reveal];
    renderSupport();
  }
}

function handleSelection(target) {
  const type = target.dataset.selectType;
  const id = target.dataset.selectId;
  if (!type || !id) return;

  const context = target.closest('#supportLayer') ? 'support' : target.closest('#focusLayer') ? 'focus' : 'stage';
  setSelection({ type, id }, { context });
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
  state.support.open = state.selection?.type === 'milestone';

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
  focusLayer.hidden = true;
  supportLayer.hidden = true;
  generatedAt.textContent = 'Schedule data unavailable';
}

document.body.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (actionTarget) {
    handleAction(actionTarget);
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
