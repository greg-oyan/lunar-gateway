export const SUITE_PORTS = {
  documents: 4473,
  wbs: 4173,
  schedule: 4373,
  cost: 4273,
  risk: 4573,
};

export const SHARED_CONTEXT_KEYS = ['from', 'wbs', 'module', 'milestone', 'phase', 'risk', 'doc', 'scope'];
// `scope` is an intent marker, not content: it never counts as cross-app
// context on its own and never establishes a banner.
const SHARED_CONTEXT_VALUE_KEYS = SHARED_CONTEXT_KEYS.filter((key) => key !== 'from' && key !== 'scope');

function cleanValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function getCurrentRoute(pathname = window.location.pathname) {
  const segments = String(pathname || '/')
    .split('/')
    .filter(Boolean);

  if (!segments.length) {
    return 'simulation';
  }

  const knownRoutes = ['documents', 'wbs', 'schedule', 'cost', 'risk'];
  if (segments.at(-1) === 'index.html') {
    const routeSegment = segments.at(-2);
    return knownRoutes.includes(routeSegment) ? routeSegment : 'simulation';
  }

  const routeSegment = [...segments].reverse().find((segment) => knownRoutes.includes(segment));
  return routeSegment || 'simulation';
}

export function isStandaloneSuiteMode(port = window.location.port) {
  return Object.values(SUITE_PORTS).map(String).includes(String(port || ''));
}

function relativeRouteHref(targetRoute, currentRoute) {
  if (currentRoute === 'simulation') {
    return targetRoute === 'simulation' ? './' : `./${targetRoute}/`;
  }

  if (targetRoute === currentRoute) return './';
  if (targetRoute === 'simulation') return '../';
  return `../${targetRoute}/`;
}

export function buildSuiteHref(
  targetRoute,
  params = {},
  options = {},
) {
  const currentRoute = options.currentRoute || getCurrentRoute(options.pathname);
  const standalone = options.standalone ?? isStandaloneSuiteMode(options.port);
  const host = options.host || window.location.hostname || '127.0.0.1';
  const currentOrigin = options.origin || window.location.origin;

  let baseHref = relativeRouteHref(targetRoute, currentRoute);

  if (standalone) {
    if (targetRoute === 'simulation') {
      baseHref = `${currentOrigin.replace(/\/$/, '')}/index.html`;
    } else {
      baseHref = `http://${host}:${SUITE_PORTS[targetRoute]}/${targetRoute}/`;
    }
  }

  const searchParams = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, rawValue]) => {
    const value = cleanValue(rawValue);
    if (!value) return;
    searchParams.set(key, value);
  });

  const search = searchParams.toString();
  const hash = options.hash !== undefined ? cleanValue(options.hash) : '';

  if (standalone || /^https?:\/\//i.test(baseHref) || baseHref.startsWith('/index.html')) {
    const url = new URL(baseHref, options.base || window.location.href);
    url.search = search ? `?${search}` : '';
    url.hash = hash;
    return url.toString();
  }

  return `${baseHref}${search ? `?${search}` : ''}${hash ? `#${hash}` : ''}`;
}

export function readSharedContext(search = window.location.search) {
  const params = new URLSearchParams(search);
  return Object.fromEntries(
    SHARED_CONTEXT_KEYS.map((key) => [key, cleanValue(params.get(key))]).filter(([, value]) => value),
  );
}

export function getSharedContextEntries(sharedContext = {}) {
  return Object.fromEntries(
    SHARED_CONTEXT_KEYS.map((key) => [key, cleanValue(sharedContext?.[key])]),
  );
}

export function hasSharedContext(sharedContext = {}) {
  return SHARED_CONTEXT_VALUE_KEYS.some((key) => Boolean(cleanValue(sharedContext?.[key])));
}

const ITEM_ID_KEYS = ['module', 'milestone', 'phase', 'risk', 'doc'];

// True when `wbs` arrives as a suite-wide scope. Two cases qualify:
//   - a bare `wbs` with no accompanying item-id param (a deep link), or
//   - a `wbs` riding alongside an item id but carrying the explicit `scope=1`
//     marker, meaning an already-scoped app generated the link and the scope
//     should travel with it.
// A `wbs` riding alongside an item id WITHOUT the marker is a derived item
// association ("go look at this specific thing"); it never establishes a scope
// and the destination centers on the item instead.
export function wbsIsScope(sharedContext = {}) {
  const hasWbs = Boolean(cleanValue(sharedContext?.wbs));
  if (!hasWbs) return false;
  const hasItemId = ITEM_ID_KEYS.some((key) => Boolean(cleanValue(sharedContext?.[key])));
  const hasScopeMarker = cleanValue(sharedContext?.scope) === '1';
  return !hasItemId || hasScopeMarker;
}

export function mergeQueryState(
  entries,
  options = {},
) {
  const url = new URL(window.location.href);
  const replace = options.replace !== false;

  Object.entries(entries || {}).forEach(([key, rawValue]) => {
    const value = cleanValue(rawValue);
    if (!value) {
      url.searchParams.delete(key);
      return;
    }
    url.searchParams.set(key, value);
  });

  if (options.hash !== undefined) {
    url.hash = cleanValue(options.hash);
  }

  window.history[replace ? 'replaceState' : 'pushState']({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export function applySuiteNav(contextParams = {}, options = {}) {
  document.querySelectorAll('[data-suite-route]').forEach((link) => {
    const targetRoute = link.getAttribute('data-suite-route');
    if (!targetRoute) return;
    link.href = buildSuiteHref(targetRoute, contextParams, options);
  });
}

export async function loadSuiteCrosswalk(relativeUrl) {
  const response = await fetch(relativeUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to load suite crosswalk (${response.status})`);
  }
  return response.json();
}

export function compareWbsId(left, right) {
  const leftParts = String(left || '')
    .split('.')
    .map((value) => Number(value));
  const rightParts = String(right || '')
    .split('.')
    .map((value) => Number(value));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : -1;
    const rightValue = Number.isFinite(rightParts[index]) ? rightParts[index] : -1;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }

  return 0;
}

export function uniqueById(items = []) {
  const seen = new Map();
  items.filter(Boolean).forEach((item) => {
    if (item?.id && !seen.has(item.id)) {
      seen.set(item.id, item);
    }
  });
  return [...seen.values()];
}

function escapeHtmlValue(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Resolves a `wbs` shared-context value into a suite-wide scope token.
// Returns null when no scope is set. `has(id)` is the single subtree test
// every app shares: exact match or dotted-prefix descendant.
export function resolveScope(crosswalk, wbsId) {
  const id = cleanValue(wbsId);
  if (!id) return null;

  const node = crosswalk?.wbs?.byId?.[id] || null;
  return {
    id,
    name: cleanValue(node?.name),
    parentId: cleanValue(node?.parentId),
    known: Boolean(node),
    has(candidateId) {
      const candidate = cleanValue(candidateId);
      if (!candidate) return false;
      return candidate === id || candidate.startsWith(`${id}.`);
    },
  };
}

// Shared scope-pill markup. The host app wires `[data-action="clear-scope"]`.
// `options.note` adds a literal qualifier label (e.g. "Program-level view")
// for views that cannot meaningfully scope.
export function buildScopePillHtml(scope, options = {}) {
  if (!scope) return '';
  const label = `Scoped to ${scope.id}${scope.name ? ` ${scope.name}` : ''}`;
  const note = cleanValue(options.note);

  return `
    <div class="suite-scope-pill" role="status">
      <span class="suite-scope-pill__label">${escapeHtmlValue(label)}</span>
      ${note ? `<span class="suite-scope-pill__note">${escapeHtmlValue(note)}</span>` : ''}
      <button class="suite-scope-pill__clear" type="button" data-action="clear-scope">Clear</button>
    </div>
  `;
}

// Shared zero-result state for an active scope. The host app wires
// `[data-action="scope-view-parent"]` and `[data-action="clear-scope"]`.
export function buildScopeEmptyStateHtml(scope, itemLabel = 'items') {
  if (!scope) return '';
  const parentId = cleanValue(scope.parentId);

  return `
    <div class="suite-scope-empty">
      <p class="suite-scope-empty__title">No ${escapeHtmlValue(itemLabel)} linked to WBS ${escapeHtmlValue(scope.id)}${scope.name ? ` ${escapeHtmlValue(scope.name)}` : ''}</p>
      <div class="suite-scope-empty__actions">
        ${parentId ? `<button class="suite-context-action" type="button" data-action="scope-view-parent" data-parent-id="${escapeHtmlValue(parentId)}">View parent ${escapeHtmlValue(parentId)}</button>` : ''}
        <button class="suite-context-action" type="button" data-action="clear-scope">Show all</button>
      </div>
    </div>
  `;
}

export function basenameFromPath(pathValue) {
  const cleanPath = cleanValue(pathValue);
  if (!cleanPath) return '';
  const withoutHash = cleanPath.split('#')[0];
  const withoutQuery = withoutHash.split('?')[0];
  return decodeURIComponent(withoutQuery).split('/').filter(Boolean).at(-1) || '';
}
