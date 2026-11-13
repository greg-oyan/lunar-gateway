// Presentation layer for the 3D simulation.
//
// index.html is a protected file and is not edited. Everything here is added
// from outside: a stylesheet, a few class names, and three small controls that
// only press buttons the simulation already has. The 3D scene, orbit math,
// camera and tour code are never touched or called.
//
// Turn it off for one visit with ?layer=off, or for good by setting
// SIMULATION_LAYER_ENABLED to false in suite-context.js.

const ASSET_BASE = new URL('.', import.meta.url);
const HINT_DONE_KEY = 'gateway-sim-hint-done';

// Judgment call: the simulation opens at 600x, and at that speed the station
// outruns the camera within seconds of "Focus Gateway", so there is nothing
// left to click. The prompt's "Fly to Gateway" therefore presses the
// simulation's own 1x speed button first. Set to '' to leave the speed alone.
// The simulation's own Focus Gateway button is unchanged.
const FLY_SPEED_BUTTON_ID = 'sp-1';

// Selectors this layer relies on. scripts/verify-suite.mjs checks that each
// still exists in index.html, so a later edit to the simulation flags the
// layer instead of silently drifting from it.
export const SIMULATION_LAYER_HOOKS = [
  'id="launch"',
  'id="launch-start"',
  'id="launch-tour"',
  'class="launch-grid"',
  'id="hud"',
  'class="h-row"',
  'class="h-sval"',
  'id="focus-gw"',
  'id="cam-gw"',
  'id="sp-1"',
  'id="info"',
  'id="i-links"',
  'id="ht"',
  'id="oleg"',
];

function hintDone() {
  try {
    return window.sessionStorage.getItem(HINT_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

function markHintDone() {
  try {
    window.sessionStorage.setItem(HINT_DONE_KEY, '1');
  } catch {
    // Storage can be unavailable; the hint then shows again next load.
  }
}

function addStylesheet() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./simulation-layer.css', ASSET_BASE).href;
  document.head.append(link);
}

// Launch screen: one primary action. Quality is a fixed readout, not a
// control, so it is not drawn.
function tidyLaunch() {
  const start = document.getElementById('launch-start');
  const tour = document.getElementById('launch-tour');
  if (start) start.classList.add('sim-primary');
  if (tour) tour.classList.add('sim-secondary');
  document.querySelectorAll('#launch .launch-grid .launch-block').forEach((block) => {
    if (block.querySelector('.launch-quality')) block.classList.add('sim-hidden');
  });
}

// HUD: live telemetry stays; fixed station facts fold behind one toggle.
function foldStationFacts() {
  const hud = document.getElementById('hud');
  if (!hud) return;
  const rows = [...hud.querySelectorAll('.h-row')];
  const facts = rows.filter((row) => row.querySelector('.h-sval'));
  if (!facts.length) return;
  facts.forEach((row) => row.classList.add('sim-fact'));

  const dividers = [...hud.querySelectorAll('.h-div')];
  // The divider that only separates the fact block from the telemetry.
  if (dividers.length >= 3) dividers[1].classList.add('sim-fact');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sim-facts-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = 'Station facts';
  toggle.addEventListener('click', () => {
    const open = hud.classList.toggle('sim-facts-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  const anchor = dividers.at(-1);
  if (anchor) anchor.before(toggle);
  else hud.append(toggle);
}

// Keyboard and mouse hints: one small button instead of three lines of text.
function addControlsToggle() {
  const hints = document.getElementById('ht');
  if (!hints) return;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sim-controls-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = 'Controls';
  toggle.addEventListener('click', () => {
    const open = document.documentElement.classList.toggle('sim-controls-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.body.append(toggle);
}

// Module panel: add the Overview to the handoffs the simulation already
// builds, using the same link parameters, and label the row once.
function watchModuleLinks() {
  const links = document.getElementById('i-links');
  if (!links) return;
  const sync = () => {
    if (links.querySelector('[data-sim-layer]')) return;
    const wbsLink = [...links.querySelectorAll('a')].find((link) => /\/wbs\/(\?|$)/.test(link.getAttribute('href') || ''));
    if (!wbsLink) return;
    const overview = wbsLink.cloneNode(false);
    overview.setAttribute('data-sim-layer', '');
    overview.setAttribute('href', wbsLink.getAttribute('href').replace(/\/wbs\/(\?|$)/, '/overview/$1'));
    overview.textContent = 'Open in Overview';
    links.prepend(overview);
    // Say "Open in" once, as the other apps do, instead of on all six links.
    links.querySelectorAll('a').forEach((link) => {
      const full = link.textContent.trim();
      const short = full.replace(/^Open in\s+/i, '');
      if (short === full) return;
      link.setAttribute('aria-label', full);
      link.textContent = short;
    });
    const label = document.createElement('span');
    label.className = 'sim-open-in-label';
    label.setAttribute('data-sim-layer', '');
    label.textContent = 'Open in';
    links.prepend(label);
  };
  new MutationObserver(sync).observe(links, { childList: true });
  sync();
}

// First-run prompt: the payoff of the simulation is selecting a module, and
// nothing on screen says so. Two steps, then it never shows again this session.
function setupPrompt() {
  if (hintDone()) return;
  const hud = document.getElementById('hud');
  const info = document.getElementById('info');
  const focusButton = document.getElementById('focus-gw');
  if (!hud || !info || !focusButton) return;

  const prompt = document.createElement('div');
  prompt.className = 'sim-prompt';
  prompt.hidden = true;
  prompt.setAttribute('role', 'status');
  document.body.append(prompt);

  let step = 'fly';
  let finished = false;
  let slowed = false;

  const finish = () => {
    finished = true;
    prompt.hidden = true;
    markHintDone();
  };

  const render = () => {
    if (finished) return;
    const running = hud.classList.contains('show') && !document.getElementById('launch');
    const touring = document.body.classList.contains('tour-mode');
    prompt.hidden = !running || touring;
    if (prompt.hidden) return;

    if (step === 'fly') {
      prompt.innerHTML = `
        <span class="sim-prompt__text">Gateway is the small craft on the orbit line</span>
        <button class="sim-prompt__action" type="button" data-sim-fly>Fly to Gateway</button>
        <button class="sim-prompt__close" type="button" data-sim-dismiss aria-label="Dismiss">✕</button>`;
    } else {
      prompt.innerHTML = `
        <span class="sim-prompt__text">${slowed ? 'Time slowed to 1×. ' : ''}Click a module for its cost, schedule and risk</span>
        <button class="sim-prompt__close" type="button" data-sim-dismiss aria-label="Dismiss">✕</button>`;
    }
  };

  prompt.addEventListener('click', (event) => {
    if (event.target.closest('[data-sim-dismiss]')) {
      finish();
      return;
    }
    if (event.target.closest('[data-sim-fly]')) {
      const speedButton = FLY_SPEED_BUTTON_ID ? document.getElementById(FLY_SPEED_BUTTON_ID) : null;
      if (speedButton) {
        speedButton.click();
        slowed = true;
      }
      focusButton.click();
    }
  });

  // Whichever way the user gets to the station, move to the second step.
  ['focus-gw', 'cam-gw'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', () => {
      if (finished || step !== 'fly') return;
      step = 'pick';
      render();
    });
  });

  new MutationObserver(() => {
    if (info.classList.contains('show')) finish();
    else render();
  }).observe(info, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(render).observe(hud, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(render).observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true });
  render();
}

export function initSimulationLayer() {
  const root = document.documentElement;
  if (root.classList.contains('sim-layer')) return;
  if (!document.getElementById('hud')) return;
  if (new URLSearchParams(window.location.search).get('layer') === 'off') return;

  root.classList.add('sim-layer');
  addStylesheet();
  [tidyLaunch, foldStationFacts, addControlsToggle, watchModuleLinks, setupPrompt].forEach((step) => {
    try {
      step();
    } catch (error) {
      console.warn(`Simulation layer: ${step.name} skipped`, error);
    }
  });
}
