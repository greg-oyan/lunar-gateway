const DATA_URL = './data/gateway-cost.json';

const appTitle = document.getElementById('appTitle');
const appSubtitle = document.getElementById('appSubtitle');
const generatedAt = document.getElementById('generatedAt');
const storySignals = document.getElementById('storySignals');
const overviewContent = document.getElementById('overviewContent');
const yearDisclosure = document.getElementById('yearDisclosure');
const yearlyHint = document.getElementById('yearlyHint');
const yearStory = document.getElementById('yearStory');
const yearChart = document.getElementById('yearChart');
const breakdownDisclosure = document.getElementById('breakdownDisclosure');
const breakdownPreview = document.getElementById('breakdownPreview');
const breakdownSummary = document.getElementById('breakdownSummary');
const breakdownCards = document.getElementById('breakdownCards');
const inspectorDisclosure = document.getElementById('inspectorDisclosure');
const inspectorPreview = document.getElementById('inspectorPreview');
const inspectorContent = document.getElementById('inspectorContent');
const methodologyDisclosure = document.getElementById('methodologyDisclosure');
const methodologyPreview = document.getElementById('methodologyPreview');
const methodologySummary = document.getElementById('methodologySummary');
const methodologyCards = document.getElementById('methodologyCards');
const traceabilityDisclosure = document.getElementById('traceabilityDisclosure');
const traceabilityPreview = document.getElementById('traceabilityPreview');
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
  reveal: {
    categories: false,
    methodology: false,
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

function getDefaultCategory() {
  return state.categoriesById.get(state.data.defaultSelection.id) || null;
}

function getDefaultYear() {
  return state.yearsById.get(state.data.defaultSelection.defaultYear) || state.data.years[0] || null;
}

function getSelectedCategory() {
  if (state.selection?.type !== 'category') return null;
  return state.categoriesById.get(state.selection.id) || null;
}

function getSelectedYear() {
  if (state.selection?.type !== 'year') return null;
  return state.yearsById.get(state.selection.id) || null;
}

function getInspectorSelectionLabel() {
  const selectedYear = getSelectedYear();
  if (selectedYear) {
    return `${selectedYear.fy} is selected. Open story, evidence, or sources.`;
  }

  const selectedCategory = getSelectedCategory() || getDefaultCategory();
  if (selectedCategory) {
    return `${selectedCategory.id} ${selectedCategory.name} is selected. Open story, evidence, or sources.`;
  }

  return 'Select a year or category to open focused analysis.';
}

function updateTabUi() {
  [storyTab, evidenceTab, sourceTab].forEach((tab) => {
    const isActive = tab.dataset.tab === state.inspectorTab;
    tab.classList.toggle('inspector-tab--active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
}

function openDisclosure(disclosureId, scroll = true) {
  const disclosure = document.getElementById(disclosureId);
  if (!disclosure) return;
  disclosure.open = true;

  if (scroll) {
    window.requestAnimationFrame(() => {
      disclosure.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
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
  const selectedCategory = getSelectedCategory() || getDefaultCategory();

  const majorDrivers = overview.majorDrivers
    .map((driver) => {
      const isActive = selectedCategory?.id === driver.id;

      return `
        <button
          class="driver-card${isActive ? ' driver-card--active' : ''}"
          type="button"
          data-select-type="category"
          data-select-id="${escapeHtml(driver.id)}"
          aria-pressed="${String(isActive)}"
        >
          <div class="driver-card__header">
            <span class="driver-card__rank">${driver.rank}</span>
            <span class="driver-card__share">${escapeHtml(formatPercent(driver.shareOfProgram))} of total</span>
          </div>
          <h3>${escapeHtml(driver.name)}</h3>
          <p class="driver-card__value mono">${escapeHtml(formatCurrency(driver.totalUsd))}</p>
          <p class="driver-card__copy">${escapeHtml(driver.meaning)}</p>
          <span class="driver-card__action">Inspect this driver</span>
        </button>
      `;
    })
    .join('');

  overviewContent.innerHTML = `
    <div class="overview-hero">
      <section class="total-card">
        <p class="total-card__label">Program-reference current cost</p>
        <h3 class="total-card__value mono">${escapeHtml(formatCurrency(overview.totalCostUsd))}</h3>
        <p class="total-card__range">
          Range:
          <span class="mono">${escapeHtml(formatCurrency(overview.lowCostUsd))}</span>
          to
          <span class="mono">${escapeHtml(formatCurrency(overview.highCostUsd))}</span>
        </p>
        <p class="total-card__range">
          Estimate span:
          <span class="mono">${escapeHtml(`FY${overview.startFy}-FY${overview.endFy}`)}</span>
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

        <div class="overview-actions">
          <button class="inline-action" type="button" data-action="open-disclosure" data-disclosure="yearDisclosure">
            Open year profile
          </button>
          <button class="inline-action" type="button" data-action="open-disclosure" data-disclosure="breakdownDisclosure">
            Open cost drivers
          </button>
          <button class="inline-action inline-action--secondary" type="button" data-action="open-disclosure" data-disclosure="methodologyDisclosure">
            Open methodology
          </button>
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

    <section class="overview-drivers">
      <div class="subsection-heading">
        <div>
          <p class="subsection-kicker">Major Drivers</p>
          <h3>The buckets shaping the estimate most</h3>
        </div>
        <p class="panel-meta">Click a driver to open its focused analysis.</p>
      </div>

      <div class="driver-strip">
        ${majorDrivers}
      </div>
    </section>
  `;
}

function renderYearChart() {
  const activeYear = getSelectedYear() || getDefaultYear();
  const busiestYear = state.data.overview.busiestYear?.fy;

  if (activeYear) {
    yearlyHint.textContent = `${state.data.years.length} fiscal years. ${activeYear.fy} is currently selected.`;

    yearStory.innerHTML = `
      <section class="chart-story">
        <div class="chart-story__main">
          <p class="detail-code">Selected year</p>
          <h4>${escapeHtml(activeYear.fy)}</h4>
          <p>${escapeHtml(activeYear.narrative)}</p>
        </div>

        <div class="chart-story__stats">
          <div class="story-metric story-metric--strong">
            <span class="story-metric__label">Total current cost</span>
            <span class="story-metric__value mono">${escapeHtml(formatCurrency(activeYear.totalUsd))}</span>
          </div>
          <div class="story-metric">
            <span class="story-metric__label">Direct phasing</span>
            <span class="story-metric__value mono">${escapeHtml(formatCurrency(activeYear.directUsd))}</span>
          </div>
          <div class="story-metric">
            <span class="story-metric__label">Reserve in year</span>
            <span class="story-metric__value mono">${escapeHtml(formatCurrency(activeYear.reserveUsd || 0))}</span>
          </div>
        </div>

        <div class="chart-story__actions">
          <button class="inline-action" type="button" data-action="open-disclosure" data-disclosure="inspectorDisclosure">
            Open focused analysis
          </button>
        </div>
      </section>

      <div class="chart-legend" aria-label="Cost component legend">
        <span class="legend-pill"><span class="legend-pill__swatch legend-pill__swatch--labor"></span>Labor</span>
        <span class="legend-pill"><span class="legend-pill__swatch legend-pill__swatch--material"></span>Material</span>
        <span class="legend-pill"><span class="legend-pill__swatch legend-pill__swatch--integration"></span>Integration</span>
        <span class="legend-pill"><span class="legend-pill__swatch legend-pill__swatch--reserve"></span>Reserve</span>
      </div>
    `;
  }

  yearChart.innerHTML = state.data.years
    .map((year) => {
      const rowWidth = state.data.maxYearTotalUsd
        ? Math.max(10, (year.totalUsd / state.data.maxYearTotalUsd) * 100)
        : 0;
      const laborShare = year.totalUsd ? (year.laborUsd / year.totalUsd) * 100 : 0;
      const materialShare = year.totalUsd ? (year.materialUsd / year.totalUsd) * 100 : 0;
      const integrationShare = year.totalUsd ? (year.integrationUsd / year.totalUsd) * 100 : 0;
      const reserveShare = year.totalUsd ? (year.reserveUsd / year.totalUsd) * 100 : 0;
      const isActive = activeYear?.fy === year.fy;
      const isPeak = busiestYear === year.fy;

      return `
        <button
          class="year-row${isActive ? ' year-row--active' : ''}"
          type="button"
          data-select-type="year"
          data-select-id="${escapeHtml(year.fy)}"
          aria-pressed="${String(isActive)}"
          role="listitem"
        >
          <div class="year-row__head">
            <span class="year-row__fy">${escapeHtml(year.fy)}</span>
            ${isPeak ? '<span class="row-flag">Peak year</span>' : ''}
          </div>

          <div class="year-row__chart">
            <div class="year-row__track">
              <div class="year-row__fill" style="width:${rowWidth}%;">
                ${laborShare ? `<span class="year-row__segment year-row__segment--labor" style="width:${laborShare}%;"></span>` : ''}
                ${materialShare ? `<span class="year-row__segment year-row__segment--material" style="width:${materialShare}%;"></span>` : ''}
                ${integrationShare ? `<span class="year-row__segment year-row__segment--integration" style="width:${integrationShare}%;"></span>` : ''}
                ${reserveShare ? `<span class="year-row__segment year-row__segment--reserve" style="width:${reserveShare}%;"></span>` : ''}
              </div>
            </div>
          </div>

          <span class="year-row__value mono">${escapeHtml(formatCurrency(year.totalUsd))}</span>
        </button>
      `;
    })
    .join('');
}

function renderBreakdown() {
  const selectedCategory = getSelectedCategory() || getDefaultCategory();
  const categories = state.data.topCategoryIds
    .map((categoryId) => state.categoriesById.get(categoryId))
    .filter(Boolean);
  const visibleCategories = state.reveal.categories ? categories : categories.slice(0, 6);
  const hiddenCount = Math.max(0, categories.length - visibleCategories.length);

  if (selectedCategory) {
    breakdownPreview.textContent = `${categories.length} top-level buckets. ${selectedCategory.name} is currently selected.`;
    breakdownSummary.innerHTML = `
      <section class="selection-callout">
        <div class="selection-callout__main">
          <p class="selection-callout__label">Selected bucket</p>
          <h4><span class="mono">${escapeHtml(selectedCategory.id)}</span> ${escapeHtml(selectedCategory.name)}</h4>
          <p>${escapeHtml(selectedCategory.meaning)}</p>
          <p class="selection-callout__support">${escapeHtml(selectedCategory.includedNote)}</p>
        </div>

        <div class="selection-callout__aside">
          <div class="story-metric">
            <span class="story-metric__label">Current cost</span>
            <span class="story-metric__value mono">${escapeHtml(formatCurrency(selectedCategory.baseUsd))}</span>
          </div>
          <div class="story-metric">
            <span class="story-metric__label">Peak year</span>
            <span class="story-metric__value">
              ${selectedCategory.topYear ? escapeHtml(selectedCategory.topYear.fy) : 'N/A'}
            </span>
          </div>
          <button class="inline-action" type="button" data-action="open-disclosure" data-disclosure="inspectorDisclosure">
            Open focused analysis
          </button>
        </div>
      </section>
    `;
  }

  breakdownCards.innerHTML = `
    <div class="category-list">
      ${visibleCategories
        .map((category, index) => {
          const isActive = selectedCategory?.id === category.id;

          return `
            <button
              class="category-row${isActive ? ' category-row--active' : ''}"
              type="button"
              data-select-type="category"
              data-select-id="${escapeHtml(category.id)}"
              aria-pressed="${String(isActive)}"
              role="listitem"
            >
              <span class="category-row__rank">${index + 1}</span>

              <div class="category-row__body">
                <div class="category-row__topline">
                  <div>
                    <p class="category-row__meta mono">${escapeHtml(category.id)}</p>
                    <h4>${escapeHtml(category.name)}</h4>
                  </div>
                  <span class="category-row__value mono">${escapeHtml(formatCurrency(category.baseUsd))}</span>
                </div>

                <div class="category-row__track">
                  <div class="category-row__fill" style="width:${Math.max(8, category.shareOfProgram * 100)}%;"></div>
                </div>

                <div class="category-row__footer">
                  <span class="tag tag--brand">${escapeHtml(formatPercent(category.shareOfProgram))} of total</span>
                  <span class="tag tag--copper">${escapeHtml(category.scopeLabel)}</span>
                  <span class="tag tag--forest">${escapeHtml(category.basisLabel)}</span>
                </div>
              </div>
            </button>
          `;
        })
        .join('')}
    </div>

    ${
      hiddenCount
        ? `
          <div class="list-action">
            <button class="text-button" type="button" data-action="toggle-reveal" data-target="categories">
              ${state.reveal.categories ? 'Show fewer categories' : `Show ${hiddenCount} more categories`}
            </button>
          </div>
        `
        : ''
    }
  `;
}

function renderMethodology() {
  const cards = state.data.methodology.cards;
  const visibleCards = state.reveal.methodology ? cards : cards.slice(0, 3);
  const hiddenCount = Math.max(0, cards.length - visibleCards.length);

  methodologyPreview.textContent = `${cards.length} methodology topics, including reserve treatment and judgment areas.`;
  methodologySummary.innerHTML = `<p>${escapeHtml(state.data.methodology.summary)}</p>`;

  methodologyCards.innerHTML = `
    ${visibleCards
      .map(
        (card) => `
          <article class="method-card">
            <p class="method-card__eyebrow">${escapeHtml(card.eyebrow)}</p>
            <h3>${escapeHtml(card.title)}</h3>
            <p class="method-card__summary">${escapeHtml(card.summary)}</p>

            <details class="mini-disclosure">
              <summary>Show supporting assumptions and logic</summary>
              <ul>
                ${card.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            </details>

            <a class="detail-link" href="${escapeHtml(card.sourceArtifact)}" target="_blank" rel="noreferrer">
              Open source artifact
            </a>
          </article>
        `,
      )
      .join('')}

    ${
      hiddenCount
        ? `
          <div class="list-action">
            <button class="text-button" type="button" data-action="toggle-reveal" data-target="methodology">
              ${state.reveal.methodology ? 'Show fewer methodology topics' : `Show ${hiddenCount} more methodology topics`}
            </button>
          </div>
        `
        : ''
    }
  `;
}

function renderTraceability() {
  const artifacts = state.data.traceability.artifacts;
  const sources = state.data.traceability.sources;
  const visibleArtifacts = state.reveal.artifacts ? artifacts : artifacts.slice(0, 3);
  const visibleSources = state.reveal.sources ? sources : sources.slice(0, 4);
  const hiddenArtifacts = Math.max(0, artifacts.length - visibleArtifacts.length);
  const hiddenSources = Math.max(0, sources.length - visibleSources.length);

  traceabilityPreview.textContent = `${artifacts.length} authority artifacts and ${sources.length} linked sources are available here.`;

  traceabilitySummary.innerHTML = `
    <div class="signal-grid">
      ${state.data.traceability.evidenceGroups
        .map(
          (group) => `
            <article class="signal-card">
              <p class="signal-card__label">${escapeHtml(group.title)}</p>
              <p class="signal-card__value">${escapeHtml(`${group.value} ${group.label}`)}</p>
              <p class="signal-card__copy">${escapeHtml(group.note)}</p>
            </article>
          `,
        )
        .join('')}
    </div>
    <p class="traceability-copy">${escapeHtml(state.data.traceability.summary)}</p>
  `;

  artifactList.innerHTML = `
    ${visibleArtifacts
      .map(
        (artifact) => `
          <article class="artifact-card">
            <div class="artifact-card__row">
              <div>
                <p class="artifact-card__meta">${escapeHtml(artifact.type)}</p>
                <h4>${escapeHtml(artifact.title)}</h4>
              </div>
              <a class="action-link" href="${escapeHtml(artifact.href)}" target="_blank" rel="noreferrer">Open file</a>
            </div>
            <p>${escapeHtml(artifact.description)}</p>
            <div class="artifact-card__tags">
              ${artifact.tags.map((tag) => `<span class="tag tag--brand">${escapeHtml(tag)}</span>`).join('')}
            </div>
          </article>
        `,
      )
      .join('')}

    ${
      hiddenArtifacts
        ? `
          <div class="list-action">
            <button class="text-button" type="button" data-action="toggle-reveal" data-target="artifacts">
              ${state.reveal.artifacts ? 'Show fewer artifacts' : `Show ${hiddenArtifacts} more artifacts`}
            </button>
          </div>
        `
        : ''
    }
  `;

  sourceList.innerHTML = `
    ${visibleSources
      .map(
        (source) => `
          <article class="source-card">
            <div class="source-card__row">
              <div>
                <p class="source-card__meta">${escapeHtml(source.id)} | ${escapeHtml(source.publisher)}</p>
                <h4>${escapeHtml(source.title)}</h4>
              </div>
              ${source.href ? `<a class="action-link" href="${escapeHtml(source.href)}" target="_blank" rel="noreferrer">Open source</a>` : ''}
            </div>
            <p>${escapeHtml(source.relevance)}</p>
            <div class="source-card__tags">
              <span class="tag tag--brand">${escapeHtml(source.authorityTier)}</span>
              <span class="tag tag--copper">${escapeHtml(source.sourceType)}</span>
              <span class="tag tag--forest">${escapeHtml(pluralize(source.linkedCount, 'linked category'))}</span>
            </div>
            <p>${escapeHtml(source.notes)}</p>
          </article>
        `,
      )
      .join('')}

    ${
      hiddenSources
        ? `
          <div class="list-action">
            <button class="text-button" type="button" data-action="toggle-reveal" data-target="sources">
              ${state.reveal.sources ? 'Show fewer sources' : `Show ${hiddenSources} more sources`}
            </button>
          </div>
        `
        : ''
    }
  `;
}

function renderInspectorStory() {
  const selectedYear = getSelectedYear();

  if (selectedYear) {
    return `
      <div class="focus-shell">
        <section class="focus-hero">
          <div class="focus-hero__main">
            <p class="detail-code">${escapeHtml(selectedYear.fy)}</p>
            <h4>${escapeHtml(selectedYear.fy)} cost at a glance</h4>
            <p>${escapeHtml(selectedYear.narrative)}</p>
          </div>
          <div class="focus-hero__value mono">${escapeHtml(formatCurrency(selectedYear.totalUsd))}</div>
        </section>

        <div class="focus-metrics">
          <div class="story-metric story-metric--strong">
            <span class="story-metric__label">Direct phasing</span>
            <span class="story-metric__value mono">${escapeHtml(formatCurrency(selectedYear.directUsd))}</span>
          </div>
          <div class="story-metric">
            <span class="story-metric__label">Reserve in year</span>
            <span class="story-metric__value mono">${escapeHtml(formatCurrency(selectedYear.reserveUsd || 0))}</span>
          </div>
        </div>

        <section class="focus-block">
          <h4>Largest drivers in this year</h4>
          <div class="detail-list">
            ${selectedYear.topBreakdown
              .slice(0, 4)
              .map(
                (entry) => `
                  <div class="detail-item">
                    <div class="detail-item__topline">
                      <span class="detail-item__title">${escapeHtml(entry.name)}</span>
                      <span class="detail-item__value mono">${escapeHtml(formatCurrency(entry.totalUsd))}</span>
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

  const selectedCategory = getSelectedCategory() || getDefaultCategory();
  if (!selectedCategory) return '';

  return `
    <div class="focus-shell">
      <section class="focus-hero">
        <div class="focus-hero__main">
          <p class="detail-code">${escapeHtml(selectedCategory.id)}</p>
          <h4>${escapeHtml(selectedCategory.name)}</h4>
          <p>${escapeHtml(selectedCategory.meaning)}</p>
        </div>
        <div class="focus-hero__value mono">${escapeHtml(formatCurrency(selectedCategory.baseUsd))}</div>
      </section>

      <div class="focus-metrics">
        <div class="story-metric story-metric--strong">
          <span class="story-metric__label">Share of program</span>
          <span class="story-metric__value">${escapeHtml(formatPercent(selectedCategory.shareOfProgram))}</span>
        </div>
        <div class="story-metric">
          <span class="story-metric__label">Timeframe</span>
          <span class="story-metric__value">${escapeHtml(selectedCategory.timeframeLabel)}</span>
        </div>
        <div class="story-metric">
          <span class="story-metric__label">Peak year</span>
          <span class="story-metric__value">
            ${selectedCategory.topYear ? escapeHtml(selectedCategory.topYear.fy) : 'N/A'}
          </span>
        </div>
      </div>

      <section class="focus-block">
        <h4>Why this bucket matters</h4>
        <p>${escapeHtml(selectedCategory.includedNote)}</p>
        <p>${escapeHtml(selectedCategory.judgmentNote)}</p>
        <div class="detail-tags">
          <span class="tag tag--brand">${escapeHtml(selectedCategory.scopeLabel)}</span>
          <span class="tag tag--copper">${escapeHtml(selectedCategory.basisLabel)}</span>
          <span class="tag tag--forest">${escapeHtml(selectedCategory.timeframeLabel)}</span>
        </div>
      </section>

      <section class="focus-block">
        <h4>Largest sub-buckets</h4>
        <div class="detail-list">
          ${
            selectedCategory.children.length
              ? selectedCategory.children
                  .slice(0, 4)
                  .map(
                    (child) => `
                      <div class="detail-item">
                        <div class="detail-item__topline">
                          <span class="detail-item__title">${escapeHtml(child.name)}</span>
                          <span class="detail-item__value mono">${escapeHtml(formatCurrency(child.baseUsd))}</span>
                        </div>
                        <p class="detail-item__copy">${escapeHtml(child.scopeLabel)} | ${escapeHtml(child.basisLabel)}</p>
                      </div>
                    `,
                  )
                  .join('')
              : '<p>No lower-level breakout is published for this bucket.</p>'
          }
        </div>
      </section>
    </div>
  `;
}

function renderInspectorEvidence() {
  const selectedYear = getSelectedYear();

  if (selectedYear) {
    return `
      <div class="focus-shell">
        <section class="focus-block">
          <h4>Evidence in the selected year</h4>
          <p>The year view rolls up the annual phasing file plus explicit reserve rows when reserve is present in that fiscal year.</p>
          <div class="detail-list">
            <div class="detail-item">
              <div class="detail-item__topline">
                <span class="detail-item__title">Direct phasing total</span>
                <span class="detail-item__value mono">${escapeHtml(formatCurrency(selectedYear.directUsd))}</span>
              </div>
            </div>
            <div class="detail-item">
              <div class="detail-item__topline">
                <span class="detail-item__title">Explicit reserve in year</span>
                <span class="detail-item__value mono">${escapeHtml(formatCurrency(selectedYear.reserveUsd || 0))}</span>
              </div>
            </div>
          </div>
        </section>

        <details class="mini-disclosure" open>
          <summary>Open annual evidence path</summary>
          <div class="focus-links">
            <a class="detail-link" href="/cost/source/gateway_cost_phasing.csv" target="_blank" rel="noreferrer">Annual phasing source</a>
            <a class="detail-link" href="/cost/source/gateway_cost_estimate_detail.csv" target="_blank" rel="noreferrer">Reserve detail source</a>
          </div>
        </details>
      </div>
    `;
  }

  const selectedCategory = getSelectedCategory() || getDefaultCategory();
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

      <details class="mini-disclosure" open>
        <summary>Representative detail lines</summary>
        <div class="detail-list">
          ${
            selectedCategory.representativeDetails.length
              ? selectedCategory.representativeDetails
                  .slice(0, 4)
                  .map(
                    (detail) => `
                      <div class="detail-item">
                        <div class="detail-item__topline">
                          <span class="detail-item__title">${escapeHtml(detail.name)}</span>
                          <span class="detail-item__value mono">${escapeHtml(formatCurrency(detail.amountUsd))}</span>
                        </div>
                        <p class="detail-item__copy">${escapeHtml(detail.fy)} | ${escapeHtml(detail.component)}</p>
                      </div>
                    `,
                  )
                  .join('')
              : '<p>No grouped detail rows are published for this bucket.</p>'
          }
        </div>
        <a class="detail-link" href="/cost/source/gateway_cost_estimate_detail.csv" target="_blank" rel="noreferrer">Open grouped detail source</a>
      </details>

      <details class="mini-disclosure">
        <summary>Direct priced lines</summary>
        <div class="detail-list">
          ${
            selectedCategory.pricedLines.length
              ? selectedCategory.pricedLines
                  .slice(0, 4)
                  .map(
                    (line) => `
                      <div class="detail-item">
                        <div class="detail-item__topline">
                          <span class="detail-item__title">${escapeHtml(line.description)}</span>
                          <span class="detail-item__value mono">${escapeHtml(formatCurrency(line.totalUsd))}</span>
                        </div>
                        <p class="detail-item__copy">${escapeHtml(line.contractType || 'Unspecified contract type')} | ${escapeHtml(line.optionYear || 'No option year')}</p>
                      </div>
                    `,
                  )
                  .join('')
              : '<p>No direct priced lines are linked to this bucket.</p>'
          }
        </div>
        <a class="detail-link" href="/cost/source/gateway_section_b_pricing.csv" target="_blank" rel="noreferrer">Open priced line source</a>
      </details>
    </div>
  `;
}

function renderInspectorSources() {
  const selectedYear = getSelectedYear();

  if (selectedYear) {
    return `
      <div class="focus-shell">
        <section class="focus-block">
          <h4>Source path for the selected year</h4>
          <p>The year profile is anchored by the annual phasing file, reserve detail, and the cost basis document that explains schedule-weighted burn assumptions.</p>
        </section>

        <details class="mini-disclosure" open>
          <summary>Open source files for this view</summary>
          <div class="focus-links">
            <a class="detail-link" href="/cost/source/gateway_cost_phasing.csv" target="_blank" rel="noreferrer">Annual phasing</a>
            <a class="detail-link" href="/cost/source/gateway_cost_estimate_detail.csv" target="_blank" rel="noreferrer">Reserve detail</a>
            <a class="detail-link" href="/cost/source/gateway_cost_basis_of_estimate.rtf" target="_blank" rel="noreferrer">Cost basis document</a>
          </div>
        </details>
      </div>
    `;
  }

  const selectedCategory = getSelectedCategory() || getDefaultCategory();
  if (!selectedCategory) return '';

  return `
    <div class="focus-shell">
      <details class="mini-disclosure" open>
        <summary>Linked sources</summary>
        <div class="detail-list">
          ${
            selectedCategory.linkedSources.length
              ? selectedCategory.linkedSources
                  .slice(0, 5)
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
                  .join('')
              : '<p>No linked sources are registered for this bucket.</p>'
          }
        </div>
      </details>

      <details class="mini-disclosure">
        <summary>Authority artifacts that support this bucket</summary>
        <div class="focus-links">
          <a class="detail-link" href="/cost/source/gateway_cost_estimate.csv" target="_blank" rel="noreferrer">Estimate rollup</a>
          <a class="detail-link" href="/cost/source/gateway_source_reference_register.csv" target="_blank" rel="noreferrer">Source register</a>
          <a class="detail-link" href="/cost/source/gateway_cost_basis_of_estimate.rtf" target="_blank" rel="noreferrer">Cost basis</a>
        </div>
      </details>
    </div>
  `;
}

function renderInspector() {
  inspectorPreview.textContent = getInspectorSelectionLabel();

  if (state.inspectorTab === 'evidence') {
    inspectorContent.innerHTML = renderInspectorEvidence();
  } else if (state.inspectorTab === 'sources') {
    inspectorContent.innerHTML = renderInspectorSources();
  } else {
    inspectorContent.innerHTML = renderInspectorStory();
  }
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

function handleSelection(target) {
  state.selection = {
    type: target.dataset.selectType,
    id: target.dataset.selectId,
  };
  state.inspectorTab = 'story';
  renderYearChart();
  renderBreakdown();
  renderInspector();
  updateTabUi();
  openDisclosure('inspectorDisclosure');
}

function handleAction(target) {
  const action = target.dataset.action;
  if (!action) return;

  if (action === 'open-disclosure') {
    openDisclosure(target.dataset.disclosure);
    return;
  }

  if (action === 'toggle-reveal') {
    const key = target.dataset.target;
    if (!Object.prototype.hasOwnProperty.call(state.reveal, key)) return;
    state.reveal[key] = !state.reveal[key];

    if (key === 'categories') renderBreakdown();
    if (key === 'methodology') renderMethodology();
    if (key === 'artifacts' || key === 'sources') renderTraceability();
  }
}

function handleClick(event) {
  const selectionButton = event.target.closest('[data-select-type]');
  if (selectionButton) {
    handleSelection(selectionButton);
    return;
  }

  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) {
    state.inspectorTab = tabButton.dataset.tab;
    renderInspector();
    updateTabUi();
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    handleAction(actionButton);
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
