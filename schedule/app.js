const DATA_URL = './data/gateway-schedule.json';

const appTitle = document.getElementById('appTitle');
const appSubtitle = document.getElementById('appSubtitle');
const generatedAt = document.getElementById('generatedAt');
const storySignals = document.getElementById('storySignals');
const stageFrame = document.getElementById('stageFrame');
const overviewContent = document.getElementById('overviewContent');
const timelineChart = document.getElementById('timelineChart');
const focusLayer = document.getElementById('focusLayer');
const focusSubtitle = document.getElementById('focusSubtitle');
const focusContent = document.getElementById('focusContent');
const supportLayer = document.getElementById('supportLayer');
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
    tab: 'support',
  },
  reveal: {
    phaseMilestones: false,
    artifacts: false,
    sources: false,
  },
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

  if (options.context === 'stage') {
    state.support.open = false;
  }

  syncActiveDriver(selection);
  renderApp();

  if (options.context === 'support' && state.support.open) {
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
  if (milestone) return `${milestone.shortName} is highlighted. Layer 2 explains what it is and why it matters.`;
  if (phase) return `${phase.name} is highlighted. Layer 2 explains the phase without opening the full evidence layer.`;
  return 'The visual overview shows the full program arc first. Click a phase or marker to go deeper.';
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
          <strong>Click a marker to open the focused schedule view.</strong>
        </div>
        <div class="schedule-milestones__plot">
          <div class="schedule-milestones__spine"></div>
          ${buildScheduleMarkers()}
        </div>
      </div>
    </div>
  `;
}

function buildRelatedMilestones(milestone) {
  const phase = state.phasesById.get(milestone.phaseId);
  if (!phase) return [];

  const milestones = phase.milestones.map((item) => state.milestonesById.get(item.id)).filter(Boolean);
  const index = milestones.findIndex((item) => item.id === milestone.id);
  return [milestones[index - 1], milestones[index + 1]].filter(Boolean);
}

function buildFocusActions() {
  return `
    <div class="focus-actions">
      <button class="action-pill" type="button" data-action="open-support" data-support-tab="support">
        Open detailed support
      </button>
      <button class="action-pill" type="button" data-action="open-support" data-support-tab="drivers">
        Open schedule drivers
      </button>
      <button class="action-pill" type="button" data-action="open-support" data-support-tab="methodology">
        Open methodology
      </button>
      <button class="action-pill" type="button" data-action="open-support" data-support-tab="traceability">
        Open traceability
      </button>
    </div>
  `;
}

function buildLinkedMomentButtons(items) {
  if (!items.length) {
    return buildEmptyState('No additional linked moments', 'This selected item is already one of the key schedule anchors.');
  }

  return `
    <div class="related-moments">
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
              <span class="linked-moment__date">${escapeHtml(item.phaseName)}</span>
            </button>
          `,
        )
        .join('')}
    </div>
  `;
}

function buildFocusPhaseView(phase) {
  const relatedDrivers = getPhaseDrivers(phase.id);
  const focusMilestones = phase.keyMilestoneIds.map((id) => state.milestonesById.get(id)).filter(Boolean);

  focusSubtitle.textContent =
    'This layer explains one selected phase without opening the full support and evidence structure yet.';

  return `
    <div class="focus-layout">
      <section class="focus-card focus-card--primary">
        <div class="focus-header">
          <p class="section-kicker">Selected phase</p>
          <h3>${escapeHtml(phase.summaryTitle)}</h3>
          <div class="focus-meta">
            <span>${escapeHtml(phase.name)}</span>
            <span class="mono">${escapeHtml(phase.rangeLabel)}</span>
          </div>
        </div>

        <p class="focus-summary">${escapeHtml(firstSentence(phase.summary))}</p>

        <div class="fact-grid">
          <div class="fact-card">
            <span class="fact-card__label">When it happens</span>
            <strong class="fact-card__value">${escapeHtml(phase.rangeLabel)}</strong>
            <p class="fact-card__copy">This is the schedule window where this phase dominates.</p>
          </div>
          <div class="fact-card">
            <span class="fact-card__label">Why it matters</span>
            <strong class="fact-card__value">${escapeHtml(pluralize(phase.milestoneCount, 'milestone'))}</strong>
            <p class="fact-card__copy">${escapeHtml(compactText(phase.whyItMatters, 14))}</p>
          </div>
          <div class="fact-card">
            <span class="fact-card__label">Critical work</span>
            <strong class="fact-card__value">${escapeHtml(String(phase.criticalTaskCount))}</strong>
            <p class="fact-card__copy">Critical tasks are concentrated here more than the overview alone can show.</p>
          </div>
          <div class="fact-card">
            <span class="fact-card__label">Linked drivers</span>
            <strong class="fact-card__value">${escapeHtml(String(relatedDrivers.length))}</strong>
            <p class="fact-card__copy">The deeper driver lens shows how this phase creates timing pressure downstream.</p>
          </div>
        </div>

        <div class="chip-row">
          <span class="${tagClass(phase.tone)}">${escapeHtml(phase.name)}</span>
          ${phase.takeaways.slice(0, 2).map((item) => `<span class="tag tag--brand">${escapeHtml(compactText(item, 7))}</span>`).join('')}
        </div>
      </section>

      <section class="focus-card focus-card--secondary">
        <div class="focus-next">
          <div class="focus-header">
            <p class="section-kicker">What to click next</p>
            <h3>${escapeHtml(firstSentence(phase.whyItMatters))}</h3>
            <p class="focus-summary">Start with one of the milestone anchors in this phase, or open the detailed support layer for tasks, risks, and source boundaries.</p>
          </div>

          <div>
            <p class="section-kicker">Anchor moments in this phase</p>
            ${buildLinkedMomentButtons(focusMilestones)}
          </div>

          ${buildFocusActions()}
        </div>
      </section>
    </div>
  `;
}

function buildFocusMilestoneView(milestone) {
  const phase = state.phasesById.get(milestone.phaseId);
  const relatedMilestones = buildRelatedMilestones(milestone);

  focusSubtitle.textContent =
    'This layer explains one selected milestone, then lets you deliberately open the deeper schedule support behind it.';

  return `
    <div class="focus-layout">
      <section class="focus-card focus-card--primary">
        <div class="focus-header">
          <p class="section-kicker">Selected milestone</p>
          <h3>${escapeHtml(milestone.shortName)}</h3>
          <div class="focus-meta">
            <span class="mono">${escapeHtml(milestone.id)}</span>
            <span>${escapeHtml(milestone.dateLabel)}</span>
            <span>${escapeHtml(milestone.phaseName)}</span>
          </div>
        </div>

        <p class="focus-summary">${escapeHtml(firstSentence(milestone.whyItMatters))}</p>

        <div class="fact-grid">
          <div class="fact-card">
            <span class="fact-card__label">What it is</span>
            <strong class="fact-card__value">${escapeHtml(milestone.typeLabel)}</strong>
            <p class="fact-card__copy">This is the schedule role this milestone plays inside the program arc.</p>
          </div>
          <div class="fact-card">
            <span class="fact-card__label">Source basis</span>
            <strong class="fact-card__value">${escapeHtml(milestone.directnessLabel)}</strong>
            <p class="fact-card__copy">The app keeps direct anchors separate from linked or interpretive schedule meaning.</p>
          </div>
          <div class="fact-card">
            <span class="fact-card__label">Confidence</span>
            <strong class="fact-card__value">${escapeHtml(milestone.confidenceLabel)}</strong>
            <p class="fact-card__copy">Confidence comes from the authority-side milestone record, not from UI inference.</p>
          </div>
          <div class="fact-card">
            <span class="fact-card__label">Linked support</span>
            <strong class="fact-card__value">${escapeHtml(pluralize(milestone.linkedSources.length, 'source'))}</strong>
            <p class="fact-card__copy">${escapeHtml(`${pluralize(milestone.linkedRisks.length, 'risk')} and ${pluralize(milestone.linkedDocuments.length, 'document')} connect to this date.`)}</p>
          </div>
        </div>

        <div class="chip-row">
          <span class="${tagClass(milestone.tone)}">${escapeHtml(milestone.phaseName)}</span>
          <span class="${tagClass(milestone.directnessTone)}">${escapeHtml(milestone.directnessLabel)}</span>
          ${milestone.task ? `<span class="tag tag--forest">${escapeHtml(milestone.task.name)}</span>` : ''}
        </div>
      </section>

      <section class="focus-card focus-card--secondary">
        <div class="focus-next">
          <div class="focus-header">
            <p class="section-kicker">Why it matters</p>
            <h3>${escapeHtml(phase?.summaryTitle || milestone.phaseName)}</h3>
            <p class="focus-summary">${escapeHtml(compactText(milestone.whyItMatters, 18))}</p>
          </div>

          <div>
            <p class="section-kicker">Nearby moments</p>
            ${buildLinkedMomentButtons(relatedMilestones)}
          </div>

          ${buildFocusActions()}
        </div>
      </section>
    </div>
  `;
}

function renderFocus() {
  const milestone = getSelectedMilestone();
  const phase = getSelectedPhase();

  if (!milestone && !phase) {
    focusLayer.hidden = true;
    return;
  }

  focusLayer.hidden = false;
  focusContent.innerHTML = milestone ? buildFocusMilestoneView(milestone) : buildFocusPhaseView(phase);
}

function buildSupportList(items, builder) {
  if (!items.length) return buildEmptyState('Nothing linked here yet', 'The authority layer does not expose a stronger direct link for this group.');

  return `
    <div class="support-list">
      ${items.map(builder).join('')}
    </div>
  `;
}

function buildPhaseSupport(phase) {
  const fullMilestones = phase.milestones.map((item) => state.milestonesById.get(item.id)).filter(Boolean);
  const relatedDrivers = getPhaseDrivers(phase.id);
  const risks = uniqueById(fullMilestones.flatMap((item) => item.linkedRisks));
  const documents = uniqueById(fullMilestones.flatMap((item) => item.linkedDocuments));
  const sources = uniqueById(fullMilestones.flatMap((item) => item.linkedSources));
  const visibleMilestones = state.reveal.phaseMilestones ? fullMilestones : fullMilestones.slice(0, 4);

  return `
    <div class="support-shell">
      <section class="support-card">
        <div class="support-card__header">
          <p class="support-card__eyebrow">Focused support</p>
          <h3>${escapeHtml(phase.summaryTitle)}</h3>
          <p class="support-card__summary">${escapeHtml(compactText(phase.whyItMatters, 18))}</p>
        </div>
      </section>

      <div class="support-grid">
        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Milestones in this phase</p>
            <h3>${escapeHtml(pluralize(phase.milestones.length, 'milestone'))}</h3>
            <p class="support-card__summary">Click one to move from the phase view into a more specific schedule moment.</p>
          </div>
          ${buildSupportList(
            visibleMilestones,
            (milestone) => `
              <button
                class="support-item"
                type="button"
                data-select-type="milestone"
                data-select-id="${escapeHtml(milestone.id)}"
              >
                <span class="item-meta mono">${escapeHtml(milestone.id)} - ${escapeHtml(milestone.dateLabel)}</span>
                <strong>${escapeHtml(milestone.shortName)}</strong>
                <p class="support-item__copy">${escapeHtml(compactText(milestone.whyItMatters, 11))}</p>
              </button>
            `,
          )}
          ${
            phase.milestones.length > 4
              ? `
                <div class="card-actions">
                  <button class="trace-button" type="button" data-action="toggle-reveal" data-reveal="phaseMilestones">
                    ${state.reveal.phaseMilestones ? 'Show fewer milestones' : `Show all ${phase.milestones.length} milestones`}
                  </button>
                </div>
              `
              : ''
          }
        </section>

        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Representative critical work</p>
            <h3>${escapeHtml(pluralize(phase.representativeTasks.length, 'task'))}</h3>
            <p class="support-card__summary">These tasks are the clearest examples of the deeper schedule work inside this phase.</p>
          </div>
          ${buildSupportList(
            phase.representativeTasks,
            (task) => `
              <div class="support-item">
                <span class="item-meta mono">${escapeHtml(task.id)} - ${escapeHtml(task.windowLabel)}</span>
                <strong>${escapeHtml(task.name)}</strong>
                <p class="support-item__copy">${escapeHtml(`WBS ${task.wbsId}`)}</p>
              </div>
            `,
          )}
        </section>

        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Connected schedule drivers</p>
            <h3>${escapeHtml(pluralize(relatedDrivers.length, 'driver group'))}</h3>
            <p class="support-card__summary">These are the timing-pressure branches most associated with this phase.</p>
          </div>
          ${buildSupportList(
            relatedDrivers,
            (driver) => `
              <button
                class="support-item"
                type="button"
                data-action="set-driver"
                data-driver-id="${escapeHtml(driver.id)}"
              >
                <span class="item-meta">${escapeHtml(driver.windowLabel)}</span>
                <strong>${escapeHtml(driver.name)}</strong>
                <p class="support-item__copy">${escapeHtml(compactText(driver.summary, 12))}</p>
              </button>
            `,
          )}
          <div class="card-actions">
            <button class="trace-button" type="button" data-action="open-support" data-support-tab="drivers">
              Open full driver view
            </button>
          </div>
        </section>

        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Linked evidence</p>
            <h3>${escapeHtml(`${pluralize(risks.length, 'risk')}, ${pluralize(documents.length, 'document')}, ${pluralize(sources.length, 'source')}`)}</h3>
            <p class="support-card__summary">The app keeps these deeper support items grouped here instead of pushing them onto the first two layers.</p>
          </div>
          ${buildSupportList(
            [
              risks[0] ? { id: `risk-${risks[0].id}`, meta: risks[0].id, title: risks[0].title, copy: `Score ${risks[0].score}, ${risks[0].status}` } : null,
              documents[0] ? { id: `doc-${documents[0].id}`, meta: documents[0].id, title: documents[0].name, copy: `${documents[0].type}, ${documents[0].status}` } : null,
              sources[0] ? { id: `src-${sources[0].id}`, meta: sources[0].id, title: sources[0].title, copy: sources[0].publisher } : null,
            ].filter(Boolean),
            (item) => `
              <div class="support-item">
                <span class="item-meta">${escapeHtml(item.meta)}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <p class="support-item__copy">${escapeHtml(item.copy)}</p>
              </div>
            `,
          )}
          <div class="card-actions">
            <button class="trace-button" type="button" data-action="open-support" data-support-tab="traceability">
              Open traceability
            </button>
            <button class="trace-button" type="button" data-action="open-support" data-support-tab="methodology">
              Open methodology
            </button>
          </div>
        </section>
      </div>
    </div>
  `;
}

function buildMilestoneSupport(milestone) {
  return `
    <div class="support-shell">
      <section class="support-card">
        <div class="support-card__header">
          <p class="support-card__eyebrow">Focused support</p>
          <h3>${escapeHtml(milestone.shortName)}</h3>
          <p class="support-card__summary">${escapeHtml(compactText(milestone.whyItMatters, 18))}</p>
        </div>
      </section>

      <div class="support-grid">
        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Linked task</p>
            <h3>${escapeHtml(milestone.task ? milestone.task.name : 'No direct task linked')}</h3>
            <p class="support-card__summary">This is the clearest task-level schedule evidence directly connected to the selected milestone.</p>
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
              : buildEmptyState('No direct task record', 'This milestone is still usable, but the current authority layer does not tie it to a single task line.')
          }
        </section>

        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Linked risks</p>
            <h3>${escapeHtml(pluralize(milestone.linkedRisks.length, 'risk'))}</h3>
            <p class="support-card__summary">These are the clearest schedule-pressure items tied to the selected date.</p>
          </div>
          ${buildSupportList(
            milestone.linkedRisks,
            (risk) => `
              <div class="support-item">
                <span class="item-meta">${escapeHtml(`${risk.id} - ${risk.status}`)}</span>
                <strong>${escapeHtml(risk.title)}</strong>
                <p class="support-item__copy">${escapeHtml(`Risk score ${risk.score}`)}</p>
              </div>
            `,
          )}
        </section>

        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Supporting documents</p>
            <h3>${escapeHtml(pluralize(milestone.linkedDocuments.length, 'document'))}</h3>
            <p class="support-card__summary">These artifacts explain or reinforce why this schedule point exists.</p>
          </div>
          ${buildSupportList(
            milestone.linkedDocuments,
            (document) => `
              <div class="support-item">
                <span class="item-meta">${escapeHtml(`${document.id} - ${document.type}`)}</span>
                <strong>${escapeHtml(document.name)}</strong>
                <p class="support-item__copy">${escapeHtml(`${document.status} - ${document.evidenceRole}`)}</p>
              </div>
            `,
          )}
        </section>

        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Source anchors</p>
            <h3>${escapeHtml(pluralize(milestone.linkedSources.length, 'source'))}</h3>
            <p class="support-card__summary">The deeper source layer shows what came from direct authority versus linked schedule interpretation.</p>
          </div>
          ${buildSupportList(
            milestone.linkedSources,
            (source) => `
              <div class="support-item">
                <span class="item-meta">${escapeHtml(`${source.id} - ${source.publisher}`)}</span>
                <strong>${escapeHtml(source.title)}</strong>
                <p class="support-item__copy">${escapeHtml(source.href ? 'Linked source available in traceability.' : 'Local authority source.')}</p>
              </div>
            `,
          )}
          <div class="card-actions">
            <button class="trace-button" type="button" data-action="open-support" data-support-tab="traceability">
              Open traceability
            </button>
          </div>
        </section>
      </div>
    </div>
  `;
}

function buildSupportTabContent() {
  const milestone = getSelectedMilestone();
  const phase = getSelectedPhase();

  supportSubtitle.textContent =
    'The deeper schedule support is grouped into simple blocks so the app can stay credible without becoming a data dump.';

  if (phase) return buildPhaseSupport(phase);
  if (milestone) return buildMilestoneSupport(milestone);

  return buildEmptyState('Choose a phase or milestone first', 'The focused layer needs a selected schedule item before the detailed support view can stay specific.');
}

function buildDriversTabContent() {
  const driver = getActiveDriver();

  supportSubtitle.textContent =
    'This deeper lens isolates the few branches that create the most timing pressure instead of exposing the whole schedule network at once.';

  return `
    <div class="driver-shell">
      <section class="support-card">
        <div class="support-card__header">
          <p class="support-card__eyebrow">Schedule drivers</p>
          <h3>Where timing pressure concentrates</h3>
          <p class="support-card__summary">${escapeHtml(compactText(state.data.driverLensSummary, 22))}</p>
        </div>
      </section>

      <div class="driver-grid">
        ${state.data.drivers
          .map(
            (item) => `
              <button
                class="driver-card${driver?.id === item.id ? ' driver-card--active' : ''}"
                type="button"
                data-action="set-driver"
                data-driver-id="${escapeHtml(item.id)}"
                aria-pressed="${String(driver?.id === item.id)}"
              >
                <p class="driver-card__meta">${escapeHtml(item.name)}</p>
                <strong>${escapeHtml(item.windowLabel)}</strong>
                <p>${escapeHtml(compactText(item.summary, 14))}</p>
              </button>
            `,
          )
          .join('')}
      </div>

      ${
        driver
          ? `
            <section class="driver-detail">
              <div class="driver-detail__header">
                <div>
                  <p class="section-kicker">Selected driver</p>
                  <h3>${escapeHtml(driver.name)}</h3>
                </div>
                <span class="${tagClass(driver.tone)}">${escapeHtml(driver.windowLabel)}</span>
              </div>

              <p>${escapeHtml(firstSentence(driver.summary))}</p>

              <div class="driver-detail__metrics">
                <div class="driver-detail__metric">
                  <span class="fact-card__label">Tasks</span>
                  <strong>${escapeHtml(String(driver.representativeTasks.length))}</strong>
                  <p class="fact-card__copy">Representative critical work in this branch.</p>
                </div>
                <div class="driver-detail__metric">
                  <span class="fact-card__label">Milestones</span>
                  <strong>${escapeHtml(String(driver.linkedMilestones.length))}</strong>
                  <p class="fact-card__copy">Named schedule moments tied to this branch.</p>
                </div>
                <div class="driver-detail__metric">
                  <span class="fact-card__label">Risks</span>
                  <strong>${escapeHtml(String(driver.linkedRisks.length))}</strong>
                  <p class="fact-card__copy">Risk pressure connected to the timing chain.</p>
                </div>
              </div>

              <div class="support-grid">
                <section class="support-card">
                  <div class="support-card__header">
                    <p class="support-card__eyebrow">Representative tasks</p>
                    <h3>${escapeHtml(pluralize(driver.representativeTasks.length, 'task'))}</h3>
                  </div>
                  ${buildSupportList(
                    driver.representativeTasks.slice(0, 3),
                    (task) => `
                      <div class="support-item">
                        <span class="item-meta mono">${escapeHtml(task.id)} - ${escapeHtml(task.windowLabel)}</span>
                        <strong>${escapeHtml(task.name)}</strong>
                        <p class="support-item__copy">${escapeHtml(`WBS ${task.wbsId}`)}</p>
                      </div>
                    `,
                  )}
                </section>

                <section class="support-card">
                  <div class="support-card__header">
                    <p class="support-card__eyebrow">Linked milestones</p>
                    <h3>${escapeHtml(pluralize(driver.linkedMilestones.length, 'milestone'))}</h3>
                  </div>
                  ${buildSupportList(
                    driver.linkedMilestones.slice(0, 4),
                    (milestone) => `
                      <button
                        class="support-item"
                        type="button"
                        data-select-type="milestone"
                        data-select-id="${escapeHtml(milestone.id)}"
                      >
                        <span class="item-meta mono">${escapeHtml(milestone.id)} - ${escapeHtml(milestone.dateLabel)}</span>
                        <strong>${escapeHtml(milestone.shortName)}</strong>
                        <p class="support-item__copy">${escapeHtml(compactText(milestone.whyItMatters, 11))}</p>
                      </button>
                    `,
                  )}
                </section>

                <section class="support-card">
                  <div class="support-card__header">
                    <p class="support-card__eyebrow">Linked risks</p>
                    <h3>${escapeHtml(pluralize(driver.linkedRisks.length, 'risk'))}</h3>
                  </div>
                  ${buildSupportList(
                    driver.linkedRisks.slice(0, 3),
                    (risk) => `
                      <div class="support-item">
                        <span class="item-meta">${escapeHtml(`${risk.id} - ${risk.status}`)}</span>
                        <strong>${escapeHtml(risk.title)}</strong>
                        <p class="support-item__copy">${escapeHtml(`Risk score ${risk.score}`)}</p>
                      </div>
                    `,
                  )}
                </section>

                <section class="support-card">
                  <div class="support-card__header">
                    <p class="support-card__eyebrow">Linked documents</p>
                    <h3>${escapeHtml(pluralize(driver.linkedDocuments.length, 'document'))}</h3>
                  </div>
                  ${buildSupportList(
                    driver.linkedDocuments.slice(0, 3),
                    (document) => `
                      <div class="support-item">
                        <span class="item-meta">${escapeHtml(`${document.id} - ${document.type}`)}</span>
                        <strong>${escapeHtml(document.name)}</strong>
                        <p class="support-item__copy">${escapeHtml(`${document.status} - ${document.evidenceRole}`)}</p>
                      </div>
                    `,
                  )}
                </section>
              </div>
            </section>
          `
          : buildEmptyState('Select a driver', 'The schedule pressure branch will appear here.')
      }
    </div>
  `;
}

function buildMethodologyTabContent() {
  const methodology = state.data.methodology;

  supportSubtitle.textContent =
    'This deeper layer makes the interpretation boundaries visible without forcing that caveat text onto the first two layers.';

  return `
    <div class="method-stack">
      <section class="support-card">
        <div class="support-card__header">
          <p class="support-card__eyebrow">Methodology</p>
          <h3>${escapeHtml(methodology.title)}</h3>
          <p class="support-card__summary">${escapeHtml(compactText(methodology.summary, 26))}</p>
        </div>
      </section>

      <section class="support-card">
        <div class="support-card__header">
          <p class="support-card__eyebrow">Authority guide</p>
          <h3>Why the deeper schedule view stays credible</h3>
          <p class="support-card__summary">${escapeHtml(compactText(methodology.authorityGuideSummary, 30))}</p>
        </div>
      </section>

      ${methodology.cards
        .map(
          (card) => `
            <details class="method-card">
              <summary class="method-card__summary">
                <span class="method-card__eyebrow">${escapeHtml(card.eyebrow)}</span>
                <h3>${escapeHtml(card.title)}</h3>
              </summary>
              <div class="method-card__body">
                <p>${escapeHtml(compactText(card.body, 24))}</p>
                <ul>
                  ${card.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                </ul>
              </div>
            </details>
          `,
        )
        .join('')}
    </div>
  `;
}

function buildTraceabilityTabContent() {
  const traceability = state.data.traceability;
  const artifacts = state.reveal.artifacts ? traceability.artifacts : traceability.artifacts.slice(0, 3);
  const sources = state.reveal.sources ? traceability.sources : traceability.sources.slice(0, 4);

  supportSubtitle.textContent =
    'This deeper layer shows where the schedule came from, what is linked authority, and where the app adds interpretation.';

  return `
    <div class="traceability-shell">
      <section class="support-card">
        <div class="support-card__header">
          <p class="support-card__eyebrow">Traceability</p>
          <h3>${escapeHtml(traceability.title)}</h3>
          <p class="support-card__summary">${escapeHtml(compactText(traceability.summary, 24))}</p>
        </div>
      </section>

      <div class="evidence-grid">
        ${traceability.evidenceModel
          .map(
            (item) => `
              <section class="evidence-card">
                <span class="evidence-card__meta">${escapeHtml(item.label)}</span>
                <h3>${escapeHtml(item.value)}</h3>
                <p>${escapeHtml(compactText(item.description, 12))}</p>
              </section>
            `,
          )
          .join('')}
      </div>

      <div class="support-grid">
        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Authority artifacts</p>
            <h3>Files underpinning the schedule lens</h3>
            <p class="support-card__summary">The app is a presentation layer above these source artifacts, not a replacement for them.</p>
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
                    <p>${escapeHtml(compactText(artifact.description, 16))}</p>
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
                    ${state.reveal.artifacts ? 'Show fewer artifacts' : `Show all ${traceability.artifacts.length} artifacts`}
                  </button>
                </div>
              `
              : ''
          }
        </section>

        <section class="support-card">
          <div class="support-card__header">
            <p class="support-card__eyebrow">Source register</p>
            <h3>Direct anchors, linked authority, and support sources</h3>
            <p class="support-card__summary">These sources explain what came from public or formal authority and what is linked support inside the lens.</p>
          </div>

          <div class="source-list">
            ${sources
              .map(
                (source) => `
                  <section class="source-card">
                    <div class="source-card__row">
                      <span class="item-meta">${escapeHtml(`${source.id} - ${source.publisher}`)}</span>
                      <span class="${tagClass(source.tone)}">${escapeHtml(source.authorityTierLabel)}</span>
                    </div>
                    <h3>${escapeHtml(source.title)}</h3>
                    <p>${escapeHtml(compactText(source.relevance, 15))}</p>
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
    </div>
  `;
}

function renderSupportTabs() {
  const tabs = [
    { id: 'support', label: 'Focused support' },
    { id: 'drivers', label: 'Schedule drivers' },
    { id: 'methodology', label: 'Methodology' },
    { id: 'traceability', label: 'Traceability' },
  ];

  supportTabs.innerHTML = tabs
    .map(
      (tab) => `
        <button
          class="support-tab${state.support.tab === tab.id ? ' support-tab--active' : ''}"
          type="button"
          role="tab"
          aria-selected="${String(state.support.tab === tab.id)}"
          data-action="set-support-tab"
          data-support-tab="${escapeHtml(tab.id)}"
        >
          ${escapeHtml(tab.label)}
        </button>
      `,
    )
    .join('');
}

function renderSupport() {
  if (!state.support.open) {
    supportLayer.hidden = true;
    return;
  }

  supportLayer.hidden = false;
  renderSupportTabs();

  switch (state.support.tab) {
    case 'drivers':
      supportContent.innerHTML = buildDriversTabContent();
      break;
    case 'methodology':
      supportContent.innerHTML = buildMethodologyTabContent();
      break;
    case 'traceability':
      supportContent.innerHTML = buildTraceabilityTabContent();
      break;
    default:
      supportContent.innerHTML = buildSupportTabContent();
      break;
  }
}

function renderApp() {
  appTitle.textContent = state.data.appTitle;
  appSubtitle.textContent = 'Visual schedule map of Gateway across major phases and milestone dates.';
  generatedAt.textContent = `Preprocessed locally ${dateTimeFormatter.format(new Date(state.data.generatedAt))}`;
  stageFrame.textContent = '2017 to 2031. Major phases. Key milestone dates.';

  buildSignalPills();
  buildStageOverview();
  renderTimeline();
  renderFocus();
  renderSupport();
}

function openSupport(tab) {
  state.support.open = true;
  state.support.tab = tab;
  renderApp();
  scrollToId('supportLayer');
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

  if (action === 'open-support') {
    openSupport(target.dataset.supportTab || 'support');
    return;
  }

  if (action === 'close-support') {
    state.support.open = false;
    renderApp();
    scrollToId('focusLayer');
    return;
  }

  if (action === 'set-support-tab') {
    state.support.tab = target.dataset.supportTab;
    renderSupport();
    return;
  }

  if (action === 'set-driver') {
    state.activeDriverId = target.dataset.driverId;
    if (!state.support.open) {
      state.support.open = true;
      state.support.tab = 'drivers';
      renderApp();
      scrollToId('supportLayer');
      return;
    }

    if (state.support.tab !== 'drivers') state.support.tab = 'drivers';
    renderSupport();
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
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Unable to load schedule data (${response.status})`);
  }

  const data = await response.json();
  state.data = data;
  buildMaps(data);
  state.activeDriverId = data.defaultDriverId;
  state.selection = null;

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
  generatedAt.textContent = 'Authority data unavailable';
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
