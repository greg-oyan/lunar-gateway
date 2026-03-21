const DATA_URL = './data/gateway-cost.json';

const appTitle = document.getElementById('appTitle');
const appSubtitle = document.getElementById('appSubtitle');
const generatedAt = document.getElementById('generatedAt');
const storySignals = document.getElementById('storySignals');
const overviewContent = document.getElementById('overviewContent');
const yearHint = document.getElementById('yearlyHint');
const yearStory = document.getElementById('yearStory');
const yearChart = document.getElementById('yearChart');
const breakdownSummary = document.getElementById('breakdownSummary');
const breakdownCards = document.getElementById('breakdownCards');
const inspectorContent = document.getElementById('inspectorContent');
const methodologySummary = document.getElementById('methodologySummary');
const methodologyCards = document.getElementById('methodologyCards');
const traceabilitySummary = document.getElementById('traceabilitySummary');
const artifactList = document.getElementById('artifactList');
const sourceList = document.getElementById('sourceList');
const storyTab = document.getElementById('storyTab');
const evidenceTab = document.getElementById('evidenceTab');
const sourceTab = document.getElementById('sourceTab');

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const state = {
  data: null,
  categoriesById: new Map(),
  yearsById: new Map(),
  selection: null,
  inspectorTab: 'story',
};

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

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function pluralize(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function tagClass(tone) {
  switch (tone) {
    case 'copper':
      return 'tag tag--copper';
    case 'forest':
      return 'tag tag--forest';
    case 'plum':
      return 'tag tag--plum';
    case 'danger':
      return 'tag tag--danger';
    default:
      return 'tag tag--brand';
  }
}

function buildMaps(data) {
  state.categoriesById = new Map(data.categories.map((category) => [category.id, category]));
  state.yearsById = new Map(data.years.map((year) => [year.fy, year]));
}

function getSelectedCategory() {
  if (state.selection?.type !== 'category') return null;
  return state.categoriesById.get(state.selection.id) || null;
}

function getSelectedYear() {
  if (state.selection?.type !== 'year') return null;
  return state.yearsById.get(state.selection.id) || null;
}

function updateTabUi() {
  [storyTab, evidenceTab, sourceTab].forEach((tab) => {
    const isActive = tab.dataset.tab === state.inspectorTab;
    tab.classList.toggle('inspector-tab--active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
}

function buildSignalPills() {
  storySignals.innerHTML = state.data.overview.signals
    .map(
      (signal) => `
        <div class="signal-pill">
          <span class="signal-pill__label">${escapeHtml(signal.label)}</span>
          <span class="signal-pill__value">${escapeHtml(signal.value)}</span>
        </div>
      `,
    )
    .join('');
}

function renderOverview() {
  const { overview } = state.data;
  const majorDrivers = overview.majorDrivers
    .map(
      (driver) => `
        <button class="driver-card" type="button" data-select-type="category" data-select-id="${escapeHtml(driver.id)}">
          <span class="driver-card__rank">${driver.rank}</span>
          <h3>${escapeHtml(driver.name)}</h3>
          <span class="driver-card__value">${escapeHtml(formatCurrency(driver.totalUsd))}</span>
          <span class="driver-card__meta">${escapeHtml(driver.scopeLabel)} | ${escapeHtml(driver.basisLabel)}</span>
          <span class="driver-card__meta">${escapeHtml(formatPercent(driver.shareOfProgram))} of the program estimate</span>
        </button>
      `,
    )
    .join('');

  overviewContent.innerHTML = `
    <div class="overview-hero">
      <section class="total-card">
        <p class="total-card__label">Program-reference current cost</p>
        <h3 class="total-card__value mono">${escapeHtml(formatCurrency(overview.totalCostUsd))}</h3>
        <p class="total-card__range">
          Range: <span class="mono">${escapeHtml(formatCurrency(overview.lowCostUsd))}</span> to
          <span class="mono">${escapeHtml(formatCurrency(overview.highCostUsd))}</span><br />
          Estimate span: <span class="mono">${escapeHtml(`FY${overview.startFy}-FY${overview.endFy}`)}</span>
        </p>

        <div class="metric-cluster">
          <div class="story-metric">
            <span class="story-metric__label">Busiest year</span>
            <span class="story-metric__value">${escapeHtml(overview.busiestYear?.fy || 'N/A')}</span>
          </div>
          <div class="story-metric">
            <span class="story-metric__label">Busiest year cost</span>
            <span class="story-metric__value mono">${escapeHtml(formatCurrency(overview.busiestYear?.totalUsd || 0))}</span>
          </div>
        </div>
      </section>

      <div class="story-grid">
        <section class="story-card">
          <h3>What is included</h3>
          <p>${escapeHtml(overview.includedSummary)}</p>
        </section>

        <section class="story-card">
          <h3>What is judgment-based</h3>
          <p>${escapeHtml(overview.judgmentSummary)}</p>
        </section>

        <section class="story-card">
          <h3>What is directly anchored</h3>
          <p>${escapeHtml(overview.directSummary)}</p>
        </section>
      </div>
    </div>

    <div class="driver-strip">
      ${majorDrivers}
    </div>
  `;
}

function renderYearChart() {
  const activeYear = getSelectedYear() || state.yearsById.get(state.data.defaultSelection.defaultYear) || state.data.years[0];
  if (activeYear) {
    yearHint.textContent = `${state.data.years.length} fiscal years in view. Selected: ${activeYear.fy}.`;
    yearStory.innerHTML = `<p>${escapeHtml(activeYear.narrative)}</p>`;
  }

  yearChart.innerHTML = state.data.years
    .map((year) => {
      const stackHeight = state.data.maxYearTotalUsd ? Math.max(12, (year.totalUsd / state.data.maxYearTotalUsd) * 100) : 0;
      const laborShare = year.totalUsd ? (year.laborUsd / year.totalUsd) * 100 : 0;
      const materialShare = year.totalUsd ? (year.materialUsd / year.totalUsd) * 100 : 0;
      const integrationShare = year.totalUsd ? (year.integrationUsd / year.totalUsd) * 100 : 0;
      const reserveShare = year.totalUsd ? (year.reserveUsd / year.totalUsd) * 100 : 0;
      const isActive = activeYear?.fy === year.fy;

      return `
        <button
          class="year-card${isActive ? ' year-card--active' : ''}"
          type="button"
          data-select-type="year"
          data-select-id="${escapeHtml(year.fy)}"
          role="listitem"
        >
          <div class="year-card__bar">
            <div class="year-card__stack" style="height:${stackHeight}%;">
              ${reserveShare ? `<div class="year-card__segment year-card__segment--reserve" style="height:${reserveShare}%;"></div>` : ''}
              ${integrationShare ? `<div class="year-card__segment year-card__segment--integration" style="height:${integrationShare}%;"></div>` : ''}
              ${materialShare ? `<div class="year-card__segment year-card__segment--material" style="height:${materialShare}%;"></div>` : ''}
              ${laborShare ? `<div class="year-card__segment year-card__segment--labor" style="height:${laborShare}%;"></div>` : ''}
            </div>
          </div>
          <span class="year-card__fy">${escapeHtml(year.fy)}</span>
          <span class="year-card__value">${escapeHtml(formatCurrency(year.totalUsd))}</span>
        </button>
      `;
    })
    .join('');
}

function renderBreakdown() {
  const selectedCategory = getSelectedCategory() || state.categoriesById.get(state.data.defaultSelection.id);
  if (selectedCategory) {
    breakdownSummary.innerHTML = `<p>${escapeHtml(selectedCategory.meaning)} ${escapeHtml(selectedCategory.includedNote)}</p>`;
  }

  breakdownCards.innerHTML = state.data.topCategoryIds
    .map((categoryId) => state.categoriesById.get(categoryId))
    .filter(Boolean)
    .map((category) => {
      const isActive = selectedCategory?.id === category.id;
      const fillWidth = Math.max(4, category.shareOfProgram * 100);
      return `
        <button
          class="breakdown-card${isActive ? ' breakdown-card--active' : ''}"
          type="button"
          data-select-type="category"
          data-select-id="${escapeHtml(category.id)}"
          role="listitem"
        >
          <div class="breakdown-card__topline">
            <div>
              <p class="breakdown-card__meta mono">${escapeHtml(category.id)}</p>
              <h3 class="breakdown-card__title">${escapeHtml(category.name)}</h3>
            </div>
            <span class="breakdown-card__value mono">${escapeHtml(formatCurrency(category.baseUsd))}</span>
          </div>

          <p class="breakdown-card__copy">${escapeHtml(category.meaning)}</p>

          <div class="breakdown-card__bar">
            <div class="breakdown-card__fill" style="width:${fillWidth}%;"></div>
          </div>

          <div class="breakdown-card__tags">
            <span class="tag tag--brand">${escapeHtml(formatPercent(category.shareOfProgram))} of total</span>
            <span class="tag tag--copper">${escapeHtml(category.scopeLabel)}</span>
            <span class="tag tag--forest">${escapeHtml(category.basisLabel)}</span>
          </div>
        </button>
      `;
    })
    .join('');
}

function renderMethodology() {
  methodologySummary.innerHTML = `<p>${escapeHtml(state.data.methodology.summary)}</p>`;

  methodologyCards.innerHTML = state.data.methodology.cards
    .map(
      (card) => `
        <article class="method-card">
          <p class="method-card__eyebrow">${escapeHtml(card.eyebrow)}</p>
          <h3>${escapeHtml(card.title)}</h3>
          <p>${escapeHtml(card.summary)}</p>
          <ul>
            ${card.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
          <a class="detail-link" href="${escapeHtml(card.sourceArtifact)}" target="_blank" rel="noreferrer">
            Open source artifact
          </a>
        </article>
      `,
    )
    .join('');
}

function renderTraceability() {
  traceabilitySummary.innerHTML = `
    <div class="story-grid">
      ${state.data.traceability.evidenceGroups
        .map(
          (group) => `
            <section class="story-card">
              <h3>${escapeHtml(group.title)}</h3>
              <p>
                <span class="${tagClass(group.tone)}">${escapeHtml(`${group.value} ${group.label}`)}</span>
              </p>
              <p>${escapeHtml(group.note)}</p>
            </section>
          `,
        )
        .join('')}
    </div>
  `;

  artifactList.innerHTML = state.data.traceability.artifacts
    .map(
      (artifact) => `
        <article class="artifact-card">
          <div class="artifact-card__row">
            <div>
              <p class="artifact-card__meta">${escapeHtml(artifact.type)}</p>
              <h4>${escapeHtml(artifact.title)}</h4>
            </div>
          </div>
          <p>${escapeHtml(artifact.description)}</p>
          <div class="artifact-card__tags">
            ${artifact.tags.map((tag) => `<span class="tag tag--brand">${escapeHtml(tag)}</span>`).join('')}
          </div>
          <div class="artifact-card__actions">
            <a class="action-link" href="${escapeHtml(artifact.href)}" target="_blank" rel="noreferrer">Open file</a>
          </div>
        </article>
      `,
    )
    .join('');

  sourceList.innerHTML = state.data.traceability.sources
    .map(
      (source) => `
        <article class="source-card">
          <div class="source-card__row">
            <div>
              <p class="source-card__meta">${escapeHtml(source.id)} | ${escapeHtml(source.publisher)}</p>
              <h4>${escapeHtml(source.title)}</h4>
            </div>
          </div>
          <p>${escapeHtml(source.relevance)}</p>
          <div class="source-card__tags">
            <span class="tag tag--brand">${escapeHtml(source.authorityTier)}</span>
            <span class="tag tag--copper">${escapeHtml(source.sourceType)}</span>
            <span class="tag tag--forest">${escapeHtml(pluralize(source.linkedCount, 'linked category'))}</span>
          </div>
          <p>${escapeHtml(source.notes)}</p>
          <div class="source-card__actions">
            ${source.href ? `<a class="action-link" href="${escapeHtml(source.href)}" target="_blank" rel="noreferrer">Open source</a>` : ''}
          </div>
        </article>
      `,
    )
    .join('');
}

function renderInspectorStory() {
  const selectedCategory = getSelectedCategory();
  const selectedYear = getSelectedYear();

  if (selectedYear) {
    return `
      <div class="focus-shell">
        <section class="focus-headline">
          <span class="detail-code">${escapeHtml(selectedYear.fy)}</span>
          <h4>${escapeHtml(selectedYear.fy)} cost at a glance</h4>
          <div class="focus-value mono">${escapeHtml(formatCurrency(selectedYear.totalUsd))}</div>
          <p>${escapeHtml(selectedYear.narrative)}</p>
          <div class="detail-tags">
            <span class="tag tag--brand">Labor ${escapeHtml(formatCurrency(selectedYear.laborUsd))}</span>
            <span class="tag tag--copper">Material ${escapeHtml(formatCurrency(selectedYear.materialUsd))}</span>
            <span class="tag tag--forest">Integration ${escapeHtml(formatCurrency(selectedYear.integrationUsd))}</span>
            ${selectedYear.reserveUsd ? `<span class="tag tag--plum">Reserve ${escapeHtml(formatCurrency(selectedYear.reserveUsd))}</span>` : ''}
          </div>
        </section>

        <section class="focus-block">
          <h4>Biggest drivers in this year</h4>
          <div class="detail-list">
            ${selectedYear.topBreakdown
              .slice(0, 5)
              .map(
                (entry) => `
                  <div class="detail-item">
                    <div class="detail-item__topline">
                      <span class="detail-item__title">${escapeHtml(entry.name)}</span>
                      <span class="detail-item__value">${escapeHtml(formatCurrency(entry.totalUsd))}</span>
                    </div>
                    <p class="detail-item__copy">${escapeHtml(entry.scopeLabel)}</p>
                  </div>
                `,
              )
              .join('')}
          </div>
        </section>
      </div>
    `;
  }

  if (!selectedCategory) return '';

  return `
    <div class="focus-shell">
      <section class="focus-headline">
        <span class="detail-code">${escapeHtml(selectedCategory.id)}</span>
        <h4>${escapeHtml(selectedCategory.name)}</h4>
        <div class="focus-value mono">${escapeHtml(formatCurrency(selectedCategory.baseUsd))}</div>
        <p>${escapeHtml(selectedCategory.meaning)}</p>
        <div class="detail-tags">
          <span class="tag tag--brand">${escapeHtml(selectedCategory.scopeLabel)}</span>
          <span class="tag tag--copper">${escapeHtml(selectedCategory.basisLabel)}</span>
          <span class="tag tag--forest">${escapeHtml(selectedCategory.timeframeLabel)}</span>
        </div>
      </section>

      <section class="focus-block">
        <h4>Why this bucket matters</h4>
        <p>${escapeHtml(selectedCategory.includedNote)}</p>
        <p>${escapeHtml(selectedCategory.judgmentNote)}</p>
      </section>

      <section class="focus-block">
        <h4>Largest sub-buckets</h4>
        <div class="detail-list">
          ${selectedCategory.children
            .slice(0, 5)
            .map(
              (child) => `
                <div class="detail-item">
                  <div class="detail-item__topline">
                    <span class="detail-item__title">${escapeHtml(child.name)}</span>
                    <span class="detail-item__value">${escapeHtml(formatCurrency(child.baseUsd))}</span>
                  </div>
                  <p class="detail-item__copy">${escapeHtml(child.scopeLabel)} | ${escapeHtml(child.basisLabel)}</p>
                </div>
              `,
            )
            .join('') || '<p>No lower-level breakout is available for this bucket.</p>'}
        </div>
      </section>

      <section class="focus-block">
        <h4>When this bucket peaks</h4>
        <p>
          ${selectedCategory.topYear
            ? `${escapeHtml(selectedCategory.topYear.fy)} at ${escapeHtml(formatCurrency(selectedCategory.topYear.totalUsd))}`
            : 'No direct annual phasing is published for this bucket.'}
        </p>
      </section>
    </div>
  `;
}

function renderInspectorEvidence() {
  const selectedCategory = getSelectedCategory();
  const selectedYear = getSelectedYear();

  if (selectedYear) {
    return `
      <div class="focus-shell">
        <section class="focus-block">
          <h4>Evidence in the selected year</h4>
          <p>The year view is built from the annual phasing file plus explicit reserve rows where reserve exists.</p>
          <div class="detail-list">
            <div class="detail-item">
              <div class="detail-item__topline">
                <span class="detail-item__title">Direct phasing total</span>
                <span class="detail-item__value">${escapeHtml(formatCurrency(selectedYear.directUsd))}</span>
              </div>
            </div>
            ${selectedYear.reserveUsd ? `
              <div class="detail-item">
                <div class="detail-item__topline">
                  <span class="detail-item__title">Explicit reserve in year</span>
                  <span class="detail-item__value">${escapeHtml(formatCurrency(selectedYear.reserveUsd))}</span>
                </div>
              </div>
            ` : ''}
          </div>
          <a class="detail-link" href="/cost/source/gateway_cost_phasing.csv" target="_blank" rel="noreferrer">Open annual phasing source</a>
        </section>
      </div>
    `;
  }

  if (!selectedCategory) return '';

  return `
    <div class="focus-shell">
      <section class="focus-block">
        <h4>Basis and traceability</h4>
        <p>${escapeHtml(selectedCategory.methodologyNote)}</p>
        <p>${escapeHtml(selectedCategory.traceabilityNote)}</p>
        <div class="detail-tags">
          <span class="tag tag--brand">${escapeHtml(selectedCategory.confidenceLevel)}</span>
          <span class="tag tag--copper">${escapeHtml(selectedCategory.basisLabel)}</span>
        </div>
      </section>

      <section class="focus-block">
        <h4>Representative detail lines</h4>
        <div class="detail-list">
          ${selectedCategory.representativeDetails
            .map(
              (detail) => `
                <div class="detail-item">
                  <div class="detail-item__topline">
                    <span class="detail-item__title">${escapeHtml(detail.name)}</span>
                    <span class="detail-item__value">${escapeHtml(formatCurrency(detail.amountUsd))}</span>
                  </div>
                  <p class="detail-item__copy">${escapeHtml(detail.fy)} | ${escapeHtml(detail.component)}</p>
                </div>
              `,
            )
            .join('') || '<p>No grouped detail rows are published for this bucket.</p>'}
        </div>
        <a class="detail-link" href="/cost/source/gateway_cost_estimate_detail.csv" target="_blank" rel="noreferrer">Open grouped detail source</a>
      </section>

      <section class="focus-block">
        <h4>Direct priced lines</h4>
        <div class="detail-list">
          ${selectedCategory.pricedLines
            .map(
              (line) => `
                <div class="detail-item">
                  <div class="detail-item__topline">
                    <span class="detail-item__title">${escapeHtml(line.description)}</span>
                    <span class="detail-item__value">${escapeHtml(formatCurrency(line.totalUsd))}</span>
                  </div>
                  <p class="detail-item__copy">${escapeHtml(line.contractType || 'Unspecified contract type')} | ${escapeHtml(line.optionYear)}</p>
                </div>
              `,
            )
            .join('') || '<p>No direct priced lines are linked to this bucket.</p>'}
        </div>
        <a class="detail-link" href="/cost/source/gateway_section_b_pricing.csv" target="_blank" rel="noreferrer">Open priced line source</a>
      </section>
    </div>
  `;
}

function renderInspectorSources() {
  const selectedCategory = getSelectedCategory();
  const selectedYear = getSelectedYear();

  if (selectedYear) {
    return `
      <div class="focus-shell">
        <section class="focus-block">
          <h4>Source path for the selected year</h4>
          <p>The year view is primarily driven by the annual phasing file, reserve detail, and the cost basis document that explains why phasing remains schedule-weighted in places.</p>
          <div class="artifact-card__actions">
            <a class="action-link" href="/cost/source/gateway_cost_phasing.csv" target="_blank" rel="noreferrer">Annual phasing</a>
            <a class="action-link" href="/cost/source/gateway_cost_estimate_detail.csv" target="_blank" rel="noreferrer">Reserve detail</a>
            <a class="action-link" href="/cost/source/gateway_cost_basis_of_estimate.rtf" target="_blank" rel="noreferrer">Method doc</a>
          </div>
        </section>
      </div>
    `;
  }

  if (!selectedCategory) return '';

  return `
    <div class="focus-shell">
      <section class="focus-block">
        <h4>Linked sources</h4>
        <div class="detail-list">
          ${selectedCategory.linkedSources
            .map(
              (source) => `
                <div class="detail-item">
                  <div class="detail-item__topline">
                    <span class="detail-item__title">${escapeHtml(source.title)}</span>
                    <span class="detail-item__value">${escapeHtml(source.id)}</span>
                  </div>
                  <p class="detail-item__copy">${escapeHtml(source.publisher)} | ${escapeHtml(source.authorityTier)}</p>
                  ${source.href ? `<a class="detail-link" href="${escapeHtml(source.href)}" target="_blank" rel="noreferrer">Open source</a>` : ''}
                </div>
              `,
            )
            .join('') || '<p>No linked sources are registered for this bucket.</p>'}
        </div>
      </section>

      <section class="focus-block">
        <h4>Authority artifacts that support this bucket</h4>
        <div class="artifact-card__actions">
          <a class="action-link" href="/cost/source/gateway_cost_estimate.csv" target="_blank" rel="noreferrer">Estimate rollup</a>
          <a class="action-link" href="/cost/source/gateway_source_reference_register.csv" target="_blank" rel="noreferrer">Source register</a>
          <a class="action-link" href="/cost/source/gateway_cost_basis_of_estimate.rtf" target="_blank" rel="noreferrer">Cost basis</a>
        </div>
      </section>
    </div>
  `;
}

function renderInspector() {
  let markup = '';
  if (state.inspectorTab === 'evidence') {
    markup = renderInspectorEvidence();
  } else if (state.inspectorTab === 'sources') {
    markup = renderInspectorSources();
  } else {
    markup = renderInspectorStory();
  }
  inspectorContent.innerHTML = markup;
}

function render() {
  appTitle.textContent = state.data.app.title;
  appSubtitle.textContent = state.data.app.subtitle;
  generatedAt.textContent = `Preprocessed ${dateTimeFormatter.format(new Date(state.data.generatedAt))}`;

  buildSignalPills();
  renderOverview();
  renderYearChart();
  renderBreakdown();
  renderMethodology();
  renderTraceability();
  renderInspector();
  updateTabUi();
}

function handleClick(event) {
  const selectionButton = event.target.closest('[data-select-type]');
  if (selectionButton) {
    state.selection = {
      type: selectionButton.dataset.selectType,
      id: selectionButton.dataset.selectId,
    };
    renderYearChart();
    renderBreakdown();
    renderInspector();
    return;
  }

  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) {
    state.inspectorTab = tabButton.dataset.tab;
    renderInspector();
    updateTabUi();
  }
}

async function loadData() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    state.data = await response.json();
    buildMaps(state.data);
    state.selection = {
      type: state.data.defaultSelection.type,
      id: state.data.defaultSelection.id,
    };
    render();
  } catch (error) {
    overviewContent.innerHTML = `
      <section class="loading-state">
        <h3>Unable to load Cost Explorer data</h3>
        <p>${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}</p>
      </section>
    `;
  }
}

document.addEventListener('click', handleClick);
loadData();
