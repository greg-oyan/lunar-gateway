// Small shared helpers for the Overview and Confidence apps: formatting,
// risk bands, a tooltip, and SVG scale utilities. No dependencies.

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// $7.3B, $951M, $65M, $850K. One decimal only where it carries information.
export function formatUsdCompact(value, options = {}) {
  const amount = Number(value) || 0;
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const digits = options.digits;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(digits ?? 1).replace(/\.0+$/, '')}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(digits ?? (abs >= 1e8 ? 0 : 1)).replace(/\.0+$/, '')}M`;
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export function formatUsdFull(value) {
  return `$${Math.round(Number(value) || 0).toLocaleString('en-US')}`;
}

export function formatPercent(value, digits = 0) {
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseIsoDate(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

export function formatMonthYear(date) {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function addMonths(date, months) {
  const whole = Math.trunc(months);
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + whole, date.getUTCDate()));
  return new Date(next.getTime() + (months - whole) * 30.44 * 86400000);
}

// Federal fiscal year N runs Oct 1 of N-1 through Sep 30 of N.
export function fiscalYearStart(fyLabel) {
  const year = Number(String(fyLabel).replace(/\D/g, ''));
  return new Date(Date.UTC(year - 1, 9, 1));
}

export function fiscalYearEnd(fyLabel) {
  const year = Number(String(fyLabel).replace(/\D/g, ''));
  return new Date(Date.UTC(year, 8, 30));
}

// Same band logic as the Risk Explorer: score = likelihood x impact.
export const RISK_BANDS = [
  { key: 'critical', label: 'Critical', min: 16, range: '16-25' },
  { key: 'high', label: 'High', min: 12, range: '12-15' },
  { key: 'moderate', label: 'Moderate', min: 8, range: '8-11' },
  { key: 'watch', label: 'Watch', min: 1, range: '1-7' },
];

export function riskBand(score) {
  return RISK_BANDS.find((band) => Number(score) >= band.min) || RISK_BANDS.at(-1);
}

export function bandChipHtml(score) {
  const band = riskBand(score);
  return `<span class="band-chip band-chip--${band.key}">${escapeHtml(band.label)} ${escapeHtml(score)}</span>`;
}

export function linearScale([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1;
  const scale = (value) => r0 + ((value - d0) / span) * (r1 - r0);
  scale.invert = (pixel) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  return scale;
}

// Round axis ticks: 0, 250M, 500M ...
export function niceTicks(maxValue, targetCount = 4) {
  if (!(maxValue > 0)) return [0];
  const rough = maxValue / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) || rough;
  const ticks = [];
  for (let tick = 0; tick <= maxValue + step * 0.001; tick += step) ticks.push(tick);
  if (ticks.at(-1) < maxValue) ticks.push(ticks.at(-1) + step);
  return ticks;
}

let tooltipElement = null;

function ensureTooltip() {
  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'viz-tooltip';
    tooltipElement.hidden = true;
    tooltipElement.setAttribute('role', 'tooltip');
    document.body.append(tooltipElement);
  }
  return tooltipElement;
}

export function showTooltip(html, clientX, clientY) {
  const tooltip = ensureTooltip();
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const { width, height } = tooltip.getBoundingClientRect();
  const margin = 12;
  let left = clientX + 16;
  let top = clientY + 16;
  if (left + width + margin > window.innerWidth) left = clientX - width - 16;
  if (top + height + margin > window.innerHeight) top = clientY - height - 16;
  tooltip.style.left = `${Math.max(margin, left)}px`;
  tooltip.style.top = `${Math.max(margin, top)}px`;
}

export function hideTooltip() {
  if (tooltipElement) tooltipElement.hidden = true;
}

// Wires hover and keyboard-focus tooltips for any element carrying
// data-tip-id inside `container`. `resolve(id, element)` returns tooltip HTML.
export function bindTooltips(container, resolve) {
  const show = (target, x, y) => {
    const html = resolve(target.getAttribute('data-tip-id'), target);
    if (html) showTooltip(html, x, y);
    else hideTooltip();
  };
  container.addEventListener('pointermove', (event) => {
    const target = event.target.closest('[data-tip-id]');
    if (!target || !container.contains(target)) {
      hideTooltip();
      return;
    }
    show(target, event.clientX, event.clientY);
  });
  container.addEventListener('pointerleave', hideTooltip);
  container.addEventListener('focusin', (event) => {
    const target = event.target.closest('[data-tip-id]');
    if (!target) return;
    const box = target.getBoundingClientRect();
    show(target, box.left + box.width / 2, box.top + box.height / 2);
  });
  container.addEventListener('focusout', hideTooltip);
}

// Re-runs `render` when the element's width changes.
export function observeWidth(element, render) {
  let lastWidth = 0;
  const observer = new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width);
    if (!width || width === lastWidth) return;
    lastWidth = width;
    render(width);
  });
  observer.observe(element);
  return observer;
}
