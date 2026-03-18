const DATA_URL = './data/gateway-wbs.json';

const DETAIL_META = {
  cost: { label: 'Cost' },
  schedule: { label: 'Schedule' },
  risks: { label: 'Risks' },
  documents: { label: 'Documents' },
};

const appTitle = document.getElementById('appTitle');
const appSubtitle = document.getElementById('appSubtitle');
const appSignals = document.getElementById('appSignals');
const workspace = document.getElementById('workspace');
const searchInput = document.getElementById('searchInput');
const expandTopBtn = document.getElementById('expandTopBtn');
const collapseBtn = document.getElementById('collapseBtn');
const explorerViewBtn = document.getElementById('explorerViewBtn');
const structureViewBtn = document.getElementById('structureViewBtn');
const navActions = document.querySelector('.nav-zone__actions');
const treeStatus = document.getElementById('treeStatus');
const treeElement = document.getElementById('tree');
const structureView = document.getElementById('structureView');
const structureLevelSummary = document.getElementById('structureLevelSummary');
const structureViewport = document.getElementById('structureViewport');
const structureSvg = document.getElementById('structureSvg');
const overviewContent = document.getElementById('overviewContent');
const focusZone = document.getElementById('focusZone');
const focusContent = document.getElementById('focusContent');

const moneyFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

const state = {
  data: null,
  nodesById: new Map(),
  selectedId: '',
  expandedIds: new Set(),
  searchQuery: '',
  searchMatches: new Set(),
  visibleIds: null,
  autoExpandedIds: new Set(),
  activeDetail: null,
  viewMode: 'explorer',
  expandedPreviewByDetail: {
    cost: false,
    schedule: false,
    risks: false,
    documents: false,
  },
  structureLayout: null,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMillions(value) {
  return `$${moneyFormatter.format(Math.round(Number(value) || 0))}M`;
}

function formatNumber(value) {
  return moneyFormatter.format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return 'Not scheduled';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return dateFormatter.format(parsed);
}

function formatDateRange(startDate, endDate) {
  if (!startDate && !endDate) return 'No linked schedule dates';
  if (!startDate) return `Through ${formatDate(endDate)}`;
  if (!endDate) return `Starting ${formatDate(startDate)}`;
  if (startDate === endDate) return formatDate(startDate);
  return `${formatDate(startDate)} to ${formatDate(endDate)}`;
}

function pluralize(count, singular, pluralForm = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

function compareWbsId(left, right) {
  const leftParts = String(left).split('.').map(Number);
  const rightParts = String(right).split('.').map(Number);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : -1;
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index] : -1;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }
  return 0;
}

function truncateText(text, maxLength = 190) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLength) return clean;
  const trimmed = clean.slice(0, maxLength);
  const lastSpace = trimmed.lastIndexOf(' ');
  return `${trimmed.slice(0, lastSpace > 40 ? lastSpace : maxLength).trim()}...`;
}

function highlightText(text, query) {
  const safeText = escapeHtml(text);
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return safeText;
  const tokens = trimmedQuery
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  let highlighted = safeText;
  tokens.forEach((token) => {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    highlighted = highlighted.replace(new RegExp(`(${escapedToken})`, 'ig'), '<mark>$1</mark>');
  });
  return highlighted;
}

function joinPhrases(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function buildClientIndex(data) {
  state.nodesById = new Map(data.nodes.map((node) => [node.id, node]));
}

function getRootNode() {
  return state.nodesById.get(state.data?.rootId || '');
}

function getDefaultExpandedIds() {
  const rootNode = getRootNode();
  return new Set(rootNode ? [rootNode.id] : []);
}

function ensureAncestorsExpanded(nodeId) {
  const node = state.nodesById.get(nodeId);
  if (!node) return;
  node.ancestorIds.forEach((ancestorId) => state.expandedIds.add(ancestorId));
}

function buildIntroSignals() {
  const rootNode = getRootNode();
  const signals = [
    { label: 'Major parts', value: formatNumber(rootNode?.childIds.length || 0) },
    { label: 'Full hierarchy', value: formatNumber(state.data?.overview.totalNodes || 0) },
    { label: 'Detail lenses', value: '4 guided views' },
  ];

  appSignals.innerHTML = signals
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

function buildShortExplanation(node) {
  return truncateText(node.description || node.plainEnglish, 185);
}

function buildWhyItMatters(node) {
  if (node.id === state.data.rootId) {
    return 'It matters because every Gateway branch rolls up here, making this the clearest executive view of the whole program.';
  }

  const reasons = [];
  if (node.metrics.descendantCount > 0) {
    reasons.push(`${pluralize(node.metrics.descendantCount, 'lower-level part')} roll up into this branch`);
  }
  if (node.related.schedule.milestones.length > 0) {
    reasons.push(`${pluralize(node.related.schedule.milestones.length, 'milestone')} depend on it`);
  } else if (node.metrics.taskCount > 0) {
    reasons.push(`${pluralize(node.metrics.taskCount, 'scheduled activity', 'scheduled activities')} connect to it`);
  }
  if (node.metrics.activeRiskCount > 0) {
    reasons.push(`${pluralize(node.metrics.activeRiskCount, 'active risk')} are tracked here`);
  }
  if (node.metrics.documentCount > 0) {
    reasons.push(`${pluralize(node.metrics.documentCount, 'supporting document')} help define it`);
  }
  if (!reasons.length) {
    return 'It matters because this is a distinct piece of work inside the wider Gateway program structure.';
  }
  return `It matters because ${joinPhrases(reasons.slice(0, 2))}.`;
}

function buildTreeHint(node) {
  if (node.id === state.data.rootId) return `${pluralize(node.childIds.length, 'major branch')} at the top level`;
  if (node.childIds.length > 0) return `${pluralize(node.childIds.length, 'child branch')} below this point`;
  if (node.metrics.activeRiskCount > 0) return `${pluralize(node.metrics.activeRiskCount, 'active risk')} linked here`;
  if (node.metrics.documentCount > 0) return `${pluralize(node.metrics.documentCount, 'supporting file')} linked here`;
  return '';
}

function buildLensCards(node) {
  const activeRiskCount = node.metrics.activeRiskCount || node.metrics.riskCount;
  const scheduleValue = node.related.schedule.milestones.length
    ? pluralize(node.related.schedule.milestones.length, 'milestone')
    : node.metrics.taskCount
      ? pluralize(node.metrics.taskCount, 'scheduled activity', 'scheduled activities')
      : 'No scheduled activity';

  return [
    {
      key: 'cost',
      label: 'Cost',
      value: node.related.cost.estimates.length ? pluralize(node.related.cost.estimates.length, 'related item') : 'No linked items',
      hint: node.related.cost.totalBaseCost
        ? 'Preview the main cost signal attached to this branch.'
        : 'No cost preview is available yet for this branch.',
    },
    {
      key: 'schedule',
      label: 'Schedule',
      value: scheduleValue,
      hint: node.metrics.taskCount
        ? 'Preview the timing signals attached to this branch.'
        : 'No schedule preview is available yet for this branch.',
    },
    {
      key: 'risks',
      label: 'Risks',
      value: activeRiskCount ? pluralize(activeRiskCount, 'notable risk') : 'No notable risks',
      hint: activeRiskCount
        ? 'Preview the main issues attached to this branch.'
        : 'No risk preview is available yet for this branch.',
    },
    {
      key: 'documents',
      label: 'Documents',
      value: node.metrics.documentCount ? pluralize(node.metrics.documentCount, 'supporting file') : 'No supporting files',
      hint: node.metrics.documentCount
        ? 'Preview the files and terms attached to this branch.'
        : 'No document preview is available yet for this branch.',
    },
  ];
}

function truncateLabel(text, maxLength) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trim()}...`;
}

function getSelectedPathIds(node) {
  if (!node) return new Set();
  return new Set([node.id, ...node.ancestorIds]);
}

function setViewMode(mode) {
  state.viewMode = mode;
  render();

  if (mode === 'structure') {
    requestAnimationFrame(() => {
      scrollStructureToSelection();
    });
  }
}

function updateSearchState() {
  const query = state.searchQuery.trim().toLowerCase();
  state.searchMatches = new Set();
  state.visibleIds = null;
  state.autoExpandedIds = new Set();
  if (!query) return;

  const tokens = query.split(/\s+/).filter(Boolean);
  state.data.nodes.forEach((node) => {
    const matched = tokens.every((token) => node.searchText.includes(token));
    if (!matched) return;
    state.searchMatches.add(node.id);
    state.autoExpandedIds.add(node.id);
    node.ancestorIds.forEach((ancestorId) => state.autoExpandedIds.add(ancestorId));
  });

  const visibleIds = new Set(state.searchMatches);
  state.searchMatches.forEach((id) => {
    const node = state.nodesById.get(id);
    node?.ancestorIds.forEach((ancestorId) => visibleIds.add(ancestorId));
  });
  state.visibleIds = visibleIds;

  if (state.searchMatches.size > 0 && !state.searchMatches.has(state.selectedId)) {
    const firstMatch = Array.from(state.searchMatches).sort(compareWbsId)[0];
    state.selectedId = firstMatch;
    ensureAncestorsExpanded(firstMatch);
  }
}

function showTopLevels() {
  const rootNode = getRootNode();
  state.expandedIds = getDefaultExpandedIds();
  if (rootNode) rootNode.childIds.forEach((childId) => state.expandedIds.add(childId));
  render();
}

function collapseToMajorParts() {
  state.expandedIds = getDefaultExpandedIds();
  render();
}

function isExpanded(nodeId) {
  return state.expandedIds.has(nodeId) || state.autoExpandedIds.has(nodeId);
}

function toggleNode(nodeId) {
  if (state.expandedIds.has(nodeId)) state.expandedIds.delete(nodeId);
  else state.expandedIds.add(nodeId);
  renderTree();
}

function selectNode(nodeId) {
  state.selectedId = nodeId;
  ensureAncestorsExpanded(nodeId);
  if (history.replaceState) history.replaceState(null, '', `#${encodeURIComponent(nodeId)}`);
  render();
  if (state.viewMode === 'structure') {
    requestAnimationFrame(() => {
      scrollStructureToSelection();
    });
  }
}

function openDetail(detailKey) {
  const nextDetail = state.activeDetail === detailKey ? null : detailKey;
  if (nextDetail && state.activeDetail !== detailKey) {
    state.expandedPreviewByDetail[detailKey] = false;
  }
  state.activeDetail = nextDetail;
  render();
  if (state.activeDetail && window.matchMedia('(max-width: 1120px)').matches) {
    focusZone.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function closeDetail() {
  state.activeDetail = null;
  render();
}

function togglePreviewMore(detailKey) {
  state.expandedPreviewByDetail[detailKey] = !state.expandedPreviewByDetail[detailKey];
  renderFocus();
}

function buildStructureLayout(rootNode, viewportWidth) {
  if (!rootNode) return null;

  const layoutNodes = [];
  const layoutById = new Map();
  const leftPadding = 52;
  const rightPadding = 44;
  const topPadding = 76;
  const bottomPadding = 44;
  const leafGap = 34;
  const groupGap = 22;
  const width = Math.max(viewportWidth || 920, 920);
  const maxDepth = Math.max(...state.data.nodes.map((node) => node.level - 1), 0);
  let cursorY = topPadding;

  const nodeDimensions = (level) => {
    if (level === 1) return { width: 250, height: 54, radius: 18 };
    if (level === 2) return { width: 210, height: 40, radius: 16 };
    return { width: 172, height: 28, radius: 14 };
  };

  const columnGap = maxDepth > 0
    ? Math.max(240, (width - leftPadding - rightPadding - nodeDimensions(1).width) / maxDepth)
    : width - leftPadding - rightPadding - nodeDimensions(1).width;

  function getNodeX(level) {
    const depth = level - 1;
    const rightEdge = width - rightPadding - depth * columnGap;
    return rightEdge - nodeDimensions(level).width;
  }

  function assignSubtree(node, isLastLevelTwoBranch = false) {
    const dimensions = nodeDimensions(node.level);
    let centerY = cursorY;

    if (node.childIds.length > 0) {
      const childCenters = node.childIds.map((childId, index) =>
        assignSubtree(state.nodesById.get(childId), index === node.childIds.length - 1),
      );
      centerY = (childCenters[0] + childCenters.at(-1)) / 2;
      if (node.level === 2 && !isLastLevelTwoBranch) {
        cursorY += groupGap;
      }
    } else {
      centerY = cursorY;
      cursorY += leafGap;
    }

    const layoutNode = {
      id: node.id,
      parentId: node.parentId,
      level: node.level,
      name: node.name,
      x: getNodeX(node.level),
      y: centerY,
      width: dimensions.width,
      height: dimensions.height,
      radius: dimensions.radius,
    };

    layoutNodes.push(layoutNode);
    layoutById.set(node.id, layoutNode);
    return centerY;
  }

  const childCenters = rootNode.childIds.map((childId, index) =>
    assignSubtree(state.nodesById.get(childId), index === rootNode.childIds.length - 1),
  );
  const rootDimensions = nodeDimensions(rootNode.level);
  const rootY = childCenters.length
    ? (childCenters[0] + childCenters.at(-1)) / 2
    : topPadding;

  const rootLayoutNode = {
    id: rootNode.id,
    parentId: rootNode.parentId,
    level: rootNode.level,
    name: rootNode.name,
    x: getNodeX(rootNode.level),
    y: rootY,
    width: rootDimensions.width,
    height: rootDimensions.height,
    radius: rootDimensions.radius,
  };

  layoutNodes.push(rootLayoutNode);
  layoutById.set(rootNode.id, rootLayoutNode);

  const height = Math.max(cursorY + bottomPadding, 540);
  return { width, height, nodes: layoutNodes, byId: layoutById, columnGap };
}

function renderStructureSummary() {
  const countsByLevel = new Map();
  state.data.nodes.forEach((node) => {
    countsByLevel.set(node.level, (countsByLevel.get(node.level) || 0) + 1);
  });

  const cards = [
    {
      label: 'Detailed work',
      value: pluralize(countsByLevel.get(3) || 0, 'element'),
      hint: 'Lower-level elements spread on the left side of the roll-up.',
    },
    {
      label: 'Major parts',
      value: pluralize(countsByLevel.get(2) || 0, 'element'),
      hint: 'Middle-layer elements organize the program into major branches.',
    },
    {
      label: 'Program roll-up',
      value: pluralize(countsByLevel.get(1) || 0, 'program node'),
      hint: 'The overall Gateway program sits on the right as the final roll-up.',
    },
  ];

  structureLevelSummary.innerHTML = cards
    .map(
      (card) => `
        <article class="structure-level-card">
          <p class="structure-level-card__label">${escapeHtml(card.label)}</p>
          <p class="structure-level-card__value">${escapeHtml(card.value)}</p>
          <p class="structure-level-card__hint">${escapeHtml(card.hint)}</p>
        </article>
      `,
    )
    .join('');
}

function renderStructureView() {
  const rootNode = getRootNode();
  if (!rootNode) {
    structureSvg.innerHTML = '';
    return;
  }

  const queryActive = Boolean(state.searchQuery.trim());
  const hasMatches = state.searchMatches.size > 0;
  treeStatus.textContent = queryActive
    ? hasMatches
      ? `${pluralize(state.searchMatches.size, 'matching branch')} highlighted in Structure View while the full hierarchy remains visible.`
      : 'No matching branches were found. Structure View keeps the full hierarchy visible for context.'
    : 'Structure View shows the full roll-up at a glance: detailed work on the left, major elements in the middle, and the program on the right.';

  renderStructureSummary();
  const viewportWidth = Math.max(structureViewport.clientWidth - 36, 920);
  const layout = buildStructureLayout(rootNode, viewportWidth);
  state.structureLayout = layout;

  const selectedNode = state.nodesById.get(state.selectedId);
  const selectedPathIds = getSelectedPathIds(selectedNode);

  const columnLabels = [
    { label: 'Detailed Work', x: 70 },
    { label: 'Major Elements', x: layout.width / 2 - 84 },
    { label: 'Program Roll-Up', x: layout.width - 250 },
  ];

  const linksMarkup = layout.nodes
    .filter((node) => node.parentId && layout.byId.has(node.parentId))
    .map((node) => {
      const parent = layout.byId.get(node.parentId);
      const childRight = node.x + node.width;
      const parentLeft = parent.x;
      const curve = Math.max((parentLeft - childRight) * 0.42, 46);
      const path = `M ${childRight} ${node.y} C ${childRight + curve} ${node.y}, ${parentLeft - curve} ${parent.y}, ${parentLeft} ${parent.y}`;
      const selectedPath = selectedPathIds.has(node.id) && selectedPathIds.has(parent.id);
      return `<path class="structure-link ${selectedPath ? 'structure-link--selected-path' : ''}" d="${path}" />`;
    })
    .join('');

  const nodesMarkup = layout.nodes
    .sort((left, right) => left.level - right.level || left.y - right.y)
    .map((layoutNode) => {
      const node = state.nodesById.get(layoutNode.id);
      const isSelected = node.id === state.selectedId;
      const isMatch = state.searchMatches.has(node.id);
      const isDimmed = queryActive && hasMatches && !isMatch && !node.ancestorIds.some((id) => state.searchMatches.has(id));
      const label = truncateLabel(node.name, layoutNode.level === 3 ? 24 : layoutNode.level === 2 ? 28 : 32);
      const cardClasses = [
        'structure-node',
        `structure-node--level-${layoutNode.level}`,
        isSelected ? 'structure-node--selected' : '',
        isMatch ? 'structure-node--match' : '',
        isDimmed ? 'structure-node--dim' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const labelX = layoutNode.x + 12;
      const labelY = layoutNode.y - (layoutNode.level === 3 ? 1 : 4);

      return `
        <g class="${cardClasses}" data-structure-node="true" data-id="${escapeHtml(node.id)}" tabindex="0" role="button" aria-label="${escapeHtml(`${node.id} ${node.name}`)}">
          <rect class="structure-node__card" x="${layoutNode.x}" y="${layoutNode.y - layoutNode.height / 2}" width="${layoutNode.width}" height="${layoutNode.height}" rx="${layoutNode.radius}" ry="${layoutNode.radius}" />
          <text class="structure-node__code" x="${labelX}" y="${labelY}">${escapeHtml(node.id)}</text>
          <text class="structure-node__label" x="${labelX}" y="${labelY + (layoutNode.level === 3 ? 13 : 16)}">${escapeHtml(label)}</text>
        </g>
      `;
    })
    .join('');

  const labelsMarkup = columnLabels
    .map(
      (item) => `<text class="structure-column-label" x="${item.x}" y="38">${escapeHtml(item.label)}</text>`,
    )
    .join('');

  structureSvg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  structureSvg.setAttribute('width', `${layout.width}`);
  structureSvg.setAttribute('height', `${layout.height}`);
  structureSvg.innerHTML = `${labelsMarkup}${linksMarkup}${nodesMarkup}`;
}

function scrollStructureToSelection() {
  if (!state.structureLayout || state.viewMode !== 'structure') return;
  const layoutNode = state.structureLayout.byId.get(state.selectedId);
  if (!layoutNode) return;

  const targetTop = Math.max(layoutNode.y - structureViewport.clientHeight / 2, 0);
  structureViewport.scrollTo({ top: targetTop, behavior: 'smooth' });
}

function renderTree() {
  const rootNode = getRootNode();
  if (!rootNode) {
    treeElement.innerHTML = '<div class="empty-state"><h2>No hierarchy found</h2><p>The JSON payload did not include a usable WBS tree.</p></div>';
    return;
  }

  const queryActive = Boolean(state.searchQuery.trim());
  if (queryActive && state.searchMatches.size === 0) {
    treeStatus.textContent = 'No matching branches. Try a broader term or clear the search.';
    treeElement.innerHTML = '<div class="tree-search-empty">No matching branches were found. Search supports WBS names, descriptions, risks, schedule terms, and linked documents.</div>';
    return;
  }

  treeStatus.textContent = queryActive
    ? `${pluralize(state.searchMatches.size, 'matching branch')} shown with its context.`
    : 'The first screen shows the program at its highest level. Expand only when you want more structure.';

  treeElement.innerHTML = renderTreeBranch(rootNode);
}

function renderTreeBranch(node) {
  if (!node) return '';
  if (state.visibleIds && !state.visibleIds.has(node.id)) return '';
  const hasChildren = node.childIds.length > 0;
  const expanded = hasChildren && isExpanded(node.id);
  const selected = node.id === state.selectedId;
  const hint = buildTreeHint(node);
  const childrenMarkup = hasChildren && expanded
    ? node.childIds
        .map((childId) => renderTreeBranch(state.nodesById.get(childId)))
        .filter(Boolean)
        .join('')
    : '';

  return `
    <div class="tree-node">
      <div class="tree-row">
        <button class="tree-toggle" type="button" data-action="toggle" data-id="${escapeHtml(node.id)}" ${hasChildren ? '' : 'disabled'} aria-label="${expanded ? 'Collapse' : 'Expand'} ${escapeHtml(node.name)}" aria-expanded="${expanded ? 'true' : 'false'}">
          ${hasChildren ? (expanded ? '-' : '+') : '.'}
        </button>
        <button class="tree-select ${selected ? 'tree-select--selected' : ''}" type="button" data-action="select" data-id="${escapeHtml(node.id)}">
          <span class="tree-select__code">${escapeHtml(node.id)}</span>
          <span class="tree-select__label">${highlightText(node.name, state.searchQuery)}</span>
          ${hint ? `<span class="tree-select__hint">${escapeHtml(hint)}</span>` : ''}
        </button>
      </div>
      ${childrenMarkup ? `<div class="tree-branch">${childrenMarkup}</div>` : ''}
    </div>
  `;
}

function renderListGrid(items, renderItem) {
  if (!items.length) return '<p class="muted">Nothing is linked in this view for the selected branch.</p>';
  return `<div class="list-grid">${items.map(renderItem).join('')}</div>`;
}

function buildFuturePreviewLabel(detailKey) {
  return {
    cost: 'View full cost analysis',
    schedule: 'Explore full schedule view',
    risks: 'Open full risk view',
    documents: 'Open full document view',
  }[detailKey];
}

function buildLensInterpretation(node, detailKey) {
  if (detailKey === 'cost') {
    if (!node.related.cost.estimates.length) {
      return 'No linked cost rows are visible here yet, so this hub can only offer a structural preview for now.';
    }
    const topType = node.related.cost.byType[0]?.label || 'linked estimate items';
    return `This branch has a real cost footprint, but the hub view keeps it lightweight: the picture is mainly driven by ${topType.toLowerCase()} and a small number of linked estimate items.`;
  }

  if (detailKey === 'schedule') {
    if (!node.metrics.taskCount) {
      return 'No linked schedule activity is visible here yet, so this preview simply signals that there is no schedule story attached to this branch in the current extract.';
    }
    return `This branch has a schedule story, but the hub only previews the pacing: the important signal is how work is timed, where the milestones sit, and whether any critical tasks stand out.`;
  }

  if (detailKey === 'risks') {
    if (!node.metrics.riskCount) {
      return 'No linked risks are visible here yet, so this preview remains intentionally light.';
    }
    return `This branch has a risk picture, but the hub only surfaces the headline exposure: how many active risks matter right now and what the top issue appears to be.`;
  }

  if (!node.metrics.documentCount) {
    return 'No linked documents are visible here yet, so this preview simply shows that there is no document trail attached to the branch in the current tracker.';
  }
  return 'This branch has supporting documentation, but the hub only previews the kind of material attached here and a few representative files or terms.';
}

function buildLensTakeaways(node, detailKey) {
  if (detailKey === 'cost') {
    return [
      {
        label: 'Main signal',
        headline: node.related.cost.byType[0]?.label || 'No dominant cost driver',
        text: node.related.cost.estimates.length
          ? `${pluralize(node.related.cost.estimates.length, 'linked cost item')} shape this preview.`
          : 'There are no linked cost items to preview here yet.',
      },
      {
        label: 'Preview footprint',
        headline: node.related.cost.totalBaseCost ? formatMillions(node.related.cost.totalBaseCost) : 'No estimate linked',
        text: node.related.cost.totalBaseCost
          ? 'This is the rolled-up base estimate visible from the hub.'
          : 'A future cost app would take over once deeper analysis is needed.',
      },
    ];
  }

  if (detailKey === 'schedule') {
    return [
      {
        label: 'Schedule at a glance',
        headline: formatDateRange(node.related.schedule.startDate, node.related.schedule.endDate),
        text: node.metrics.taskCount
          ? 'This is the visible timing span for the branch in the current schedule extract.'
          : 'No linked schedule dates are attached to this branch right now.',
      },
      {
        label: 'Primary pacing signal',
        headline: node.related.schedule.milestones.length
          ? pluralize(node.related.schedule.milestones.length, 'milestone')
          : node.related.schedule.criticalCount
            ? pluralize(node.related.schedule.criticalCount, 'critical task')
            : 'No key dates yet',
        text: node.related.schedule.milestones.length
          ? 'Milestones are the clearest timing signal in this branch.'
          : node.related.schedule.criticalCount
            ? 'Critical tasks are the clearest timing signal in this branch.'
            : 'A future schedule app would carry the deeper timeline view.',
      },
    ];
  }

  if (detailKey === 'risks') {
    return [
      {
        label: 'Current exposure',
        headline: node.related.risks.activeCount ? pluralize(node.related.risks.activeCount, 'active risk') : 'No active risks',
        text: node.related.risks.activeCount
          ? 'This is the number of currently active risk items attached to the branch.'
          : 'Nothing currently stands out as an active risk signal here.',
      },
      {
        label: 'Strongest signal',
        headline: node.related.risks.highestScore ? `Score ${formatNumber(node.related.risks.highestScore)}` : 'No scored issue',
        text: node.related.risks.highestScore
          ? 'The preview uses the highest linked risk score as its headline indicator.'
          : 'A deeper future risk app would take over when more context is needed.',
      },
    ];
  }

  return [
    {
      label: 'Support footprint',
      headline: node.metrics.documentCount ? pluralize(node.metrics.documentCount, 'supporting file') : 'No linked files',
      text: node.metrics.documentCount
        ? 'This is the number of tracked documents attached to the branch.'
        : 'The current tracker does not attach documents to this branch.',
    },
    {
      label: 'Main document type',
      headline: node.related.documents.byType[0]?.label || 'No dominant type',
      text: node.related.documents.byType.length
        ? 'This is the strongest document category visible in the preview.'
        : 'A future document app would surface richer document structure when needed.',
    },
  ];
}

function renderTakeawayCards(items) {
  return `
    <section class="preview-takeaways">
      ${items
        .map(
          (item) => `
            <article class="preview-takeaway">
              <p class="preview-takeaway__label">${escapeHtml(item.label)}</p>
              <h3 class="preview-takeaway__headline">${escapeHtml(item.headline)}</h3>
              <p class="preview-takeaway__text">${escapeHtml(item.text)}</p>
            </article>
          `,
        )
        .join('')}
    </section>
  `;
}

function renderPreviewSection({ detailKey, eyebrow, title, text, items, renderItem, expandedLabel, collapsedLabel }) {
  const expanded = state.expandedPreviewByDetail[detailKey];
  const visibleItems = items.slice(0, expanded ? 5 : 2);
  const canToggle = items.length > 2;

  return `
    <section class="focus-block">
      <p class="focus-block__eyebrow">${escapeHtml(eyebrow)}</p>
      <h3 class="focus-block__title">${escapeHtml(title)}</h3>
      <p class="focus-block__text">${escapeHtml(text)}</p>
      ${renderListGrid(visibleItems, renderItem)}
      ${canToggle ? `
        <div class="preview-actions">
          <button class="preview-toggle" type="button" data-action="toggle-more" data-detail="${escapeHtml(detailKey)}">
            ${escapeHtml(expanded ? expandedLabel : collapsedLabel)}
          </button>
        </div>
      ` : ''}
    </section>
  `;
}

function renderOverview() {
  const node = state.nodesById.get(state.selectedId);
  if (!node) {
    overviewContent.innerHTML = '<section class="empty-state"><h2>Select a program part</h2><p>Choose a branch from the structure to begin.</p></section>';
    return;
  }

  const lensCards = buildLensCards(node);
  overviewContent.innerHTML = `
    <section class="overview-shell">
      <section class="overview-hero">
        <p class="overview-hero__code">${escapeHtml(node.id)}</p>
        <h2 class="overview-hero__title">${escapeHtml(node.name)}</h2>
        <div class="overview-hero__body">
          <article class="overview-blurb">
            <p class="overview-blurb__label">What this part is</p>
            <p class="overview-blurb__text">${escapeHtml(buildShortExplanation(node))}</p>
          </article>
          <article class="overview-blurb">
            <p class="overview-blurb__label">Why it matters</p>
            <p class="overview-blurb__text">${escapeHtml(buildWhyItMatters(node))}</p>
          </article>
        </div>
      </section>
      <section class="lens-grid" aria-label="Focused detail options">
        ${lensCards
          .map(
            (card) => `
              <button class="lens-card ${state.activeDetail === card.key ? 'lens-card--active' : ''}" type="button" data-action="open-detail" data-detail="${escapeHtml(card.key)}">
                <span class="lens-card__label">${escapeHtml(card.label)}</span>
                <span class="lens-card__value">${escapeHtml(card.value)}</span>
                <span class="lens-card__hint">${escapeHtml(card.hint)}</span>
              </button>
            `,
          )
          .join('')}
      </section>
      <div class="overview-prompt">These four cards are hub previews of deeper future specialist views. The WBS app stays focused on structure, meaning, and orientation.</div>
    </section>
  `;
}

function renderCostDetail(node) {
  return `
    ${renderTakeawayCards(buildLensTakeaways(node, 'cost'))}
    ${renderPreviewSection({
      detailKey: 'cost',
      eyebrow: 'Preview items',
      title: 'Representative cost signals',
      text: 'A few items that show what is driving the current cost picture for this branch.',
      items: node.related.cost.estimates.length
        ? node.related.cost.estimates
        : node.related.cost.contractHighlights,
      renderItem: (item) => {
        const isEstimate = Object.prototype.hasOwnProperty.call(item, 'elementName');
        return `
          <article class="list-card">
            <h4 class="list-card__title">${escapeHtml(isEstimate ? item.elementName : item.description)}</h4>
            <p class="list-card__meta">
              ${isEstimate
                ? `<strong>Type:</strong> ${escapeHtml(item.costType)} | <strong>Base:</strong> ${escapeHtml(formatMillions(item.baseCost))}`
                : `<strong>Option year:</strong> ${escapeHtml(item.optionYear)} | <strong>Total:</strong> ${escapeHtml(formatMillions(item.totalPrice / 1000000))}`}
            </p>
            <p class="list-card__body">${escapeHtml(truncateText(item.notes, 150))}</p>
          </article>
        `;
      },
      expandedLabel: 'Show fewer examples',
      collapsedLabel: 'Show more examples',
    })}
  `;
}

function renderScheduleDetail(node) {
  const criticalTasks = node.related.schedule.tasks.filter((item) => item.criticalFlag || item.milestoneFlag);
  const schedulePreviewItems = [
    ...node.related.schedule.milestones.map((item) => ({ kind: 'milestone', item })),
    ...criticalTasks.map((item) => ({ kind: 'task', item })),
  ];

  return `
    ${renderTakeawayCards(buildLensTakeaways(node, 'schedule'))}
    ${renderPreviewSection({
      detailKey: 'schedule',
      eyebrow: 'Schedule at a glance',
      title: 'Representative timing signals',
      text: 'A small set of milestones or tasks that tells the story of this branch without turning the WBS hub into a full schedule workspace.',
      items: schedulePreviewItems,
      renderItem: ({ kind, item }) => `
        <article class="list-card">
          <h4 class="list-card__title">${escapeHtml(item.name)}</h4>
          <p class="list-card__meta">
            ${kind === 'milestone'
              ? `<strong>Date:</strong> ${escapeHtml(formatDate(item.date))} | <strong>Phase:</strong> ${escapeHtml(item.programPhase)}`
              : `<strong>Dates:</strong> ${escapeHtml(formatDateRange(item.startDate, item.endDate))}`}
          </p>
          <p class="list-card__body">
            ${kind === 'milestone'
              ? escapeHtml(truncateText(item.notes, 145))
              : `${item.criticalFlag ? 'Critical path activity. ' : ''}${item.milestoneFlag ? 'Milestone-linked task. ' : ''}${escapeHtml(item.organization)}`}
          </p>
        </article>
      `,
      expandedLabel: 'Show fewer timing examples',
      collapsedLabel: 'Show more timing examples',
    })}
  `;
}

function renderRiskDetail(node) {
  return `
    ${renderTakeawayCards(buildLensTakeaways(node, 'risks'))}
    ${renderPreviewSection({
      detailKey: 'risks',
      eyebrow: 'Representative issues',
      title: 'A few risks that shape the picture',
      text: 'Only a small number of risks are shown here so the WBS hub stays readable and orientation-focused.',
      items: node.related.risks.items,
      renderItem: (item) => `
        <article class="list-card list-card--risk">
          <h4 class="list-card__title">${escapeHtml(item.title)}</h4>
          <p class="list-card__meta"><strong>Score:</strong> ${formatNumber(item.riskScore)} | <strong>Status:</strong> ${escapeHtml(item.status)}</p>
          <p class="list-card__body">${escapeHtml(truncateText(item.description, 155))}</p>
          <p class="list-card__body"><strong>Mitigation:</strong> ${escapeHtml(truncateText(item.mitigation, 135))}</p>
        </article>
      `,
      expandedLabel: 'Show fewer risk examples',
      collapsedLabel: 'Show more risk examples',
    })}
  `;
}

function renderDocumentDetail(node) {
  return `
    ${renderTakeawayCards(buildLensTakeaways(node, 'documents'))}
    ${renderPreviewSection({
      detailKey: 'documents',
      eyebrow: 'Representative support',
      title: 'Files and terms that define this branch',
      text: 'This is a guided preview of the supporting material, not a full document workspace.',
      items: node.related.documents.items.length
        ? node.related.documents.items
        : node.related.glossary.items,
      renderItem: (item) => {
        const isDocument = Object.prototype.hasOwnProperty.call(item, 'name');
        return `
          <article class="list-card">
            <h4 class="list-card__title">${escapeHtml(isDocument ? item.name : `${item.term}${item.acronym ? ` (${item.acronym})` : ''}`)}</h4>
            <p class="list-card__meta">
              ${isDocument
                ? `<strong>Type:</strong> ${escapeHtml(item.type)} | <strong>Status:</strong> ${escapeHtml(item.status)}`
                : '<strong>Glossary term</strong>'}
            </p>
            <p class="list-card__body">
              ${isDocument
                ? `${escapeHtml(item.owner)}${item.dueDate ? ` | Due ${escapeHtml(formatDate(item.dueDate))}` : ''}`
                : escapeHtml(truncateText(item.definition, 145))}
            </p>
          </article>
        `;
      },
      expandedLabel: 'Show fewer support examples',
      collapsedLabel: 'Show more support examples',
    })}
  `;
}

function renderFocus() {
  const node = state.nodesById.get(state.selectedId);
  if (!node || !state.activeDetail) {
    focusZone.hidden = true;
    focusContent.innerHTML = '';
    workspace.classList.remove('workspace--detail-open');
    return;
  }

  const detailRenderers = {
    cost: renderCostDetail,
    schedule: renderScheduleDetail,
    risks: renderRiskDetail,
    documents: renderDocumentDetail,
  };
  const detailKey = state.activeDetail;
  focusZone.hidden = false;
  workspace.classList.add('workspace--detail-open');
  focusContent.innerHTML = `
    <section class="focus-shell">
      <header class="focus-shell__header">
        <div class="focus-shell__header-row">
          <div>
            <p class="focus-shell__eyebrow">Focused detail</p>
            <h2 class="focus-shell__title">${escapeHtml(DETAIL_META[detailKey].label)}</h2>
            <p class="focus-shell__subtitle">${escapeHtml(node.id)} | ${escapeHtml(node.name)}</p>
          </div>
          <button class="focus-close" type="button" data-action="close-detail">Back to overview</button>
        </div>
        <p class="focus-summary">${escapeHtml(buildLensInterpretation(node, detailKey))}</p>
        <div class="preview-note">
          <span class="preview-note__eyebrow">Hub preview</span>
          <span class="preview-note__text">This is a lightweight preview inside the WBS hub. Future specialist app: ${escapeHtml(buildFuturePreviewLabel(detailKey))}.</span>
        </div>
      </header>
      ${detailRenderers[detailKey](node)}
    </section>
  `;
}

function renderNavigationMode() {
  const explorerActive = state.viewMode === 'explorer';

  explorerViewBtn.classList.toggle('view-switch__button--active', explorerActive);
  explorerViewBtn.setAttribute('aria-selected', explorerActive ? 'true' : 'false');
  structureViewBtn.classList.toggle('view-switch__button--active', !explorerActive);
  structureViewBtn.setAttribute('aria-selected', explorerActive ? 'false' : 'true');

  treeElement.hidden = !explorerActive;
  structureView.hidden = explorerActive;
  navActions.hidden = !explorerActive;

  workspace.classList.toggle('workspace--structure-view', !explorerActive);

  if (explorerActive) {
    renderTree();
  } else {
    renderStructureView();
  }
}

function render() {
  renderFocus();
  renderNavigationMode();
  renderOverview();
}

async function loadData() {
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    state.data = data;
    buildClientIndex(data);
    appTitle.textContent = data.app.title;
    appSubtitle.textContent = 'Use this as the ecosystem map: understand how Gateway is organized, what a branch means, and get a lightweight preview of the dimensions attached to it.';
    buildIntroSignals();

    const requestedId = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    state.selectedId = state.nodesById.has(requestedId) ? requestedId : data.rootId;
    state.expandedIds = getDefaultExpandedIds();
    ensureAncestorsExpanded(state.selectedId);
    updateSearchState();
    render();
  } catch (error) {
    overviewContent.innerHTML = `
      <section class="error-state">
        <h2>Unable to load the WBS dataset</h2>
        <p>The standalone demo expects the local server to expose <code>/wbs/data/gateway-wbs.json</code>.</p>
        <p><strong>Error:</strong> ${escapeHtml(error.message)}</p>
        <p>Run <code>node wbs/server.mjs</code> from the repo root, then open <code>http://127.0.0.1:4173/wbs/</code>.</p>
      </section>
    `;
    treeStatus.textContent = 'The hierarchy is unavailable until the JSON endpoint can be reached.';
  }
}

searchInput.addEventListener('input', (event) => {
  state.searchQuery = event.target.value || '';
  updateSearchState();
  render();
  if (state.viewMode === 'structure') {
    requestAnimationFrame(() => {
      scrollStructureToSelection();
    });
  }
});

expandTopBtn.addEventListener('click', () => {
  if (state.data) showTopLevels();
});

collapseBtn.addEventListener('click', () => {
  if (state.data) collapseToMajorParts();
});

explorerViewBtn.addEventListener('click', () => {
  if (state.data) setViewMode('explorer');
});

structureViewBtn.addEventListener('click', () => {
  if (state.data) setViewMode('structure');
});

treeElement.addEventListener('click', (event) => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const nodeId = control.dataset.id;
  if (!nodeId || !state.nodesById.has(nodeId)) return;
  if (control.dataset.action === 'toggle') toggleNode(nodeId);
  if (control.dataset.action === 'select') selectNode(nodeId);
});

overviewContent.addEventListener('click', (event) => {
  const control = event.target.closest('[data-action="open-detail"]');
  if (!control) return;
  const detailKey = control.dataset.detail;
  if (detailKey && DETAIL_META[detailKey]) openDetail(detailKey);
});

focusContent.addEventListener('click', (event) => {
  const toggleControl = event.target.closest('[data-action="toggle-more"]');
  if (toggleControl) {
    const detailKey = toggleControl.dataset.detail;
    if (detailKey && DETAIL_META[detailKey]) togglePreviewMore(detailKey);
    return;
  }

  const control = event.target.closest('[data-action="close-detail"]');
  if (control) closeDetail();
});

structureSvg.addEventListener('click', (event) => {
  const control = event.target.closest('[data-structure-node]');
  if (!control) return;
  const nodeId = control.dataset.id;
  if (nodeId && state.nodesById.has(nodeId)) selectNode(nodeId);
});

structureSvg.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const control = event.target.closest('[data-structure-node]');
  if (!control) return;
  event.preventDefault();
  const nodeId = control.dataset.id;
  if (nodeId && state.nodesById.has(nodeId)) selectNode(nodeId);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.activeDetail) closeDetail();
});

window.addEventListener('resize', () => {
  if (state.data && state.viewMode === 'structure') {
    renderStructureView();
  }
});

loadData();
