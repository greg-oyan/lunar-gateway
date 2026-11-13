import {
  applySuiteNav,
  buildOpenInHtml,
  buildSuiteHref,
  compareWbsId,
  loadSuiteCrosswalk,
  mergeQueryState,
  readSharedContext,
  resolveScope,
} from '../suite-assets/suite-context.js';
import {
  RISK_BANDS,
  bandChipHtml,
  bindTooltips,
  escapeHtml,
  fiscalYearEnd,
  fiscalYearStart,
  formatMonthYear,
  formatPercent,
  formatUsdCompact,
  formatUsdFull,
  hideTooltip,
  linearScale,
  niceTicks,
  observeWidth,
  parseIsoDate,
  riskBand,
} from '../suite-assets/suite-kit.js';

const DATA_URLS = {
  cost: '../cost/data/gateway-cost.json',
  schedule: '../schedule/data/gateway-schedule.json',
  risks: '../risk/data/risks.json',
  crosswalk: '../suite-assets/data/gateway-crosswalk.json',
};

const ROOT_ID = '1.0';
const TOP_RISK_COUNT = 5;
const MAX_CALLOUT_ROWS = 3;

// Same four cost components, in the same order, as the Cost Explorer.
const COMPONENTS = [
  { key: 'laborUsd', label: 'Labor', color: 'var(--series-1)' },
  { key: 'materialUsd', label: 'Material', color: 'var(--series-2)' },
  { key: 'integrationUsd', label: 'Integration', color: 'var(--series-3)' },
  { key: 'reserveUsd', label: 'Reserve', color: 'var(--series-4)' },
];

const SCOPE_COLORS = {
  'NASA-led scope': 'var(--series-1)',
  'Partner reference': 'var(--series-2)',
};

const state = {
  data: null,
  crosswalk: null,
  sharedContext: {},
  scopeId: '',
  matrixCell: null,
  scorecardOpen: false,
  categoriesById: new Map(),
  risksById: new Map(),
  milestonesById: new Map(),
};

const elements = {
  main: document.getElementById('main'),
  breadcrumb: document.getElementById('breadcrumb'),
  pageTitle: document.getElementById('pageTitle'),
  pageSub: document.getElementById('pageSub'),
  headActions: document.getElementById('headActions'),
};

let timelineObserver = null;

function getScope() {
  if (!state.scopeId || state.scopeId === ROOT_ID) return null;
  return resolveScope(state.crosswalk, state.scopeId);
}

function buildTopNavContext() {
  return {
    from: 'overview',
    wbs: getScope()?.id || '',
  };
}

function syncSuiteNavigation() {
  applySuiteNav(buildTopNavContext(), { currentRoute: 'overview' });
}

function handoffHref(route, extra = {}) {
  return buildSuiteHref(route, { from: 'overview', wbs: getScope()?.id || '', ...extra }, { currentRoute: 'overview' });
}

function category(id) {
  return state.categoriesById.get(id) || null;
}

function crosswalkNode(id) {
  return state.crosswalk?.wbs?.byId?.[id] || null;
}

function focusCategory() {
  return category(getScope()?.id || ROOT_ID) || category(ROOT_ID);
}

// Rows shown in the element chart and scorecard: the children of the scoped
// element, or its siblings when it has none.
function displayParent() {
  const scoped = focusCategory();
  if (!getScope()) return category(ROOT_ID);
  if (scoped.childIds?.length) return scoped;
  return category(scoped.parentId) || category(ROOT_ID);
}

function displayRows() {
  const parent = displayParent();
  return (parent.childIds || [])
    .map((id) => category(id))
    .filter(Boolean)
    .sort((left, right) => right.baseUsd - left.baseUsd || compareWbsId(left.id, right.id));
}

function risksFor(id) {
  if (!id || id === ROOT_ID) return [...state.risksById.values()];
  return (crosswalkNode(id)?.risks?.ids || []).map((riskId) => state.risksById.get(riskId)).filter(Boolean);
}

function milestonesFor(id) {
  if (!id || id === ROOT_ID) return [...state.milestonesById.values()];
  return (crosswalkNode(id)?.schedule?.milestoneIds || [])
    .map((milestoneId) => state.milestonesById.get(milestoneId))
    .filter(Boolean)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function sortRisks(risks) {
  return [...risks].sort(
    (left, right) =>
      right.priority - left.priority || right.impact - left.impact || right.likelihood - left.likelihood || left.id.localeCompare(right.id),
  );
}

// Yearly phasing is held at level 1 of the WBS. Deeper elements fall back to
// their level-1 ancestor, and the chart says so.
function phasingSource(cat) {
  let current = cat;
  while (current && !current.yearly?.some((year) => year.totalUsd > 0)) {
    current = category(current.parentId);
  }
  return current || category(ROOT_ID);
}

function setScope(nextId, options = {}) {
  const id = nextId && nextId !== ROOT_ID && category(nextId) ? nextId : '';
  if (id === state.scopeId) return;
  state.scopeId = id;
  state.matrixCell = null;
  if (options.updateUrl !== false) {
    mergeQueryState({ wbs: id }, { replace: false });
  }
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Header ---------- */

function renderHeader() {
  const scope = getScope();
  const cat = focusCategory();
  const trail = [];
  let current = scope ? category(cat.parentId) : null;
  while (current) {
    trail.unshift(current);
    current = category(current.parentId);
  }

  elements.breadcrumb.innerHTML = scope
    ? `${trail
        .map(
          (item) =>
            `<button class="breadcrumb__link" type="button" data-action="set-scope" data-wbs="${escapeHtml(item.id)}">${
              item.id === ROOT_ID ? 'Program' : `${escapeHtml(item.id)} ${escapeHtml(item.name)}`
            }</button><span class="breadcrumb__sep" aria-hidden="true">/</span>`,
        )
        .join('')}<span>WBS ${escapeHtml(cat.id)}</span>`
    : '<span>Lunar Gateway</span>';

  elements.pageTitle.textContent = scope ? cat.name : 'Program Overview';
  elements.pageSub.textContent = scope
    ? cat.meaning || ''
    : 'Cost, schedule, and risk for Gateway on one screen.';
  document.title = `${scope ? `${cat.id} ${cat.name}` : 'Program Overview'} | Lunar Gateway`;

  elements.headActions.innerHTML = scope
    ? `${buildOpenInHtml([
        { label: 'WBS', href: handoffHref('wbs') },
        { label: 'Cost', href: handoffHref('cost') },
        { label: 'Schedule', href: handoffHref('schedule') },
        { label: 'Risk', href: handoffHref('risk') },
      ])}
      <button class="pill-action pill-action--primary" type="button" data-action="set-scope" data-wbs="">Whole program</button>`
    : `<a class="pill-action pill-action--primary" href="${escapeHtml(handoffHref('confidence'))}">Confidence Lab</a>`;
}

/* ---------- KPI tiles ---------- */

function renderTiles() {
  const scope = getScope();
  const cat = focusCategory();
  const overview = state.data.cost.overview;
  const risks = risksFor(scope?.id);
  const milestones = milestonesFor(scope?.id);
  const phasing = phasingSource(cat);
  const peak = scope
    ? [...phasing.yearly].sort((left, right) => right.totalUsd - left.totalUsd)[0]
    : overview.busiestYear;
  const bandCounts = RISK_BANDS.map((band) => ({
    band,
    count: risks.filter((risk) => riskBand(risk.priority).key === band.key).length,
  })).filter((item) => item.count);
  const topRisk = sortRisks(risks)[0];
  const firstMilestone = milestones[0];
  const lastMilestone = milestones.at(-1);

  const tiles = [
    {
      label: 'Estimate',
      route: 'cost',
      value: formatUsdCompact(cat.baseUsd),
      sub: `Range ${formatUsdCompact(cat.lowUsd)} to ${formatUsdCompact(cat.highUsd)}${
        scope ? ` · ${formatPercent(cat.baseUsd / category(ROOT_ID).baseUsd, 1)} of program` : ` · FY${overview.startFy} to FY${overview.endFy}`
      }`,
    },
    {
      label: 'Peak year',
      route: 'cost',
      extra: { view: 'year', year: peak?.fy || '' },
      value: peak?.fy || 'n/a',
      sub: peak
        ? `${formatUsdCompact(peak.totalUsd)} in the year${phasing.id !== cat.id ? ` · phased at WBS ${phasing.id}` : ''}`
        : 'No yearly phasing',
    },
    {
      label: 'Schedule',
      route: 'schedule',
      value: scope ? `${milestones.length} ${milestones.length === 1 ? 'milestone' : 'milestones'}` : state.data.schedule.overview.spanValue,
      sub: scope
        ? milestones.length
          ? `${firstMilestone.dateLabel} to ${lastMilestone.dateLabel}`
          : 'None linked to this element'
        : `${milestones.length} milestones across ${state.data.schedule.phases.length} phases`,
    },
    {
      label: 'Risk',
      route: 'risk',
      value: `${risks.length} ${risks.length === 1 ? 'risk' : 'risks'}`,
      sub: risks.length
        ? `${bandCounts.map((item) => `${item.count} ${item.band.label.toLowerCase()}`).join(', ')} · top score ${topRisk.priority}`
        : 'None linked to this element',
    },
  ];

  return `
    <section class="grid grid--tiles" aria-label="Headline figures">
      ${tiles
        .map(
          (tile) => `
        <a class="tile" href="${escapeHtml(handoffHref(tile.route, tile.extra || {}))}">
          <span class="tile__label">${escapeHtml(tile.label)}<span class="tile__open" aria-hidden="true">Open →</span></span>
          <span class="tile__value">${escapeHtml(tile.value)}</span>
          <span class="tile__sub">${escapeHtml(tile.sub)}</span>
        </a>`,
        )
        .join('')}
    </section>`;
}

/* ---------- Cost by element ---------- */

// The tile above already carries the total. At program level the elements sum
// to less than it, so the note says where the difference sits.
function elementBarsNote(parent, rows) {
  const listed = rows.reduce((sum, row) => sum + row.baseUsd, 0);
  const held = parent.baseUsd - listed;
  const count = `${rows.length} ${rows.length === 1 ? 'element' : 'elements'}`;
  if (held > 0.005 * parent.baseUsd) {
    const label = parent.id === ROOT_ID ? 'program reserve' : `held at ${parent.id}`;
    return `${count} · ${formatUsdCompact(held)} ${label} not shown`;
  }
  return count;
}

function renderElementBars() {
  const scope = getScope();
  const parent = displayParent();
  const rows = displayRows();
  const maxValue = Math.max(...rows.map((row) => row.highUsd), 1);
  const scopeLabels = [...new Set(rows.map((row) => row.scopeLabel))].filter((label) => SCOPE_COLORS[label]);
  const selectedId = scope && scope.id !== parent.id ? scope.id : '';

  return `
    <article class="panel" aria-labelledby="barsTitle">
      <div class="panel__head">
        <h2 class="panel__title" id="barsTitle">${
          parent.id === ROOT_ID ? 'Cost by element' : `Cost within ${escapeHtml(parent.id)} ${escapeHtml(parent.name)}`
        }</h2>
        <p class="panel__note">${elementBarsNote(parent, rows)}</p>
      </div>
      <ul class="legend" style="margin-bottom:10px">
        ${scopeLabels
          .map((label) => `<li><span class="legend__swatch" style="background:${SCOPE_COLORS[label]}"></span>${escapeHtml(label)}</li>`)
          .join('')}
        <li><span class="legend__swatch legend__swatch--range"></span>Low to high range</li>
      </ul>
      <div class="bars${selectedId ? ' bars--has-selection' : ''}" id="elementBars">
        ${rows
          .map((row) => {
            const drillable = row.childIds?.length || row.id !== selectedId;
            return `
          <button class="bar-row${row.id === selectedId ? ' bar-row--selected' : ''}" type="button" data-action="set-scope" data-wbs="${escapeHtml(
            drillable ? row.id : parent.id,
          )}" data-tip-id="${escapeHtml(row.id)}" aria-pressed="${row.id === selectedId}">
            <span class="bar-row__name"><span class="bar-row__id">${escapeHtml(row.id)}</span><span>${escapeHtml(row.name)}</span></span>
            <span class="bar-row__track" aria-hidden="true">
              <span class="bar-row__fill" style="width:${((row.baseUsd / maxValue) * 100).toFixed(2)}%;--bar-color:${
                SCOPE_COLORS[row.scopeLabel] || 'var(--series-1)'
              }"></span>
              <span class="bar-row__range" style="left:${((row.lowUsd / maxValue) * 100).toFixed(2)}%;width:${(
                ((row.highUsd - row.lowUsd) / maxValue) *
                100
              ).toFixed(2)}%"></span>
            </span>
            <span class="bar-row__value">${formatUsdCompact(row.baseUsd)}</span>
          </button>`;
          })
          .join('')}
      </div>
    </article>`;
}

function elementTooltip(id) {
  const row = category(id);
  if (!row) return '';
  const riskCount = risksFor(id).length;
  return `
    <p class="viz-tooltip__title">${escapeHtml(row.id)} ${escapeHtml(row.name)}</p>
    <p class="viz-tooltip__row"><span>Estimate</span><strong>${formatUsdFull(row.baseUsd)}</strong></p>
    <p class="viz-tooltip__row"><span>Low to high</span><strong>${formatUsdCompact(row.lowUsd)} to ${formatUsdCompact(row.highUsd)}</strong></p>
    <p class="viz-tooltip__row"><span>Share of program</span><strong>${formatPercent(row.baseUsd / category(ROOT_ID).baseUsd, 1)}</strong></p>
    <p class="viz-tooltip__row"><span>Linked risks</span><strong>${riskCount}</strong></p>
    <p class="viz-tooltip__note">${escapeHtml(row.scopeLabel)} · ${escapeHtml(row.basisLabel)}</p>`;
}

/* ---------- Risk matrix ---------- */

function renderRiskPanel() {
  const scope = getScope();
  const risks = risksFor(scope?.id);
  const total = state.risksById.size;
  const cellRisks = (likelihood, impact) => risks.filter((risk) => risk.likelihood === likelihood && risk.impact === impact);
  const selected = state.matrixCell;
  const listed = selected ? sortRisks(cellRisks(selected.likelihood, selected.impact)) : sortRisks(risks).slice(0, TOP_RISK_COUNT);

  const cells = [];
  for (let likelihood = 5; likelihood >= 1; likelihood -= 1) {
    cells.push(`<span class="matrix__tick" style="grid-column:2">${likelihood}</span>`);
    for (let impact = 1; impact <= 5; impact += 1) {
      const count = cellRisks(likelihood, impact).length;
      const band = riskBand(likelihood * impact);
      const isSelected = selected && selected.likelihood === likelihood && selected.impact === impact;
      cells.push(`
        <button class="matrix__cell${count ? ' matrix__cell--filled' : ''}${isSelected ? ' matrix__cell--selected' : ''}" type="button"
          style="--cell-color:var(--band-${band.key})" data-action="matrix-cell" data-likelihood="${likelihood}" data-impact="${impact}"
          data-tip-id="${likelihood}:${impact}" ${count ? '' : 'disabled'} aria-pressed="${Boolean(isSelected)}"
          aria-label="Likelihood ${likelihood}, impact ${impact}, ${band.label}: ${count} ${count === 1 ? 'risk' : 'risks'}">${count || ''}</button>`);
    }
  }

  return `
    <article class="panel" aria-labelledby="riskTitle">
      <div class="panel__head">
        <h2 class="panel__title" id="riskTitle">Risk matrix</h2>
        <p class="panel__note">${scope ? `${risks.length} of ${total} risks linked to WBS ${escapeHtml(scope.id)}` : 'Score = likelihood × impact'}</p>
      </div>
      <ul class="legend" style="margin-bottom:12px">
        ${RISK_BANDS.map(
          (band) => `<li><span class="legend__swatch" style="background:var(--band-${band.key})"></span>${band.label} ${band.range}</li>`,
        ).join('')}
      </ul>
      <div class="matrix" id="riskMatrix">
        <span class="matrix__axis-title matrix__axis-title--y">Likelihood</span>
        ${cells.join('')}
        ${[1, 2, 3, 4, 5].map((impact) => `<span class="matrix__tick" style="grid-row:6;grid-column:${impact + 2}">${impact}</span>`).join('')}
        <span class="matrix__axis-title matrix__axis-title--x">Impact</span>
      </div>
      <div style="margin-top:18px">
        <p class="risk-list__head">
          <span>${
            selected
              ? `Likelihood ${selected.likelihood}, impact ${selected.impact}`
              : risks.length > TOP_RISK_COUNT
                ? `Top ${TOP_RISK_COUNT} by score`
                : 'By score'
          }</span>
          ${
            selected
              ? '<button class="text-action" type="button" data-action="matrix-clear">Show top risks</button>'
              : `<a class="text-action" href="${escapeHtml(handoffHref('risk'))}">All ${risks.length} in Risk Explorer →</a>`
          }
        </p>
        ${
          listed.length
            ? `<ul class="risk-list">${listed
                .map(
                  (risk) => `
              <li><a class="risk-item" href="${escapeHtml(handoffHref('risk', { risk: risk.id }))}">
                ${bandChipHtml(risk.priority)}
                <span class="risk-item__title"><span class="risk-item__id">${escapeHtml(risk.id)}</span> ${escapeHtml(risk.title)}</span>
              </a></li>`,
                )
                .join('')}</ul>`
            : '<p class="muted">No risks linked to this element.</p>'
        }
      </div>
    </article>`;
}

function matrixTooltip(id) {
  const [likelihood, impact] = id.split(':').map(Number);
  const risks = risksFor(getScope()?.id).filter((risk) => risk.likelihood === likelihood && risk.impact === impact);
  const band = riskBand(likelihood * impact);
  return `
    <p class="viz-tooltip__title">${band.label} · score ${likelihood * impact}</p>
    <p class="viz-tooltip__row"><span>Likelihood ${likelihood} × impact ${impact}</span><strong>${risks.length} ${risks.length === 1 ? 'risk' : 'risks'}</strong></p>
    ${risks
      .slice(0, 6)
      .map((risk) => `<p class="viz-tooltip__note">${escapeHtml(risk.id)} ${escapeHtml(risk.title)}</p>`)
      .join('')}`;
}

/* ---------- Spend and schedule on one time axis ---------- */

function timelineModel() {
  const scope = getScope();
  const cat = focusCategory();
  const source = phasingSource(cat);
  const programYears = state.data.cost.years;
  const years = scope
    ? source.yearly.map((year) => ({ fy: year.fy, totalUsd: year.totalUsd }))
    : programYears;
  const linkedIds = new Set(scope ? milestonesFor(scope.id).map((milestone) => milestone.id) : []);
  return { scope, cat, source, years, linkedIds, stacked: !scope };
}

function renderTimelinePanel() {
  const { scope, cat, source, stacked } = timelineModel();
  const legend = stacked
    ? COMPONENTS.map((component) => `<li><span class="legend__swatch" style="background:${component.color}"></span>${component.label}</li>`).join('')
    : `<li><span class="legend__swatch" style="background:var(--series-1)"></span>${escapeHtml(source.id)} ${escapeHtml(source.name)}</li>`;

  return `
    <article class="panel" aria-labelledby="timelineTitle">
      <div class="panel__head">
        <h2 class="panel__title" id="timelineTitle">Spend and schedule on one timeline</h2>
        <p class="panel__note">${
          scope && source.id !== cat.id
            ? `Yearly phasing is held at WBS ${escapeHtml(source.id)}; showing ${escapeHtml(source.name)}`
            : 'Fiscal years start Oct 1'
        }</p>
      </div>
      <ul class="legend" style="margin-bottom:6px">
        ${legend}
        <li><span class="legend__swatch" style="background:var(--series-muted)"></span>Phase</li>
        <li><span class="legend__swatch legend__swatch--diamond" style="background:var(--ink)"></span>${scope ? 'Milestone' : 'Key milestone'}</li>
        ${scope ? `<li><span class="legend__swatch legend__swatch--diamond" style="background:var(--series-2)"></span>Linked to WBS ${escapeHtml(scope.id)}</li>` : ''}
      </ul>
      <div class="chart-scroll">
        <div class="chart timeline-chart" id="timelineChart" role="img" aria-label="Annual spend by fiscal year above the program phases and milestones, on a shared time axis. The scorecard table below carries the same figures."></div>
      </div>
    </article>`;
}

function estimateTextWidth(text, size = 11.5) {
  return String(text).length * size * 0.56;
}

function drawTimeline(width) {
  const host = document.getElementById('timelineChart');
  if (!host || !width) return;
  const { scope, years, linkedIds, stacked } = timelineModel();
  const schedule = state.data.schedule;
  const phases = schedule.phases;
  const milestones = schedule.milestones;

  const margin = { left: 96, right: 20, top: 30 };
  const columnsHeight = 210;
  const axisHeight = 30;
  const rowHeight = 22;
  const ganttTop = margin.top + columnsHeight + axisHeight + 24;
  const ganttHeight = phases.length * rowHeight;
  const calloutTop = ganttTop + ganttHeight + 14;
  const calloutRowHeight = 19;

  const allFy = [];
  const firstFy = Math.min(Number(years[0].fy.slice(2)), parseIsoDate(schedule.timeline.start).getUTCFullYear() + 1);
  const lastFy = Math.max(Number(years.at(-1).fy.slice(2)), parseIsoDate(schedule.timeline.end).getUTCFullYear());
  for (let fy = firstFy; fy <= lastFy; fy += 1) allFy.push(`FY${fy}`);

  const domainStart = fiscalYearStart(allFy[0]).getTime();
  const domainEnd = fiscalYearEnd(allFy.at(-1)).getTime();
  const x = linearScale([domainStart, domainEnd], [margin.left, width - margin.right]);
  const bandWidth = (width - margin.left - margin.right) / allFy.length;
  const columnWidth = Math.min(24, Math.max(8, bandWidth * 0.5));

  const maxTotal = Math.max(...years.map((year) => year.totalUsd), 1);
  const ticks = niceTicks(maxTotal, 4);
  const y = linearScale([0, ticks.at(-1)], [margin.top + columnsHeight, margin.top]);
  const baseline = y(0);
  const yearByFy = new Map(years.map((year) => [year.fy, year]));

  const parts = [];

  // Gridlines and y ticks.
  ticks.forEach((tick) => {
    parts.push(`<line class="${tick === 0 ? 'axis-line' : 'grid-line'}" x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}"/>`);
    parts.push(`<text class="tick-label" x="${margin.left - 10}" y="${y(tick) + 4}" text-anchor="end">${formatUsdCompact(tick)}</text>`);
  });
  parts.push(`<text class="lane-title" x="0" y="10">Spend</text>`);

  // Columns.
  allFy.forEach((fy, index) => {
    const year = yearByFy.get(fy);
    const bandStart = margin.left + index * bandWidth;
    const centre = bandStart + bandWidth / 2;
    const short = bandWidth < 62;
    parts.push(
      `<text class="tick-label" x="${centre}" y="${baseline + 18}" text-anchor="middle">${short ? `'${fy.slice(4)}` : fy}</text>`,
    );
    if (!year || !year.totalUsd) return;

    const left = centre - columnWidth / 2;
    const segments = stacked
      ? COMPONENTS.map((component) => ({ value: year[component.key] || 0, color: component.color })).filter((segment) => segment.value > 0)
      : [{ value: year.totalUsd, color: 'var(--series-1)' }];
    let cursor = baseline;
    segments.forEach((segment, segmentIndex) => {
      const fullHeight = baseline - y(segment.value);
      const isTop = segmentIndex === segments.length - 1;
      const gap = isTop || fullHeight < 4 ? 0 : 2;
      const height = Math.max(fullHeight - gap, 1);
      const top = cursor - fullHeight + gap;
      if (isTop) {
        const radius = Math.min(4, height, columnWidth / 2);
        parts.push(
          `<path fill="${segment.color}" d="M${left},${top + height} V${top + radius} Q${left},${top} ${left + radius},${top} H${left + columnWidth - radius} Q${left + columnWidth},${top} ${left + columnWidth},${top + radius} V${top + height} Z"/>`,
        );
      } else {
        parts.push(`<rect fill="${segment.color}" x="${left}" y="${top}" width="${columnWidth}" height="${height}"/>`);
      }
      cursor -= fullHeight;
    });

    if (year.totalUsd === maxTotal) {
      parts.push(`<text class="value-label" x="${centre}" y="${y(year.totalUsd) - 7}" text-anchor="middle">${formatUsdCompact(year.totalUsd)}</text>`);
    }
    parts.push(
      `<rect class="column-hit" x="${bandStart}" y="${margin.top}" width="${bandWidth}" height="${columnsHeight}" data-tip-id="fy:${fy}" data-action="open-year" data-year="${fy}" tabindex="0" role="link" aria-label="${fy}: ${formatUsdCompact(year.totalUsd)}. Open in Cost Explorer."/>`,
    );
  });

  // Phase rows.
  parts.push(`<text class="lane-title" x="0" y="${ganttTop - 10}">Schedule</text>`);
  const rowCentre = new Map();
  phases.forEach((phase, index) => {
    const centre = ganttTop + index * rowHeight + rowHeight / 2;
    rowCentre.set(phase.id, centre);
    const start = x(parseIsoDate(phase.start).getTime());
    const end = x(parseIsoDate(phase.end).getTime());
    parts.push(`<text class="phase-label" x="${margin.left - 10}" y="${centre + 4}" text-anchor="end">${escapeHtml(phase.name)}</text>`);
    parts.push(`<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${centre}" y2="${centre}"/>`);
    parts.push(`<rect class="phase-bar" x="${start}" y="${centre - 4}" width="${Math.max(end - start, 6)}" height="8" rx="4"/>`);
  });

  // Callouts: key milestones at program level, linked milestones when scoped.
  const keyIds = new Set(schedule.timeline.keyMilestoneIds || []);
  const calloutIds = scope ? linkedIds : keyIds;
  const rowsRight = new Array(MAX_CALLOUT_ROWS).fill(-Infinity);
  const callouts = [];
  milestones
    .filter((milestone) => calloutIds.has(milestone.id))
    .sort((left, right) => left.date.localeCompare(right.date))
    .forEach((milestone) => {
      const anchor = x(parseIsoDate(milestone.date).getTime());
      const name = milestone.shortName || milestone.name;
      const date = formatMonthYear(parseIsoDate(milestone.date));
      const textWidth = estimateTextWidth(name) + estimateTextWidth(date, 10.5) + 10;
      const left = Math.min(Math.max(anchor - textWidth / 2, margin.left), width - margin.right - textWidth);
      const row = rowsRight.findIndex((right) => left > right + 12);
      if (row === -1) return;
      rowsRight[row] = left + textWidth;
      callouts.push({ milestone, anchor, left, row, name, date });
    });
  const usedRows = Math.max(...callouts.map((callout) => callout.row + 1), 0);

  callouts.forEach((callout) => {
    const centre = rowCentre.get(callout.milestone.phaseId) ?? ganttTop;
    const labelY = calloutTop + callout.row * calloutRowHeight + 12;
    parts.push(`<line class="callout-line" x1="${callout.anchor}" x2="${callout.anchor}" y1="${centre + 7}" y2="${labelY - 11}"/>`);
    parts.push(
      `<text x="${callout.left}" y="${labelY}"><tspan class="callout-label">${escapeHtml(callout.name)}</tspan><tspan class="callout-date" dx="6">${escapeHtml(callout.date)}</tspan></text>`,
    );
  });

  // Milestones, drawn last so they sit above bars and leader lines.
  milestones.forEach((milestone) => {
    const centre = rowCentre.get(milestone.phaseId);
    if (centre === undefined) return;
    const anchor = x(parseIsoDate(milestone.date).getTime());
    const isLinked = linkedIds.has(milestone.id);
    const isKey = !scope && keyIds.has(milestone.id);
    const size = isKey || isLinked ? 6 : 4.5;
    const classes = ['milestone', isKey ? 'milestone--key' : '', isLinked ? 'milestone--linked' : '', scope && !isLinked ? 'milestone--dim' : '']
      .filter(Boolean)
      .join(' ');
    parts.push(`<rect class="${classes}" x="${anchor - size}" y="${centre - size}" width="${size * 2}" height="${size * 2}" transform="rotate(45 ${anchor} ${centre})"/>`);
    parts.push(
      `<circle class="milestone-hit" cx="${anchor}" cy="${centre}" r="11" data-tip-id="ms:${milestone.id}" data-action="open-milestone" data-milestone="${milestone.id}" tabindex="0" role="link" aria-label="${escapeHtml(
        milestone.shortName || milestone.name,
      )}, ${escapeHtml(milestone.dateLabel)}. Open in Schedule Explorer."/>`,
    );
  });

  const height = calloutTop + Math.max(usedRows, 1) * calloutRowHeight + 6;
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="false">${parts.join('')}</svg>`;
}

function timelineTooltip(id) {
  const [kind, key] = id.split(':');
  if (kind === 'fy') {
    const { years, stacked, source } = timelineModel();
    const year = years.find((item) => item.fy === key);
    if (!year) return '';
    const rows = stacked
      ? COMPONENTS.filter((component) => year[component.key])
          .map(
            (component) =>
              `<p class="viz-tooltip__row"><span class="viz-tooltip__key"><span class="legend__swatch" style="background:${component.color}"></span>${component.label}</span><strong>${formatUsdCompact(
                year[component.key],
              )}</strong></p>`,
          )
          .join('')
      : `<p class="viz-tooltip__note">${escapeHtml(source.id)} ${escapeHtml(source.name)}</p>`;
    const start = fiscalYearStart(key);
    const end = fiscalYearEnd(key);
    const inYear = state.data.schedule.milestones.filter((milestone) => {
      const time = parseIsoDate(milestone.date).getTime();
      return time >= start.getTime() && time <= end.getTime();
    });
    return `
      <p class="viz-tooltip__title">${escapeHtml(key)} · ${formatUsdCompact(year.totalUsd)}</p>
      ${rows}
      <p class="viz-tooltip__note">${inYear.length} ${inYear.length === 1 ? 'milestone' : 'milestones'} in the year</p>`;
  }

  const milestone = state.milestonesById.get(key);
  if (!milestone) return '';
  const riskCount = milestone.linkedRisks?.length || 0;
  return `
    <p class="viz-tooltip__title">${escapeHtml(milestone.shortName || milestone.name)}</p>
    <p class="viz-tooltip__row"><span>${escapeHtml(milestone.phaseName)}</span><strong>${escapeHtml(milestone.dateLabel)}</strong></p>
    ${milestone.name !== milestone.shortName ? `<p class="viz-tooltip__note">${escapeHtml(milestone.name)}</p>` : ''}
    <p class="viz-tooltip__note">${escapeHtml(milestone.id)} · ${escapeHtml(milestone.confidenceLabel)}${riskCount ? ` · ${riskCount} linked ${riskCount === 1 ? 'risk' : 'risks'}` : ''}</p>`;
}

/* ---------- Scorecard ---------- */

function sparklineHtml(cat) {
  const source = phasingSource(cat);
  if (source.id !== cat.id) return '<span class="muted">Phased at parent</span>';
  const values = source.yearly.map((year) => year.totalUsd);
  const max = Math.max(...values, 1);
  const width = 120;
  const height = 28;
  const stepX = (width - 8) / (values.length - 1);
  const points = values.map((value, index) => [4 + index * stepX, height - 4 - (value / max) * (height - 9)]);
  const line = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const peakIndex = values.indexOf(max);
  return `
    <svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="Yearly spend, peaking in ${escapeHtml(source.yearly[peakIndex].fy)}">
      <path class="spark__area" d="${line} L${points.at(-1)[0].toFixed(1)},${height - 4} L${points[0][0].toFixed(1)},${height - 4} Z"/>
      <path d="${line}"/>
      <circle cx="${points[peakIndex][0].toFixed(1)}" cy="${points[peakIndex][1].toFixed(1)}" r="3.5"/>
    </svg>`;
}

function renderScorecard() {
  const scope = getScope();
  const parent = displayParent();
  const rows = displayRows();
  const selectedId = scope && scope.id !== parent.id ? scope.id : '';
  const showPhasing = rows.some((row) => phasingSource(row).id === row.id);

  return `
    <details class="panel fold" id="scorecardFold" ${state.scorecardOpen ? 'open' : ''}>
      <summary>
        <h2 class="fold__title" id="scorecardTitle">Element scorecard</h2>
        <span class="fold__note">Lead, spend profile, milestones and risks for ${
          parent.id === ROOT_ID ? `all ${rows.length} elements` : `${rows.length} parts of ${escapeHtml(parent.id)} ${escapeHtml(parent.name)}`
        }</span>
      </summary>
      <div class="table-scroll fold__body">
        <table class="scorecard">
          <thead>
            <tr>
              <th scope="col">Element</th>
              <th scope="col">Lead</th>
              <th scope="col" class="num">Estimate</th>
              <th scope="col">Share of ${parent.id === ROOT_ID ? 'program' : escapeHtml(parent.id)}</th>
              ${showPhasing ? '<th scope="col">Spend profile</th><th scope="col">Peak</th>' : ''}
              <th scope="col" class="num">Milestones</th>
              <th scope="col">Risks</th>
              <th scope="col">Open in</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((row) => {
                const risks = sortRisks(risksFor(row.id));
                const milestones = milestonesFor(row.id);
                const share = row.baseUsd / parent.baseUsd;
                const peak = [...row.yearly].sort((left, right) => right.totalUsd - left.totalUsd)[0];
                const context = { wbs: row.id };
                return `
              <tr class="${row.id === selectedId ? 'is-selected' : ''}">
                <th scope="row">
                  <button class="scorecard__element" type="button" data-action="set-scope" data-wbs="${escapeHtml(row.id)}">
                    <span class="mono">${escapeHtml(row.id)}</span><span>${escapeHtml(row.name)}</span>
                  </button>
                </th>
                <td class="scorecard__lead">${escapeHtml(row.contractor || '')}</td>
                <td class="num">${formatUsdCompact(row.baseUsd)}</td>
                <td>
                  <div class="share">
                    <div class="share__track"><div class="share__fill" style="width:${(share * 100).toFixed(1)}%"></div></div>
                    <span class="share__value">${formatPercent(share, 1)}</span>
                  </div>
                </td>
                ${showPhasing ? `<td>${sparklineHtml(row)}</td><td>${peak?.totalUsd ? escapeHtml(peak.fy) : '<span class="muted">n/a</span>'}</td>` : ''}
                <td class="num">${milestones.length || '<span class="muted">0</span>'}</td>
                <td>${risks.length ? `<span class="risk-cell">${risks.length} ${bandChipHtml(risks[0].priority)}</span>` : '<span class="muted">None</span>'}</td>
                <td>
                  <div class="open-links">
                    <a href="${escapeHtml(handoffHref('wbs', context))}">WBS</a>
                    <a href="${escapeHtml(handoffHref('cost', context))}">Cost</a>
                    ${milestones.length ? `<a href="${escapeHtml(handoffHref('schedule', context))}">Schedule</a>` : ''}
                    ${risks.length ? `<a href="${escapeHtml(handoffHref('risk', context))}">Risk</a>` : ''}
                  </div>
                </td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </details>`;
}

/* ---------- Render and events ---------- */

function render() {
  if (!state.data) return;
  hideTooltip();
  renderHeader();
  elements.main.innerHTML = `
    <div class="stack">
      ${renderTiles()}
      <section class="grid grid--split">
        ${renderElementBars()}
        ${renderRiskPanel()}
      </section>
      ${renderTimelinePanel()}
      ${renderScorecard()}
    </div>`;

  document.getElementById('scorecardFold')?.addEventListener('toggle', (event) => {
    state.scorecardOpen = event.currentTarget.open;
  });
  const timelineHost = document.getElementById('timelineChart');
  timelineObserver?.disconnect();
  timelineObserver = observeWidth(timelineHost, drawTimeline);
  bindTooltips(document.getElementById('elementBars'), elementTooltip);
  bindTooltips(document.getElementById('riskMatrix'), matrixTooltip);
  bindTooltips(timelineHost, timelineTooltip);
  syncSuiteNavigation();
}

function handleAction(target) {
  const action = target.getAttribute('data-action');
  if (action === 'set-scope') {
    setScope(target.getAttribute('data-wbs') || '');
  } else if (action === 'matrix-cell') {
    const likelihood = Number(target.getAttribute('data-likelihood'));
    const impact = Number(target.getAttribute('data-impact'));
    const same = state.matrixCell && state.matrixCell.likelihood === likelihood && state.matrixCell.impact === impact;
    state.matrixCell = same ? null : { likelihood, impact };
    render();
  } else if (action === 'matrix-clear') {
    state.matrixCell = null;
    render();
  } else if (action === 'open-year') {
    window.location.assign(handoffHref('cost', { view: 'year', year: target.getAttribute('data-year') }));
  } else if (action === 'open-milestone') {
    window.location.assign(handoffHref('schedule', { milestone: target.getAttribute('data-milestone') }));
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (target) handleAction(target);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target.closest('svg [data-action]');
  if (!target) return;
  event.preventDefault();
  handleAction(target);
});

window.addEventListener('popstate', () => {
  state.sharedContext = readSharedContext();
  const requested = state.sharedContext.wbs || '';
  state.scopeId = requested && requested !== ROOT_ID && category(requested) ? requested : '';
  state.matrixCell = null;
  render();
});

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);
  return response.json();
}

async function init() {
  try {
    const [cost, schedule, risks, crosswalk] = await Promise.all([
      loadJson(DATA_URLS.cost),
      loadJson(DATA_URLS.schedule),
      loadJson(DATA_URLS.risks),
      loadSuiteCrosswalk(DATA_URLS.crosswalk),
    ]);
    state.data = { cost, schedule, risks };
    state.crosswalk = crosswalk;
    state.categoriesById = new Map(cost.categories.map((item) => [item.id, item]));
    state.risksById = new Map(risks.risks.map((item) => [item.id, item]));
    state.milestonesById = new Map(schedule.milestones.map((item) => [item.id, item]));
    state.sharedContext = readSharedContext();
    const requested = state.sharedContext.wbs || '';
    state.scopeId = requested && requested !== ROOT_ID && category(requested) ? requested : '';
    render();
  } catch (error) {
    console.error('Failed to load overview data', error);
    elements.main.innerHTML = `<p class="state-message">Could not load program data. ${escapeHtml(error instanceof Error ? error.message : '')}</p>`;
    syncSuiteNavigation();
  }
}

init();
