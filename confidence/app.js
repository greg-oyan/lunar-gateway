import {
  applySuiteNav,
  buildScopePillHtml,
  buildSuiteHref,
  loadSuiteCrosswalk,
  mergeQueryState,
  readSharedContext,
  resolveScope,
} from '../suite-assets/suite-context.js';
import {
  addMonths,
  bandChipHtml,
  escapeHtml,
  formatMonthYear,
  formatPercent,
  formatUsdCompact,
  hideTooltip,
  linearScale,
  observeWidth,
  parseIsoDate,
  showTooltip,
} from '../suite-assets/suite-kit.js';
import {
  MODEL_DEFAULTS,
  buildModelInputs,
  confidenceAt,
  jointConfidence,
  percentile,
  runModel,
  targetsForJointConfidence,
} from './model.js';

const DATA_URLS = {
  cost: '../cost/data/gateway-cost.json',
  schedule: '../schedule/data/gateway-schedule.json',
  risks: '../risk/data/risks.json',
  crosswalk: '../suite-assets/data/gateway-crosswalk.json',
};

// NASA baselines major projects at a 70 percent joint confidence level
// (NPR 7120.5), so 70% is the reference level throughout.
const REFERENCE_CONFIDENCE = 0.7;
const SCATTER_POINTS = 1500;
const CURVE_STEPS = 160;
const TOP_SOURCES = 8;
const SOURCE_KINDS = {
  element: { label: 'Element estimate range', color: 'var(--series-1)' },
  risk: { label: 'Risk event', color: 'var(--series-2)' },
  delay: { label: 'Launch delay', color: 'var(--series-3)' },
};

const state = {
  inputs: null,
  crosswalk: null,
  sharedContext: {},
  result: null,
  rangesOnly: null,
  settings: {
    consequenceScale: MODEL_DEFAULTS.consequenceScale,
    correlation: MODEL_DEFAULTS.correlation,
    delayCostShare: MODEL_DEFAULTS.delayCostShare,
  },
  disabled: new Set(MODEL_DEFAULTS.excludedRiskIds),
  costTarget: 0,
  slipTarget: 0,
};

const elements = {
  main: document.getElementById('main'),
  headActions: document.getElementById('headActions'),
};

const observers = [];

function getScope() {
  return resolveScope(state.crosswalk, state.sharedContext?.wbs);
}

function buildTopNavContext() {
  return {
    from: 'confidence',
    wbs: getScope()?.id || '',
  };
}

function syncSuiteNavigation() {
  applySuiteNav(buildTopNavContext(), { currentRoute: 'confidence' });
}

// Billions to two decimals where they carry information: $8.98B, $7.3B.
function usdB(value) {
  if (Math.abs(value) < 1e9) return formatUsdCompact(value);
  return `${value < 0 ? '-' : ''}$${(Math.abs(value) / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
}

function percentLabel(value) {
  if (value <= 0) return '0%';
  if (value < 0.01) return 'Under 1%';
  if (value > 0.99 && value < 1) return 'Over 99%';
  return formatPercent(value, value < 0.1 ? 1 : 0);
}

function launchDate(slipMonths = 0) {
  return addMonths(parseIsoDate(state.inputs.launchMilestone.date), slipMonths);
}

function monthsLabel(months) {
  const rounded = Math.round(months);
  return `${rounded} ${rounded === 1 ? 'month' : 'months'}`;
}

/* ---------- Model ---------- */

function recompute() {
  const settings = { ...state.settings, disabledRiskIds: state.disabled };
  state.result = runModel(state.inputs, settings);
  state.rangesOnly = runModel(state.inputs, {
    ...state.settings,
    disabledRiskIds: state.inputs.risks.map((risk) => risk.id),
  });
}

function isDefaultScenario() {
  const defaults = new Set(MODEL_DEFAULTS.excludedRiskIds);
  return (
    state.settings.consequenceScale === MODEL_DEFAULTS.consequenceScale &&
    state.settings.correlation === MODEL_DEFAULTS.correlation &&
    state.settings.delayCostShare === MODEL_DEFAULTS.delayCostShare &&
    state.disabled.size === defaults.size &&
    [...state.disabled].every((id) => defaults.has(id))
  );
}

function syncUrlState() {
  const defaultsOff = [...MODEL_DEFAULTS.excludedRiskIds].sort().join(',');
  const off = [...state.disabled].sort().join(',');
  mergeQueryState({
    off: off === defaultsOff ? '' : off || 'none',
    scale: state.settings.consequenceScale === MODEL_DEFAULTS.consequenceScale ? '' : state.settings.consequenceScale,
    corr: state.settings.correlation === MODEL_DEFAULTS.correlation ? '' : state.settings.correlation,
    delay: state.settings.delayCostShare === MODEL_DEFAULTS.delayCostShare ? '' : state.settings.delayCostShare,
    cost: state.costTarget === state.inputs.budget ? '' : Math.round(state.costTarget / 1e6),
    slip: state.slipTarget === 0 ? '' : state.slipTarget,
  });
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const known = new Set(state.inputs.risks.map((risk) => risk.id));
  const numberParam = (key, min, max, fallback) => {
    if (!params.has(key)) return fallback;
    const value = Number(params.get(key));
    return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
  };
  if (params.has('off')) {
    state.disabled = new Set(
      params
        .get('off')
        .split(',')
        .filter((id) => known.has(id)),
    );
  }
  state.settings.consequenceScale = numberParam('scale', 0, 2, MODEL_DEFAULTS.consequenceScale);
  state.settings.correlation = numberParam('corr', 0, 0.8, MODEL_DEFAULTS.correlation);
  state.settings.delayCostShare = numberParam('delay', 0, 1, MODEL_DEFAULTS.delayCostShare);
  state.costTarget = numberParam('cost', 1000, 30000, state.inputs.budget / 1e6) * 1e6;
  state.slipTarget = numberParam('slip', 0, 60, 0);
}

/* ---------- Static skeleton ---------- */

function isDefaultRiskSet() {
  const defaults = MODEL_DEFAULTS.excludedRiskIds;
  return state.disabled.size === defaults.length && defaults.every((id) => state.disabled.has(id));
}

function renderSkeleton() {
  elements.main.innerHTML = `
    <div class="stack">
      <section class="grid grid--tiles grid--tiles-3" id="tiles" aria-label="Headline results" aria-live="polite"></section>

      <section class="panel scenario" aria-labelledby="scenarioTitle">
        <div class="panel__head">
          <h2 class="panel__title" id="scenarioTitle">Scenario</h2>
          <p class="panel__note"><span id="scenarioNote"></span> · <button class="text-action" type="button" data-action="open-risks" id="riskCount"></button></p>
        </div>
        <div class="scenario__controls">
          ${sliderHtml('consequenceScale', 'Risk consequence', 0, 2, 0.1)}
          ${sliderHtml('correlation', 'Correlation between elements', 0, 0.8, 0.05)}
          ${sliderHtml('delayCostShare', 'Cost of delay', 0, 1, 0.05)}
          <button class="pill-action" type="button" data-action="reset-scenario" id="resetScenario">Reset scenario</button>
        </div>
      </section>

      <section class="grid grid--split">
        <article class="panel" aria-labelledby="curveTitle">
          <div class="panel__head">
            <h2 class="panel__title" id="curveTitle">Cost confidence curve</h2>
            <p class="panel__note">Share of trials at or under each total cost</p>
          </div>
          <ul class="legend" style="margin-bottom:8px">
            <li><span class="legend__swatch legend__swatch--line" style="background:var(--series-1)"></span>Ranges plus risk events</li>
            <li><span class="legend__swatch legend__swatch--line" style="background:var(--series-2)"></span>Element ranges only</li>
          </ul>
          <div class="chart curve-chart" id="curveChart" role="img" aria-label="Cumulative probability of total program cost, with and without discrete risk events. The headline tiles carry the key values."></div>
        </article>
        <article class="panel" aria-labelledby="sourcesTitle">
          <div class="panel__head">
            <h2 class="panel__title" id="sourcesTitle">Where the growth comes from</h2>
            <p class="panel__note" id="sourcesNote"></p>
          </div>
          <ul class="legend" style="margin-bottom:10px">
            ${Object.values(SOURCE_KINDS)
              .map((kind) => `<li><span class="legend__swatch" style="background:${kind.color}"></span>${kind.label}</li>`)
              .join('')}
          </ul>
          <div class="bars bars--wide-names" id="sources"></div>
        </article>
      </section>

      <article class="panel" aria-labelledby="jointTitle">
        <div class="panel__head">
          <h2 class="panel__title" id="jointTitle">Cost and launch date together</h2>
          <p class="panel__note">Each dot is one simulated outcome</p>
        </div>
        <div class="joint">
          <div>
            <ul class="legend" style="margin-bottom:8px">
              <li><span class="legend__swatch" style="background:var(--series-1);border-radius:50%"></span>Meets both targets</li>
              <li><span class="legend__swatch" style="background:var(--series-muted);border-radius:50%"></span>Misses one or both</li>
            </ul>
            <div class="chart joint-chart" id="jointChart" role="img" aria-label="Scatter of simulated total cost against first launch date, with the cost and date targets drawn as lines."></div>
          </div>
          <div class="joint__side">
            <p class="joint__label">Joint confidence</p>
            <p class="joint__value" id="jointValue"></p>
            <p class="joint__sub" id="jointSub"></p>
            <label class="slider">
              <span class="slider__head"><span>Cost target</span><output id="costTargetValue"></output></span>
              <input type="range" id="costTarget" data-target="cost" />
            </label>
            <label class="slider">
              <span class="slider__head"><span>Date target</span><output id="slipTargetValue"></output></span>
              <input type="range" id="slipTarget" data-target="slip" min="0" max="36" step="1" />
            </label>
            <div class="joint__actions">
              <button class="pill-action pill-action--primary" type="button" data-action="targets-reference">Set targets for ${formatPercent(REFERENCE_CONFIDENCE)}</button>
              <button class="pill-action" type="button" data-action="targets-baseline">Back to baseline</button>
            </div>
          </div>
        </div>
      </article>

      <details class="panel fold" id="risksFold" ${isDefaultRiskSet() ? '' : 'open'}>
        <summary>
          <h2 class="fold__title" id="risksTitle">Risk events in the model</h2>
          <span class="fold__note" id="risksNote"></span>
        </summary>
        <div class="fold__body">
        <div class="fold__actions">
          <button class="text-action" type="button" data-action="risks-all">All on</button>
          <button class="text-action" type="button" data-action="risks-none">All off</button>
          <button class="text-action" type="button" data-action="risks-default">Default</button>
        </div>
        <div class="table-scroll">
          <table class="risk-table">
            <thead>
              <tr>
                <th scope="col">In model</th>
                <th scope="col">Risk</th>
                <th scope="col">Score</th>
                <th scope="col" class="num">Chance</th>
                <th scope="col" class="num">Cost if it occurs</th>
                <th scope="col" class="num">Launch slip if it occurs</th>
                <th scope="col" class="num">Expected cost</th>
              </tr>
            </thead>
            <tbody id="riskRows"></tbody>
          </table>
        </div>
        </div>
      </details>

      <details class="panel fold assumptions">
        <summary>
          <h2 class="fold__title">Model assumptions</h2>
          <span class="fold__note">Every mapping and constant behind the figures above</span>
        </summary>
        <div class="fold__body" id="assumptions"></div>
      </details>
    </div>`;
}

function sliderHtml(key, label, min, max, step) {
  return `
    <label class="slider">
      <span class="slider__head"><span>${escapeHtml(label)}</span><output id="${key}Value"></output></span>
      <input type="range" id="${key}" data-setting="${key}" min="${min}" max="${max}" step="${step}" />
    </label>`;
}

/* ---------- Result regions ---------- */

function renderHead() {
  const scope = getScope();
  elements.headActions.innerHTML = scope ? buildScopePillHtml(scope, { note: 'Program-level view' }) : '';
}

function renderTiles() {
  const { result, rangesOnly, inputs } = state;
  const budgetConfidence = confidenceAt(result.sortedTotals, inputs.budget);
  const rangesConfidence = confidenceAt(rangesOnly.sortedTotals, inputs.budget);
  const referenceCost = percentile(result.sortedTotals, REFERENCE_CONFIDENCE);
  const medianSlip = percentile(result.sortedSlips, 0.5);
  const gap = referenceCost - inputs.budget;

  const tiles = [
    {
      label: `Confidence in ${formatUsdCompact(inputs.budget)}`,
      value: percentLabel(budgetConfidence),
      sub: `of trials come in at or under the estimate · ${percentLabel(rangesConfidence).toLowerCase()} on element ranges alone`,
    },
    {
      label: `Cost at ${formatPercent(REFERENCE_CONFIDENCE)} confidence`,
      value: usdB(referenceCost),
      sub: `${gap >= 0 ? `${usdB(gap)} over` : `${usdB(-gap)} under`} the estimate · NASA baselines at ${formatPercent(REFERENCE_CONFIDENCE)}`,
    },
    {
      label: 'Median launch slip',
      value: monthsLabel(medianSlip),
      sub: `${escapeHtml(inputs.launchMilestone.name)}: ${formatMonthYear(launchDate(0))} to ${formatMonthYear(launchDate(medianSlip))}`,
    },
  ];

  document.getElementById('tiles').innerHTML = tiles
    .map(
      (tile) => `
      <div class="tile tile--static">
        <span class="tile__label">${escapeHtml(tile.label)}</span>
        <span class="tile__value">${escapeHtml(tile.value)}</span>
        <span class="tile__sub">${tile.sub}</span>
      </div>`,
    )
    .join('');
}

function renderScenarioControls() {
  const { settings, inputs } = state;
  const labels = {
    consequenceScale: `${Math.round(settings.consequenceScale * 100)}% of register scale`,
    correlation: settings.correlation.toFixed(2),
    delayCostShare: `${formatUsdCompact(inputs.monthlyBurn * settings.delayCostShare)} per month`,
  };
  Object.entries(labels).forEach(([key, label]) => {
    const input = document.getElementById(key);
    if (document.activeElement !== input) input.value = String(settings[key]);
    document.getElementById(`${key}Value`).textContent = label;
  });
  const active = inputs.risks.length - state.disabled.size;
  const riskCount = `${active} of ${inputs.risks.length} risk events on`;
  document.getElementById('scenarioNote').textContent = `${state.result.iterations.toLocaleString('en-US')} trials`;
  document.getElementById('riskCount').textContent = riskCount;
  document.getElementById('risksNote').textContent = riskCount;
  document.getElementById('resetScenario').disabled = isDefaultScenario();
}

function drawCurve(width) {
  const host = document.getElementById('curveChart');
  if (!host || !width) return;
  const { result, rangesOnly, inputs } = state;
  const height = 380;
  const margin = { left: 44, right: 18, top: 26, bottom: 34 };

  const low = Math.min(rangesOnly.sortedTotals[0], result.sortedTotals[0], inputs.budget);
  const high = Math.max(percentile(result.sortedTotals, 0.999), percentile(rangesOnly.sortedTotals, 0.999), inputs.budget);
  const step = high - low > 4e9 ? 1e9 : 0.5e9;
  const domainLow = Math.floor(low / step) * step;
  const domainHigh = Math.ceil(high / step) * step;
  const x = linearScale([domainLow, domainHigh], [margin.left, width - margin.right]);
  const y = linearScale([0, 1], [height - margin.bottom, margin.top]);

  const parts = [];
  [0, 0.25, 0.5, 0.75, 1].forEach((tick) => {
    parts.push(`<line class="${tick === 0 ? 'axis-line' : 'grid-line'}" x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}"/>`);
    parts.push(`<text class="tick-label" x="${margin.left - 8}" y="${y(tick) + 4}" text-anchor="end">${Math.round(tick * 100)}%</text>`);
  });
  for (let tick = domainLow; tick <= domainHigh + 1; tick += step) {
    parts.push(`<text class="tick-label" x="${x(tick)}" y="${height - margin.bottom + 18}" text-anchor="middle">${formatUsdCompact(tick)}</text>`);
  }

  // Reference confidence level.
  parts.push(`<line class="reference-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(REFERENCE_CONFIDENCE)}" y2="${y(REFERENCE_CONFIDENCE)}"/>`);
  parts.push(`<text class="reference-label" x="${margin.left + 6}" y="${y(REFERENCE_CONFIDENCE) - 6}">${formatPercent(REFERENCE_CONFIDENCE)} reference</text>`);

  const curvePath = (sorted) => {
    const points = [];
    for (let index = 0; index <= CURVE_STEPS; index += 1) {
      const q = index / CURVE_STEPS;
      points.push(`${index ? 'L' : 'M'}${x(percentile(sorted, q)).toFixed(1)},${y(q).toFixed(1)}`);
    }
    return points.join(' ');
  };
  const mainPath = curvePath(result.sortedTotals);
  parts.push(`<path class="curve-area" d="${mainPath} L${x(result.sortedTotals.at(-1)).toFixed(1)},${y(0)} L${x(result.sortedTotals[0]).toFixed(1)},${y(0)} Z"/>`);
  parts.push(`<path class="curve curve--secondary" d="${curvePath(rangesOnly.sortedTotals)}"/>`);
  parts.push(`<path class="curve" d="${mainPath}"/>`);

  // The current estimate.
  const budgetX = x(inputs.budget);
  const budgetConfidence = confidenceAt(result.sortedTotals, inputs.budget);
  parts.push(`<line class="marker-line" x1="${budgetX}" x2="${budgetX}" y1="${y(0)}" y2="${margin.top - 4}"/>`);
  parts.push(`<text class="marker-label" x="${budgetX}" y="${margin.top - 9}" text-anchor="middle">Estimate ${formatUsdCompact(inputs.budget)}</text>`);
  parts.push(`<circle class="marker-dot" cx="${budgetX}" cy="${y(budgetConfidence)}" r="4.5"/>`);

  // P50 / P70 / P80 on the main curve.
  [0.5, REFERENCE_CONFIDENCE, 0.8].forEach((q) => {
    const value = percentile(result.sortedTotals, q);
    const px = x(value);
    const fitsRight = px + 92 < width - margin.right;
    parts.push(`<circle class="curve-dot" cx="${px}" cy="${y(q)}" r="4.5"/>`);
    parts.push(
      `<text class="value-label" x="${fitsRight ? px + 9 : px - 9}" y="${y(q) + (fitsRight ? 15 : -8)}" text-anchor="${fitsRight ? 'start' : 'end'}">P${Math.round(q * 100)} ${usdB(value)}</text>`,
    );
  });

  parts.push(`<line class="crosshair" id="curveCrosshair" x1="0" x2="0" y1="${margin.top}" y2="${y(0)}" visibility="hidden"/>`);
  parts.push(`<rect class="hover-surface" x="${margin.left}" y="${margin.top}" width="${width - margin.left - margin.right}" height="${height - margin.top - margin.bottom}"/>`);
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg>`;

  const surface = host.querySelector('.hover-surface');
  const crosshair = host.querySelector('#curveCrosshair');
  surface.addEventListener('pointermove', (event) => {
    const box = host.querySelector('svg').getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const value = x.invert(px);
    crosshair.setAttribute('x1', px);
    crosshair.setAttribute('x2', px);
    crosshair.setAttribute('visibility', 'visible');
    showTooltip(
      `<p class="viz-tooltip__title">${usdB(value)} or less</p>
       <p class="viz-tooltip__row"><span class="viz-tooltip__key"><span class="legend__swatch legend__swatch--line" style="background:var(--series-1)"></span>Ranges plus risk events</span><strong>${percentLabel(
         confidenceAt(result.sortedTotals, value),
       )}</strong></p>
       <p class="viz-tooltip__row"><span class="viz-tooltip__key"><span class="legend__swatch legend__swatch--line" style="background:var(--series-2)"></span>Element ranges only</span><strong>${percentLabel(
         confidenceAt(rangesOnly.sortedTotals, value),
       )}</strong></p>`,
      event.clientX,
      event.clientY,
    );
  });
  surface.addEventListener('pointerleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    hideTooltip();
  });
}

function renderSources() {
  const { result } = state;
  const growth = result.mean - result.pointEstimate;
  const top = result.sources.slice(0, TOP_SOURCES);
  const rest = result.sources.slice(TOP_SOURCES);
  const restTotal = rest.reduce((sum, source) => sum + source.meanUsd, 0);
  const max = Math.max(...top.map((source) => source.meanUsd), restTotal, 1);

  document.getElementById('sourcesNote').textContent = `${usdB(growth)} mean growth over the ${usdB(result.pointEstimate)} point estimate`;
  const row = (id, label, value, color) => `
    <div class="bar-row bar-row--static">
      <span class="bar-row__name">${id ? `<span class="bar-row__id">${escapeHtml(id)}</span>` : ''}<span>${escapeHtml(label)}</span></span>
      <span class="bar-row__track" aria-hidden="true"><span class="bar-row__fill" style="width:${Math.max((value / max) * 100, 0.6).toFixed(2)}%;--bar-color:${color}"></span></span>
      <span class="bar-row__value">${formatUsdCompact(value)}</span>
    </div>`;

  document.getElementById('sources').innerHTML =
    top.map((source) => row(source.kind === 'delay' ? '' : source.id, source.label, source.meanUsd, SOURCE_KINDS[source.kind].color)).join('') +
    (rest.length ? row('', `${rest.length} smaller sources`, restTotal, 'var(--series-muted)') : '');
}

function scatterGeometry(width) {
  const { result, inputs } = state;
  const height = 380;
  const margin = { left: 52, right: 20, top: 22, bottom: 36 };
  const slipHigh = Math.max(percentile(result.sortedSlips, 0.998), state.slipTarget, 6);
  const slipMax = Math.ceil((slipHigh + 0.5) / 6) * 6;
  const costLow = Math.min(result.sortedTotals[0], state.costTarget, inputs.budget);
  const costHigh = Math.max(percentile(result.sortedTotals, 0.998), state.costTarget);
  const step = costHigh - costLow > 4e9 ? 1e9 : 0.5e9;
  const domainLow = Math.floor(costLow / step) * step;
  const domainHigh = Math.ceil(costHigh / step) * step;
  return {
    height,
    margin,
    slipMax,
    step,
    domainLow,
    domainHigh,
    x: linearScale([0, slipMax], [margin.left, width - margin.right]),
    y: linearScale([domainLow, domainHigh], [height - margin.bottom, margin.top]),
  };
}

function drawJoint(width) {
  const host = document.getElementById('jointChart');
  if (!host || !width) return;
  const { result } = state;
  const geometry = scatterGeometry(width);
  const { height, margin, slipMax, step, domainLow, domainHigh, x, y } = geometry;
  const parts = [];

  for (let tick = domainLow; tick <= domainHigh + 1; tick += step) {
    parts.push(`<line class="${tick === domainLow ? 'axis-line' : 'grid-line'}" x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}"/>`);
    parts.push(`<text class="tick-label" x="${margin.left - 8}" y="${y(tick) + 4}" text-anchor="end">${formatUsdCompact(tick)}</text>`);
  }
  const monthStep = slipMax > 36 ? 12 : 6;
  for (let month = 0; month <= slipMax; month += monthStep) {
    parts.push(`<text class="tick-label" x="${x(month)}" y="${height - margin.bottom + 18}" text-anchor="${month === 0 ? 'start' : month + monthStep > slipMax ? 'end' : 'middle'}">${formatMonthYear(launchDate(month))}</text>`);
  }

  // Zone that meets both targets.
  const targetX = x(Math.min(state.slipTarget, slipMax));
  const targetY = y(Math.min(Math.max(state.costTarget, domainLow), domainHigh));
  parts.push(`<rect class="target-zone" x="${margin.left}" y="${targetY}" width="${Math.max(targetX - margin.left, 0)}" height="${Math.max(y(domainLow) - targetY, 0)}"/>`);

  const stride = Math.max(1, Math.floor(result.iterations / SCATTER_POINTS));
  const met = [];
  const missed = [];
  for (let index = 0; index < result.iterations; index += stride) {
    const slip = result.slips[index];
    const cost = result.totals[index];
    if (slip > slipMax || cost > domainHigh || cost < domainLow) continue;
    const dot = `<circle cx="${x(slip).toFixed(1)}" cy="${y(cost).toFixed(1)}" r="2.2"/>`;
    if (cost <= state.costTarget && slip <= state.slipTarget) met.push(dot);
    else missed.push(dot);
  }
  parts.push(`<g class="dots dots--missed">${missed.join('')}</g>`);
  parts.push(`<g class="dots dots--met">${met.join('')}</g>`);

  parts.push(`<line class="marker-line" x1="${margin.left}" x2="${width - margin.right}" y1="${targetY}" y2="${targetY}"/>`);
  parts.push(`<line class="marker-line" x1="${targetX}" x2="${targetX}" y1="${margin.top - 4}" y2="${y(domainLow)}"/>`);
  parts.push(`<text class="marker-label" x="${width - margin.right}" y="${targetY - 7}" text-anchor="end">Cost target ${usdB(state.costTarget)}</text>`);
  const dateAnchor = targetX < margin.left + 90 ? 'start' : targetX > width - margin.right - 90 ? 'end' : 'middle';
  parts.push(`<text class="marker-label" x="${targetX}" y="${margin.top - 9}" text-anchor="${dateAnchor}">Date target ${formatMonthYear(launchDate(state.slipTarget))}</text>`);

  parts.push(`<rect class="hover-surface hover-surface--pick" x="${margin.left}" y="${margin.top}" width="${width - margin.left - margin.right}" height="${height - margin.top - margin.bottom}"/>`);
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg>`;

  const surface = host.querySelector('.hover-surface');
  const locate = (event) => {
    const box = host.querySelector('svg').getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const py = ((event.clientY - box.top) / box.height) * height;
    return { slip: Math.max(0, Math.round(x.invert(px))), cost: Math.round(y.invert(py) / 5e7) * 5e7 };
  };
  surface.addEventListener('pointermove', (event) => {
    const { slip, cost } = locate(event);
    showTooltip(
      `<p class="viz-tooltip__title">${usdB(cost)} by ${formatMonthYear(launchDate(slip))}</p>
       <p class="viz-tooltip__row"><span>Joint confidence</span><strong>${percentLabel(jointConfidence(result, cost, slip))}</strong></p>
       <p class="viz-tooltip__note">Sets both targets to this point</p>`,
      event.clientX,
      event.clientY,
    );
  });
  surface.addEventListener('pointerleave', hideTooltip);
  surface.addEventListener('click', (event) => {
    const { slip, cost } = locate(event);
    setTargets(cost, slip);
  });
}

function renderJointSide() {
  const { result, inputs } = state;
  const joint = jointConfidence(result, state.costTarget, state.slipTarget);
  const costOnly = confidenceAt(result.sortedTotals, state.costTarget);
  const dateOnly = confidenceAt(result.sortedSlips, state.slipTarget);
  document.getElementById('jointValue').textContent = percentLabel(joint);
  document.getElementById('jointSub').textContent = `Cost alone ${percentLabel(costOnly).toLowerCase()} · date alone ${percentLabel(dateOnly).toLowerCase()}`;

  const costInput = document.getElementById('costTarget');
  const minCost = Math.floor(Math.min(result.sortedTotals[0], inputs.pointEstimate) / 5e7) * 5e7;
  const maxCost = Math.ceil(Math.max(percentile(result.sortedTotals, 0.999), state.costTarget) / 5e7) * 5e7;
  costInput.min = String(minCost);
  costInput.max = String(maxCost);
  costInput.step = '50000000';
  if (document.activeElement !== costInput) costInput.value = String(state.costTarget);
  document.getElementById('costTargetValue').textContent = usdB(state.costTarget);

  const slipInput = document.getElementById('slipTarget');
  slipInput.max = String(Math.max(36, Math.ceil(state.slipTarget)));
  if (document.activeElement !== slipInput) slipInput.value = String(state.slipTarget);
  document.getElementById('slipTargetValue').textContent =
    state.slipTarget === 0
      ? `${formatMonthYear(launchDate(0))} (baseline)`
      : `${formatMonthYear(launchDate(state.slipTarget))} (+${monthsLabel(state.slipTarget)})`;
}

function renderRiskRows() {
  const { inputs, result } = state;
  const focusedId = document.activeElement?.id || '';
  const rows = [...inputs.risks].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const scale = state.settings.consequenceScale;

  document.getElementById('riskRows').innerHTML = rows
    .map((risk) => {
      const enabled = !state.disabled.has(risk.id);
      const stats = result.riskStats.get(risk.id);
      const href = buildSuiteHref('risk', { from: 'confidence', risk: risk.id }, { currentRoute: 'confidence' });
      return `
      <tr class="${enabled ? '' : 'is-off'}">
        <td>
          <label class="switch">
            <input type="checkbox" id="toggle-${escapeHtml(risk.id)}" data-risk="${escapeHtml(risk.id)}" ${enabled ? 'checked' : ''} />
            <span class="sr-only">Include ${escapeHtml(risk.id)} in the model</span>
          </label>
        </td>
        <th scope="row">
          <a class="risk-link" href="${escapeHtml(href)}"><span class="mono">${escapeHtml(risk.id)}</span> ${escapeHtml(risk.title)}</a>
          <span class="risk-meta">${escapeHtml(risk.category)} · touches WBS ${escapeHtml(risk.affected.join(', '))}${
            MODEL_DEFAULTS.excludedRiskIds.includes(risk.id) ? ' · off by default: not a cost-growth event' : ''
          }</span>
        </th>
        <td>${bandChipHtml(risk.priority)}</td>
        <td class="num">${formatPercent(risk.probability, 1).replace('.0%', '%')}</td>
        <td class="num">${formatUsdCompact(risk.costMode * scale)}</td>
        <td class="num">${risk.onLaunchPath ? `${+(risk.slipMode * scale).toFixed(1)} mo` : '<span class="muted">Not on launch path</span>'}</td>
        <td class="num">${enabled && stats ? formatUsdCompact(stats.meanCostUsd) : '<span class="muted">Off</span>'}</td>
      </tr>`;
    })
    .join('');

  if (focusedId.startsWith('toggle-')) document.getElementById(focusedId)?.focus();
}

function renderAssumptions() {
  const { inputs } = state;
  const d = MODEL_DEFAULTS;
  const mapRow = (map, format) =>
    Object.entries(map)
      .map(([score, value]) => `<td class="num">${format(value)}</td>`)
      .join('');
  document.getElementById('assumptions').innerHTML = `
    <p>Each trial draws a cost for every level-1 WBS element, decides which register risks occur, adds their cost and launch-slip consequences, and prices the delay. ${d.iterations.toLocaleString('en-US')} trials, fixed seed ${d.seed}, so a scenario always returns the same numbers.</p>
    <h3>Read from the suite data</h3>
    <ul>
      <li>Element costs: triangular between the low, base, and high values in the cost estimate (${inputs.elements.length} level-1 elements, ${usdB(inputs.pointEstimate)} point estimate, ${usdB(inputs.budget)} with the ${formatUsdCompact(inputs.reserve)} reserve).</li>
      <li>Risk events: likelihood and impact scores and WBS links from the risk register (${inputs.risks.length} risks).</li>
      <li>Launch date: ${escapeHtml(inputs.launchMilestone.id)} ${escapeHtml(inputs.launchMilestone.name)}, ${formatMonthYear(launchDate(0))}.</li>
      <li>Monthly burn: average direct spend across ${escapeHtml(inputs.burnYears.join(', '))}, ${formatUsdCompact(inputs.monthlyBurn)} per month.</li>
    </ul>
    <h3>Assumed, not sourced</h3>
    <table class="assumption-table">
      <thead><tr><th scope="col">Register score</th><th class="num">1</th><th class="num">2</th><th class="num">3</th><th class="num">4</th><th class="num">5</th></tr></thead>
      <tbody>
        <tr><th scope="row">Likelihood to chance of occurring</th>${mapRow(d.likelihoodToProbability, (value) => formatPercent(value, 1).replace('.0%', '%'))}</tr>
        <tr><th scope="row">Impact to cost, share of touched elements</th>${mapRow(d.impactToCostShare, (value) => formatPercent(value, 1).replace('.0%', '%'))}</tr>
        <tr><th scope="row">Impact to launch slip, months</th>${mapRow(d.impactToSlipMonths, (value) => String(value))}</tr>
      </tbody>
    </table>
    <ul>
      <li>A consequence that occurs lands between ${d.consequenceSpread[0]}x and ${d.consequenceSpread[1]}x its most likely value.</li>
      <li>Only risks homed in WBS ${d.launchPathWbs.join(', ')} can slip the launch. ${escapeHtml(d.postLaunchCategories.join(', '))} risks add cost but no slip.</li>
      <li>Concurrent slips overlap: total slip is the largest single slip plus ${formatPercent(d.slipOverlapShare)} of the rest.</li>
      <li>Element outcomes share a common factor (correlation ${d.correlation} by default).</li>
      <li>Each month of slip costs ${formatPercent(d.delayCostShare)} of the monthly burn by default.</li>
      <li>${escapeHtml(d.excludedRiskIds.join(', '))} (program cancellation or restructuring) starts switched off: it is not a cost-growth event.</li>
    </ul>
    <h3>Limits</h3>
    <ul>
      <li>${formatPercent(REFERENCE_CONFIDENCE)} is the reference level because NASA policy (NPR 7120.5) baselines and budgets programs at a 70 percent joint confidence level, or the level approved by the decision authority.</li>
      <li>Element ranges are treated as estimating uncertainty and risk events are added on top. If the ranges already price those risks in, the combined curve double counts; the "element ranges only" curve is the lower bound.</li>
      <li>The schedule side tracks one milestone. It is not a resource-loaded schedule network, so it is not a formal NASA JCL.</li>
    </ul>`;
}

/* ---------- Orchestration ---------- */

function renderResults() {
  hideTooltip();
  renderHead();
  renderTiles();
  renderScenarioControls();
  renderSources();
  renderJointSide();
  renderRiskRows();
  drawCurve(document.getElementById('curveChart').clientWidth);
  drawJoint(document.getElementById('jointChart').clientWidth);
  syncUrlState();
  syncSuiteNavigation();
}

function rerun() {
  recompute();
  renderResults();
}

function setTargets(cost, slip) {
  state.costTarget = cost;
  state.slipTarget = Math.max(0, slip);
  hideTooltip();
  renderTiles();
  renderJointSide();
  drawJoint(document.getElementById('jointChart').clientWidth);
  syncUrlState();
}

function setRisks(disabledIds) {
  state.disabled = new Set(disabledIds);
  rerun();
}

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.setting) {
    state.settings[target.dataset.setting] = Number(target.value);
    rerun();
  } else if (target.dataset.target === 'cost') {
    setTargets(Number(target.value), state.slipTarget);
  } else if (target.dataset.target === 'slip') {
    setTargets(state.costTarget, Number(target.value));
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.dataset.risk) return;
  if (target.checked) state.disabled.delete(target.dataset.risk);
  else state.disabled.add(target.dataset.risk);
  rerun();
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.getAttribute('data-action');
  if (action === 'reset-scenario') {
    state.settings = {
      consequenceScale: MODEL_DEFAULTS.consequenceScale,
      correlation: MODEL_DEFAULTS.correlation,
      delayCostShare: MODEL_DEFAULTS.delayCostShare,
    };
    setRisks(MODEL_DEFAULTS.excludedRiskIds);
  } else if (action === 'open-risks') {
    const fold = document.getElementById('risksFold');
    fold.open = true;
    fold.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (action === 'risks-all') {
    setRisks([]);
  } else if (action === 'risks-none') {
    setRisks(state.inputs.risks.map((risk) => risk.id));
  } else if (action === 'risks-default') {
    setRisks(MODEL_DEFAULTS.excludedRiskIds);
  } else if (action === 'targets-reference') {
    const targets = targetsForJointConfidence(state.result, REFERENCE_CONFIDENCE);
    setTargets(Math.ceil(targets.costTarget / 5e7) * 5e7, Math.ceil(targets.slipTarget));
  } else if (action === 'targets-baseline') {
    setTargets(state.inputs.budget, 0);
  } else if (action === 'clear-scope') {
    state.sharedContext = { ...state.sharedContext, wbs: '' };
    mergeQueryState({ wbs: '' });
    renderHead();
    syncSuiteNavigation();
  }
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
    state.crosswalk = crosswalk;
    state.sharedContext = readSharedContext();
    state.inputs = buildModelInputs({ cost, risks, schedule, crosswalk });
    state.costTarget = state.inputs.budget;
    readUrlState();
    renderSkeleton();
    renderAssumptions();
    recompute();
    renderResults();
    observers.push(observeWidth(document.getElementById('curveChart'), drawCurve));
    observers.push(observeWidth(document.getElementById('jointChart'), drawJoint));
  } catch (error) {
    console.error('Failed to load confidence model', error);
    elements.main.innerHTML = `<p class="state-message">Could not load model inputs. ${escapeHtml(error instanceof Error ? error.message : '')}</p>`;
    syncSuiteNavigation();
  }
}

init();
