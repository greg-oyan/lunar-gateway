import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const dataFiles = {
  wbs: 'Contract_Cost_Schedule Documents/data/gateway_wbs.csv',
  costs: 'Contract_Cost_Schedule Documents/data/gateway_cost_estimate.csv',
  risks: 'Contract_Cost_Schedule Documents/data/gateway_risk_register.csv',
  schedule: 'Contract_Cost_Schedule Documents/data/gateway_master_schedule.csv',
  milestones: 'Contract_Cost_Schedule Documents/data/gateway_milestones.csv',
  documents: 'Contract_Cost_Schedule Documents/data/gateway_contract_documents_tracker.csv',
  glossary: 'Contract_Cost_Schedule Documents/data/gateway_glossary.csv',
  phasing: 'Contract_Cost_Schedule Documents/data/gateway_cost_phasing.csv',
  pricing: 'Contract_Cost_Schedule Documents/data/gateway_section_b_pricing.csv',
};

const staticDatasetPath = path.join(currentDir, 'data', 'gateway-wbs.json');

const suiteAssets = {
  'lunar-gateway-favicon.svg': 'suite-assets/lunar-gateway-favicon.svg',
  'lunar-gateway-share-card.svg': 'suite-assets/lunar-gateway-share-card.svg',
};

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.rtf': 'application/rtf',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const moneyFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function toBoolean(value) {
  return /^true$/i.test(String(value ?? '').trim());
}

function compareWbsId(left, right) {
  const leftParts = String(left).split('.').map(Number);
  const rightParts = String(right).split('.').map(Number);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : -1;
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index] : -1;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

function sameOrDescendant(candidateId, nodeId) {
  return candidateId === nodeId || String(candidateId).startsWith(`${nodeId}.`);
}

function earliestDate(rows, key) {
  return rows.reduce((earliest, row) => {
    const value = normalizeText(row[key]);
    if (!value) return earliest;
    if (!earliest || value < earliest) return value;
    return earliest;
  }, '');
}

function latestDate(rows, key) {
  return rows.reduce((latest, row) => {
    const value = normalizeText(row[key]);
    if (!value) return latest;
    if (!latest || value > latest) return value;
    return latest;
  }, '');
}

function buildCsvRows(text) {
  const rows = [];
  let currentValue = '';
  let currentRow = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (!insideQuotes && character === ',') {
      currentRow.push(currentValue);
      currentValue = '';
      continue;
    }

    if (!insideQuotes && (character === '\n' || character === '\r')) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }
      currentRow.push(currentValue);
      if (currentRow.some((cell) => cell !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentValue = '';
      continue;
    }

    currentValue += character;
  }

  if (currentValue !== '' || currentRow.length > 0) {
    currentRow.push(currentValue);
    if (currentRow.some((cell) => cell !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function parseCsv(text) {
  const rows = buildCsvRows(text);
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => normalizeText(header));
  return rows.slice(1).map((row) => {
    const entry = {};

    headers.forEach((header, index) => {
      entry[header] = normalizeText(row[index] ?? '');
    });

    return entry;
  });
}

async function readCsv(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const contents = await fs.readFile(absolutePath, 'utf8');
  return parseCsv(contents);
}

function countValues(rows, key) {
  const counts = new Map();

  rows.forEach((row) => {
    const value = normalizeText(row[key]);
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function summarizeCostByType(costRows) {
  const totals = new Map();

  costRows.forEach((row) => {
    const key = normalizeText(row.costType) || 'Unspecified';
    totals.set(key, (totals.get(key) || 0) + row.baseCost);
  });

  return Array.from(totals.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function summarizePhasing(rows) {
  const totals = new Map();

  rows.forEach((row) => {
    const existing = totals.get(row.fy) || {
      fy: row.fy,
      laborCost: 0,
      materialCost: 0,
      integrationCost: 0,
      totalCost: 0,
    };

    existing.laborCost += row.laborCost;
    existing.materialCost += row.materialCost;
    existing.integrationCost += row.integrationCost;
    existing.totalCost += row.totalCost;
    totals.set(row.fy, existing);
  });

  return Array.from(totals.values()).sort((left, right) => left.fy.localeCompare(right.fy));
}

function formatMillions(value) {
  return `$${moneyFormatter.format(Math.round(value))}M`;
}

function formatDateRange(startDate, endDate) {
  if (!startDate && !endDate) return 'No linked schedule dates';
  if (!startDate) return `Through ${endDate}`;
  if (!endDate) return `Starting ${startDate}`;
  if (startDate === endDate) return startDate;
  return `${startDate} to ${endDate}`;
}

function buildPlainEnglish(node, rollups) {
  const branchLabel = node.level === 1 ? 'program' : 'work area';
  const childCount = rollups.metrics.descendantCount;
  const childSentence = childCount
    ? `It rolls up ${childCount} lower-level WBS elements.`
    : 'It does not break down into smaller WBS elements in this dataset.';
  const riskSentence = rollups.risks.totalCount
    ? `This branch currently links to ${rollups.risks.activeCount} active risks out of ${rollups.risks.totalCount} total tracked risks.`
    : 'There are no linked risks in the current register for this branch.';
  const scheduleSentence = rollups.schedule.taskCount
    ? `Its linked schedule runs ${formatDateRange(rollups.schedule.startDate, rollups.schedule.endDate)} across ${rollups.schedule.taskCount} tasks.`
    : 'No schedule tasks are linked to this branch in the current master schedule extract.';
  const documentSentence = rollups.documents.count
    ? `The branch also carries ${rollups.documents.count} tracked documents that help define or control the work.`
    : 'No controlled documents are currently linked to this branch.';

  if (node.level === 1) {
    return `This is the top-level ${branchLabel} view for Lunar Gateway. ${childSentence} ${riskSentence} ${scheduleSentence} ${documentSentence}`;
  }

  return `This ${branchLabel} covers ${node.name}. In plain terms, ${node.description} ${childSentence} ${riskSentence} ${scheduleSentence} ${documentSentence}`;
}

function buildSectionSummaries(rollups) {
  const costSummary = rollups.cost.totalBaseCost
    ? `Estimated base cost rolls up to ${formatMillions(rollups.cost.totalBaseCost)} with a range of ${formatMillions(rollups.cost.totalLowCost)} to ${formatMillions(rollups.cost.totalHighCost)}.`
    : 'No cost estimate rows are linked to this branch.';
  const riskSummary = rollups.risks.totalCount
    ? `${rollups.risks.activeCount} of ${rollups.risks.totalCount} linked risks are still active. The highest current score is ${rollups.risks.highestScore}.`
    : 'No risks are linked to this branch.';
  const scheduleSummary = rollups.schedule.taskCount
    ? `Linked work spans ${formatDateRange(rollups.schedule.startDate, rollups.schedule.endDate)} with ${rollups.schedule.criticalCount} critical tasks and ${rollups.schedule.milestoneCount} milestones.`
    : 'No schedule tasks are linked to this branch.';
  const documentSummary = rollups.documents.count
    ? `${rollups.documents.count} linked documents are tracked here, across ${rollups.documents.byType.length} document types.`
    : 'No documents are linked to this branch.';

  return {
    cost: costSummary,
    risks: riskSummary,
    schedule: scheduleSummary,
    documents: documentSummary,
  };
}

function uniqueBy(rows, key) {
  const seen = new Set();

  return rows.filter((row) => {
    const value = row[key];
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export async function buildDataset() {
  const [
    rawWbsRows,
    rawCostRows,
    rawRiskRows,
    rawScheduleRows,
    rawMilestoneRows,
    rawDocumentRows,
    rawGlossaryRows,
    rawPhasingRows,
    rawPricingRows,
  ] = await Promise.all(Object.values(dataFiles).map(readCsv));

  const wbsRows = rawWbsRows
    .map((row) => ({
      id: row.wbs_id,
      parentId: row.parent_wbs || null,
      level: toNumber(row.level),
      name: row.element_name,
      responsibleOrg: row.responsible_org,
      description: row.description,
    }))
    .sort((left, right) => compareWbsId(left.id, right.id));

  const costRows = rawCostRows.map((row) => ({
    wbsId: row.wbs_id,
    elementName: row.element_name,
    costType: row.cost_type,
    baseCost: toNumber(row.base_cost),
    lowCost: toNumber(row.low_cost),
    highCost: toNumber(row.high_cost),
    fiscalYear: row.fiscal_year,
    contractor: row.contractor,
    notes: row.notes,
  }));

  const riskRows = rawRiskRows.map((row) => ({
    id: row.risk_id,
    title: row.risk_title,
    description: row.description,
    wbsId: row.wbs_id,
    likelihood: toNumber(row.likelihood),
    consequence: toNumber(row.consequence),
    riskScore: toNumber(row.risk_score),
    mitigation: row.mitigation,
    owner: row.owner,
    status: row.status,
  }));

  const scheduleRows = rawScheduleRows.map((row) => ({
    id: row.task_id,
    name: row.task_name,
    wbsId: row.wbs_id,
    startDate: row.start_date,
    endDate: row.end_date,
    durationDays: toNumber(row.duration_days),
    predecessor: row.predecessor,
    organization: row.organization,
    milestoneFlag: toBoolean(row.milestone_flag),
    criticalFlag: toBoolean(row.critical_flag),
  }));

  const milestoneRows = rawMilestoneRows.map((row) => ({
    id: row.milestone_id,
    name: row.milestone_name,
    date: row.date,
    relatedTask: row.related_task,
    programPhase: row.program_phase,
    notes: row.notes,
  }));

  const documentRows = rawDocumentRows.map((row) => ({
    id: row.doc_id,
    name: row.document_name,
    type: row.document_type,
    owner: row.owner,
    status: row.status,
    version: row.version,
    dueDate: row.due_date,
    relatedWbs: row.related_wbs,
    relatedMilestone: row.related_milestone,
    notes: row.notes,
  }));

  const glossaryRows = rawGlossaryRows.map((row) => ({
    term: row.term,
    acronym: row.acronym,
    definition: row.definition,
    relatedWbs: row.related_wbs,
    relatedArtifact: row.related_artifact,
  }));

  const phasingRows = rawPhasingRows.map((row) => ({
    wbsId: row.wbs_id,
    fy: row.fy,
    laborCost: toNumber(row.labor_cost),
    materialCost: toNumber(row.material_cost),
    integrationCost: toNumber(row.integration_cost),
    totalCost: toNumber(row.total_cost),
  }));

  const pricingRows = rawPricingRows
    .map((row) => ({
      clin: row.clin,
      subclin: row.subclin,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      unitPrice: toNumber(row.unit_price),
      totalPrice: toNumber(row.total_price),
      optionYear: row.option_year,
      wbsId: row.wbs_id,
      notes: row.notes,
    }))
    .filter((row) => row.totalPrice > 0);

  const nodesById = new Map(
    wbsRows.map((row) => [
      row.id,
      {
        id: row.id,
        parentId: row.parentId,
        level: row.level,
        name: row.name,
        responsibleOrg: row.responsibleOrg,
        description: row.description,
        childIds: [],
      },
    ]),
  );

  nodesById.forEach((node) => {
    if (node.parentId && nodesById.has(node.parentId)) {
      nodesById.get(node.parentId).childIds.push(node.id);
    }
  });

  nodesById.forEach((node) => {
    node.childIds.sort(compareWbsId);
  });

  const descendantIdsByNode = new Map();
  const getDescendantIds = (nodeId) => {
    if (descendantIdsByNode.has(nodeId)) {
      return descendantIdsByNode.get(nodeId);
    }

    const node = nodesById.get(nodeId);
    const descendantIds = [];

    for (const childId of node?.childIds || []) {
      descendantIds.push(childId, ...getDescendantIds(childId));
    }

    descendantIdsByNode.set(nodeId, descendantIds);
    return descendantIds;
  };

  const leafIdsByNode = new Map();
  const getLeafIds = (nodeId) => {
    if (leafIdsByNode.has(nodeId)) {
      return leafIdsByNode.get(nodeId);
    }

    const node = nodesById.get(nodeId);
    const leafIds =
      node?.childIds.length > 0 ? node.childIds.flatMap((childId) => getLeafIds(childId)) : nodeId ? [nodeId] : [];

    leafIdsByNode.set(nodeId, leafIds);
    return leafIds;
  };

  const directBaseCostByNodeId = costRows.reduce((map, entry) => {
    map.set(entry.wbsId, (map.get(entry.wbsId) || 0) + entry.baseCost);
    return map;
  }, new Map());
  const directPhasingRowsByNodeId = phasingRows.reduce((map, entry) => {
    const rows = map.get(entry.wbsId) || [];
    rows.push(entry);
    map.set(entry.wbsId, rows);
    return map;
  }, new Map());
  const rootNodeId = wbsRows.find((row) => !row.parentId)?.id || wbsRows[0]?.id || '';
  const effectivePhasingRowsByNode = new Map();
  const getEffectivePhasingRows = (nodeId) => {
    if (effectivePhasingRowsByNode.has(nodeId)) {
      return effectivePhasingRowsByNode.get(nodeId);
    }

    const node = nodesById.get(nodeId);
    const directRows = directPhasingRowsByNodeId.get(nodeId) || [];

    if (!node?.childIds.length) {
      effectivePhasingRowsByNode.set(nodeId, directRows);
      return directRows;
    }

    const childRows = node.childIds.flatMap((childId) => getEffectivePhasingRows(childId));
    if (childRows.length) {
      effectivePhasingRowsByNode.set(nodeId, childRows);
      return childRows;
    }

    const leafIds = getLeafIds(nodeId);
    const totalLeafBaseCost = leafIds.reduce((sum, leafId) => sum + (directBaseCostByNodeId.get(leafId) || 0), 0);
    const distributedRows = totalLeafBaseCost
      ? directRows.flatMap((entry) =>
          leafIds
            .map((leafId) => {
              const share = (directBaseCostByNodeId.get(leafId) || 0) / totalLeafBaseCost;
              if (!share) return null;
              return {
                ...entry,
                wbsId: leafId,
                laborCost: entry.laborCost * share,
                materialCost: entry.materialCost * share,
                integrationCost: entry.integrationCost * share,
                totalCost: entry.totalCost * share,
              };
            })
            .filter(Boolean),
        )
      : [];

    effectivePhasingRowsByNode.set(nodeId, distributedRows);
    return distributedRows;
  };
  const effectivePhasingRows = rootNodeId ? getEffectivePhasingRows(rootNodeId) : [];

  const scheduleById = new Map(scheduleRows.map((row) => [row.id, row]));

  const nodes = wbsRows.map((row) => {
    const node = nodesById.get(row.id);
    const ancestorIds = [];
    let currentParentId = node.parentId;

    while (currentParentId && nodesById.has(currentParentId)) {
      ancestorIds.unshift(currentParentId);
      currentParentId = nodesById.get(currentParentId).parentId;
    }

    const descendantIds = getDescendantIds(node.id);
    const descendantIdSet = new Set(descendantIds);
    const descendants = descendantIds.map((descendantId) => nodesById.get(descendantId)).filter(Boolean);
    const matchesCostRollup =
      node.childIds.length === 0
        ? (entryId) => entryId === node.id
        : (entryId) => descendantIdSet.has(entryId) && nodesById.get(entryId)?.childIds.length === 0;
    const relatedCosts = costRows
      .filter((entry) => matchesCostRollup(entry.wbsId))
      .sort((left, right) => right.baseCost - left.baseCost || compareWbsId(left.wbsId, right.wbsId));
    const relatedRisks = riskRows
      .filter((entry) => sameOrDescendant(entry.wbsId, node.id))
      .sort((left, right) => right.riskScore - left.riskScore || left.id.localeCompare(right.id));
    const relatedTasks = scheduleRows
      .filter((entry) => sameOrDescendant(entry.wbsId, node.id))
      .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id));
    const relatedMilestones = milestoneRows
      .filter((entry) => {
        const relatedTask = scheduleById.get(entry.relatedTask);
        return relatedTask ? sameOrDescendant(relatedTask.wbsId, node.id) : false;
      })
      .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
    const relatedDocuments = documentRows
      .filter((entry) => sameOrDescendant(entry.relatedWbs, node.id))
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id));
    const relatedGlossary = uniqueBy(
      glossaryRows
        .filter((entry) => sameOrDescendant(entry.relatedWbs, node.id))
        .sort((left, right) => left.term.localeCompare(right.term)),
      'term',
    );
    const relatedPhasing = summarizePhasing(effectivePhasingRows.filter((entry) => matchesCostRollup(entry.wbsId)));
    const relatedPricing = pricingRows
      .filter((entry) => sameOrDescendant(entry.wbsId, node.id))
      .sort((left, right) => right.totalPrice - left.totalPrice || left.description.localeCompare(right.description));

    const totalBaseCost = relatedCosts.reduce((sum, entry) => sum + entry.baseCost, 0);
    const totalLowCost = relatedCosts.reduce((sum, entry) => sum + entry.lowCost, 0);
    const totalHighCost = relatedCosts.reduce((sum, entry) => sum + entry.highCost, 0);
    const activeRisks = relatedRisks.filter((entry) => !/closed/i.test(entry.status));
    const criticalTasks = relatedTasks.filter((entry) => entry.criticalFlag);
    const milestoneTasks = relatedTasks.filter((entry) => entry.milestoneFlag);
    const rollups = {
      metrics: {
        directChildrenCount: node.childIds.length,
        descendantCount: descendants.length,
        estimateCount: relatedCosts.length,
        riskCount: relatedRisks.length,
        taskCount: relatedTasks.length,
        documentCount: relatedDocuments.length,
        glossaryCount: relatedGlossary.length,
      },
      cost: {
        totalBaseCost,
        totalLowCost,
        totalHighCost,
        byType: summarizeCostByType(relatedCosts),
        estimates: relatedCosts,
        phasing: relatedPhasing,
        contractHighlights: relatedPricing,
      },
      risks: {
        totalCount: relatedRisks.length,
        activeCount: activeRisks.length,
        highestScore: relatedRisks[0]?.riskScore || 0,
        owners: countValues(relatedRisks, 'owner'),
        byStatus: countValues(relatedRisks, 'status'),
        items: relatedRisks,
      },
      schedule: {
        taskCount: relatedTasks.length,
        criticalCount: criticalTasks.length,
        milestoneCount: relatedMilestones.length || milestoneTasks.length,
        startDate: earliestDate(relatedTasks, 'startDate'),
        endDate: latestDate(relatedTasks, 'endDate'),
        tasks: relatedTasks,
        milestones: relatedMilestones,
      },
      documents: {
        count: relatedDocuments.length,
        byType: countValues(relatedDocuments, 'type'),
        byStatus: countValues(relatedDocuments, 'status'),
        items: relatedDocuments,
      },
      glossary: {
        count: relatedGlossary.length,
        items: relatedGlossary,
      },
    };

    const pathNames = ancestorIds.map((id) => nodesById.get(id)?.name).filter(Boolean);
    pathNames.push(node.name);

    const sectionSummaries = buildSectionSummaries(rollups);
    const plainEnglish = buildPlainEnglish(node, rollups);
    const searchText = [
      node.id,
      node.name,
      node.responsibleOrg,
      node.description,
      plainEnglish,
      ...relatedRisks.map((entry) => `${entry.title} ${entry.owner} ${entry.status}`),
      ...relatedDocuments.map((entry) => `${entry.name} ${entry.type} ${entry.status}`),
      ...relatedTasks.map((entry) => `${entry.name} ${entry.organization}`),
      ...relatedGlossary.map((entry) => `${entry.term} ${entry.acronym} ${entry.definition}`),
    ]
      .join(' ')
      .toLowerCase();

    return {
      id: node.id,
      parentId: node.parentId,
      level: node.level,
      name: node.name,
      responsibleOrg: node.responsibleOrg,
      description: node.description,
      childIds: node.childIds,
      ancestorIds,
      pathNames,
      plainEnglish,
      sectionSummaries,
      metrics: {
        directChildrenCount: rollups.metrics.directChildrenCount,
        descendantCount: rollups.metrics.descendantCount,
        estimateCount: rollups.metrics.estimateCount,
        riskCount: rollups.metrics.riskCount,
        activeRiskCount: rollups.risks.activeCount,
        taskCount: rollups.metrics.taskCount,
        criticalTaskCount: rollups.schedule.criticalCount,
        documentCount: rollups.metrics.documentCount,
        glossaryCount: rollups.metrics.glossaryCount,
      },
      related: rollups,
      searchText,
    };
  });

  const rootNode = nodes[0];

  return {
    generatedAt: new Date().toISOString(),
    rootId: rootNode?.id || '',
    defaultExpandedIds: nodes.filter((node) => node.level <= 2).map((node) => node.id),
    app: {
      title: 'Gateway WBS Explorer',
      subtitle:
        'Browse the full Lunar Gateway work breakdown structure and see how each branch connects to cost, risks, schedule, and controlled documents.',
      sourceNote:
        'The browser reads one preprocessed JSON payload from the local WBS server. The original simulation files and source CSVs stay untouched.',
    },
    overview: {
      totalNodes: nodes.length,
      totalBaseCost: rootNode?.related.cost.totalBaseCost || 0,
      totalRisks: rootNode?.related.risks.totalCount || 0,
      activeRisks: rootNode?.related.risks.activeCount || 0,
      totalTasks: rootNode?.related.schedule.taskCount || 0,
      criticalTasks: rootNode?.related.schedule.criticalCount || 0,
      totalDocuments: rootNode?.related.documents.count || 0,
      scheduleSpan: formatDateRange(
        rootNode?.related.schedule.startDate || '',
        rootNode?.related.schedule.endDate || '',
      ),
    },
    nodes,
  };
}

async function sendJson(response, data) {
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(data, null, 2));
}

async function sendStaticFile(response, requestedPath) {
  const relativePath = requestedPath === '/' ? '/index.html' : requestedPath;
  const safePath = path.resolve(repoRoot, `.${relativePath}`);

  if (!safePath.startsWith(repoRoot)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  let filePath = safePath;

  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  try {
    const fileContents = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    });
    response.end(fileContents);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Unable to read file: ${error.message}`);
  }
}

async function sendFile(response, absolutePath) {
  const extension = path.extname(absolutePath).toLowerCase();
  const fileContents = await fs.readFile(absolutePath);
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
  });
  response.end(fileContents);
}

function notFound(response) {
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${host}:${port}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === '/simulation' || pathname === '/simulation/') {
    await sendStaticFile(response, '/index.html');
    return;
  }

  if (pathname.startsWith('/suite-assets/')) {
    const absolutePath = path.resolve(repoRoot, `.${pathname}`);
    if (!absolutePath.startsWith(path.join(repoRoot, 'suite-assets'))) {
      notFound(response);
      return;
    }
    await sendFile(response, absolutePath);
    return;
  }

  if (pathname === '/wbs' || pathname === '/wbs/') {
    await sendStaticFile(response, '/wbs/index.html');
    return;
  }

  if (pathname === '/wbs/data/gateway-wbs.json') {
    try {
      const dataset = JSON.parse(await fs.readFile(staticDatasetPath, 'utf8'));
      await sendJson(response, dataset);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify(
          {
            error: 'Failed to load WBS dataset',
            details: error.message,
          },
          null,
          2,
        ),
      );
    }
    return;
  }

  await sendStaticFile(response, pathname);
});

if (isDirectRun) {
  server.listen(port, host, () => {
    console.log(`Gateway WBS server running at http://${host}:${port}/wbs/`);
  });
}
