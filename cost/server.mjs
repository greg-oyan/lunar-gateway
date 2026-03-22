import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4273);

const dataFiles = {
  estimate: 'Contract_Cost_Schedule Documents/data/gateway_cost_estimate.csv',
  phasing: 'Contract_Cost_Schedule Documents/data/gateway_cost_phasing.csv',
  detail: 'Contract_Cost_Schedule Documents/data/gateway_cost_estimate_detail.csv',
  pricing: 'Contract_Cost_Schedule Documents/data/gateway_section_b_pricing.csv',
  sources: 'Contract_Cost_Schedule Documents/data/gateway_source_reference_register.csv',
  masterSchedule: 'Contract_Cost_Schedule Documents/data/gateway_master_schedule.csv',
  costBasis: 'Contract_Cost_Schedule Documents/docs/gateway_cost_basis_of_estimate.rtf',
  authorityGuide: 'Contract_Cost_Schedule Documents/docs/gateway_data_authority_guide.rtf',
  card: 'Contract_Cost_Schedule Documents/docs/gateway_CARD.rtf',
  wbsDictionary: 'Contract_Cost_Schedule Documents/docs/gateway_wbs_dictionary.rtf',
};

const exposedArtifacts = {
  'gateway_cost_estimate.csv': dataFiles.estimate,
  'gateway_cost_phasing.csv': dataFiles.phasing,
  'gateway_cost_estimate_detail.csv': dataFiles.detail,
  'gateway_section_b_pricing.csv': dataFiles.pricing,
  'gateway_source_reference_register.csv': dataFiles.sources,
  'gateway_master_schedule.csv': dataFiles.masterSchedule,
  'gateway_cost_basis_of_estimate.rtf': dataFiles.costBasis,
  'gateway_data_authority_guide.rtf': dataFiles.authorityGuide,
  'gateway_CARD.rtf': dataFiles.card,
  'gateway_wbs_dictionary.rtf': dataFiles.wbsDictionary,
};

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain; charset=utf-8',
};

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function splitIds(value) {
  return normalizeText(value)
    .split(';')
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function getWbsDepth(wbsId) {
  const parts = String(wbsId).split('.');
  if (parts.length === 2 && parts[1] === '0') return 0;
  return Math.max(0, parts.length - 1);
}

function getParentWbsId(wbsId) {
  const parts = String(wbsId).split('.');
  if (parts.length < 2) return null;
  if (parts.length === 2) {
    return parts[1] === '0' ? null : `${parts[0]}.0`;
  }
  return parts.slice(0, -1).join('.');
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
  if (!rows.length) return [];

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

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
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

function sameOrDescendant(candidateId, nodeId) {
  return candidateId === nodeId || String(candidateId).startsWith(`${nodeId}.`);
}

function titleCase(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function cleanDetailName(value) {
  const normalized = normalizeText(value)
    .replace(/\.ToLower\(\)/gi, '')
    .replace(/_/g, ' ');
  return normalized === normalized.toUpperCase() ? titleCase(normalized) : normalized;
}

function sanitizeRtfText(rtf) {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\tab/g, ' ')
    .replace(/\\'[0-9a-fA-F]{2}/g, '')
    .replace(/\\u-?\d+\??/g, '')
    .replace(/\\[a-z]+\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join('\n');
}

function summarizeText(text, sentenceCount = 2) {
  const sentences = normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return sentences.slice(0, sentenceCount).join(' ');
}

function formatFyRange(startFy, endFy) {
  if (!startFy && !endFy) return 'Timing not stated';
  if (startFy === endFy || !endFy) return `FY${startFy}`;
  return `FY${startFy} to FY${endFy}`;
}

function scopeLabel(scope) {
  switch (scope) {
    case 'program_reference_partner_value':
      return 'Partner reference';
    case 'program_reference_total':
      return 'Program total';
    default:
      return 'NASA-led scope';
  }
}

function basisLabel(basisType) {
  switch (basisType) {
    case 'direct_contract_plus_program_estimate':
      return 'Direct contract plus estimate';
    case 'partner_reference_plus_integration_estimate':
      return 'Partner reference plus integration estimate';
    case 'engineering_build_up_and_schedule_phased':
      return 'Engineering build-up and schedule phasing';
    case 'facility_test_build_up':
      return 'Facility and test build-up';
    case 'launch_service_and_campaign_estimate':
      return 'Launch services and campaign estimate';
    case 'management_reserve_planning_allocation':
      return 'Management reserve planning allocation';
    case 'program_rollup_with_explicit_reserve':
      return 'Program rollup with explicit reserve';
    default:
      return 'Program estimate';
  }
}

const sourceRowOverrides = {
  'WEB-001': {
    title: 'NASA Awards Artemis Contract for Lunar Gateway Power, Propulsion',
    publisher: 'NASA',
    pub_date: '2019-05-23',
    authority_tier: 'authoritative_public',
    source_type: 'news_release',
    location:
      'https://www.nasa.gov/news-release/nasa-awards-artemis-contract-for-lunar-gateway-power-propulsion/',
    relevance: 'PPE contract value, contract type, and option structure',
    notes: 'Direct source for the Maxar PPE award and associated pricing basis.',
  },
  'WEB-003': {
    title: 'NASA, Northrop Grumman Finalize Moon Outpost Living Quarters Contract',
    publisher: 'NASA',
    pub_date: '2021-07-09',
    authority_tier: 'authoritative_public',
    source_type: 'news_release',
    location:
      'https://www.nasa.gov/news-release/nasa-northrop-grumman-finalize-moon-outpost-living-quarters-contract/',
    relevance: 'HALO fabrication and integration contract value and launch-prep scope',
    notes:
      'Direct source for the HALO firm-fixed-price fabrication and integration award.',
  },
  'WEB-005': {
    title: 'NASA, United Arab Emirates Announce Artemis Lunar Gateway Airlock',
    publisher: 'NASA',
    pub_date: '2024-01-07',
    authority_tier: 'authoritative_public',
    source_type: 'news_release',
    location:
      'https://www.nasa.gov/news-release/nasa-united-arab-emirates-announce-artemis-lunar-gateway-airlock/',
    relevance: 'Formal announcement of the UAE Crew and Science Airlock contribution',
    notes: 'Used to support airlock scope and contribution ownership.',
  },
};

function normalizeSourceRow(row) {
  const sourceId = normalizeText(row.source_id);
  const normalized = {
    source_id: sourceId,
    title: normalizeText(row.title),
    publisher: normalizeText(row.publisher),
    pub_date: normalizeText(row.pub_date),
    authority_tier: normalizeText(row.authority_tier),
    source_type: normalizeText(row.source_type),
    location: normalizeText(row.location),
    relevance: normalizeText(row.relevance),
    notes: normalizeText(row.notes),
  };

  if (Object.prototype.hasOwnProperty.call(sourceRowOverrides, sourceId)) {
    return {
      ...normalized,
      ...sourceRowOverrides[sourceId],
    };
  }

  return normalized;
}

function buildLocalSourceHref(location) {
  if (!location || /^https?:/i.test(location)) return null;
  const fileName = path.basename(location);
  return Object.prototype.hasOwnProperty.call(exposedArtifacts, fileName)
    ? `/cost/source/${fileName}`
    : null;
}

function buildDataset({
  rawEstimateRows,
  rawPhasingRows,
  rawDetailRows,
  rawPricingRows,
  rawSourceRows,
  costBasisText,
  authorityGuideText,
}) {
  const normalizedSourceRows = rawSourceRows.map(normalizeSourceRow);
  const sourcesById = new Map(
    normalizedSourceRows.map((row) => [
      row.source_id,
      {
        id: row.source_id,
        title: row.title,
        publisher: row.publisher,
        pubDate: row.pub_date,
        authorityTier: row.authority_tier,
        sourceType: row.source_type,
        location: row.location,
        relevance: row.relevance,
        notes: row.notes,
        localHref: buildLocalSourceHref(row.location),
        externalHref: /^https?:/i.test(row.location) ? row.location : null,
        linkedCategoryIds: [],
        linkedCount: 0,
      },
    ]),
  );

  const categories = rawEstimateRows.map((row) => ({
    id: row.wbs_id,
    parentId: getParentWbsId(row.wbs_id),
    level: getWbsDepth(row.wbs_id),
    name: row.element_name,
    costType: row.cost_type,
    baseUsd: toNumber(row.base_cost_usd),
    lowUsd: toNumber(row.low_cost_usd),
    highUsd: toNumber(row.high_cost_usd),
    legacyBaseMusd: toNumber(row.base_cost),
    contractor: row.contractor,
    notes: row.notes,
    startFy: row.start_fy,
    endFy: row.end_fy,
    scope: row.cost_scope,
    scopeLabel: scopeLabel(row.cost_scope),
    basisType: row.basis_type,
    basisLabel: basisLabel(row.basis_type),
    confidenceLevel: row.confidence_level,
    methodologyNote: row.methodology_note,
    traceabilityNote: row.traceability_note,
    sourceIds: splitIds(row.source_id),
    childIds: [],
  }));

  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  categories.forEach((category) => {
    if (category.parentId && categoriesById.has(category.parentId)) {
      categoriesById.get(category.parentId).childIds.push(category.id);
    }
    category.sourceIds.forEach((sourceId) => {
      if (!sourcesById.has(sourceId)) return;
      const source = sourcesById.get(sourceId);
      if (!source.linkedCategoryIds.includes(category.id)) {
        source.linkedCategoryIds.push(category.id);
      }
    });
  });
  categories.forEach((category) => category.childIds.sort(compareWbsId));

  const phasingRows = rawPhasingRows.map((row) => ({
    wbsId: row.wbs_id,
    fy: row.fy,
    laborUsd: toNumber(row.labor_cost_usd),
    materialUsd: toNumber(row.material_cost_usd),
    integrationUsd: toNumber(row.integration_cost_usd),
    totalUsd: toNumber(row.total_cost_usd),
  }));

  const detailRows = rawDetailRows.map((row) => ({
    id: row.detail_id,
    parentId: row.parent_detail_id,
    wbsId: row.wbs_id,
    detailLevel: toNumber(row.detail_level),
    name: cleanDetailName(row.detail_name),
    fy: row.fy,
    component: normalizeText(row.cost_component).toLowerCase(),
    amountUsd: toNumber(row.amount_usd),
    amountMusd: toNumber(row.amount_musd),
    sourceIds: splitIds(row.source_id),
    basisType: row.basis_type,
    traceabilityNote: row.traceability_note,
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
      contractType: row.contract_type,
      pricingBasis: row.pricing_basis,
      costScope: row.cost_scope,
      sourceIds: splitIds(row.source_id),
      traceabilityNote: row.traceability_note,
    }))
    .filter((row) => row.totalPrice > 0);

  const rootCategory = categoriesById.get('1.0');
  const topCategories = categories
    .filter((category) => category.level === 1)
    .sort((left, right) => right.baseUsd - left.baseUsd || compareWbsId(left.id, right.id));

  const reserveByFy = new Map();
  detailRows
    .filter((row) => row.wbsId === '1.0' && row.detailLevel === 3 && row.fy)
    .forEach((row) => {
      reserveByFy.set(row.fy, (reserveByFy.get(row.fy) || 0) + row.amountUsd);
    });

  const phasingByCategory = new Map();
  phasingRows.forEach((row) => {
    phasingByCategory.set(`${row.wbsId}::${row.fy}`, row);
  });

  const allYears = Array.from(
    new Set([...phasingRows.map((row) => row.fy), ...reserveByFy.keys()]),
  ).sort((left, right) => left.localeCompare(right));

  const yearlyTotals = allYears.map((fy) => {
    const directRows = phasingRows.filter((row) => row.fy === fy);
    const directUsd = directRows.reduce((sum, row) => sum + row.totalUsd, 0);
    const reserveUsd = reserveByFy.get(fy) || 0;
    const topBreakdown = topCategories
      .map((category) => {
        const phasing = phasingByCategory.get(`${category.id}::${fy}`);
        return {
          id: category.id,
          name: category.name,
          totalUsd: phasing?.totalUsd || 0,
          scope: category.scope,
          scopeLabel: category.scopeLabel,
        };
      })
      .filter((entry) => entry.totalUsd > 0)
      .sort((left, right) => right.totalUsd - left.totalUsd);

    const driverNames = topBreakdown.slice(0, 2).map((entry) => entry.name);
    const reserveSentence = reserveUsd
      ? ` Reserve adds ${reserveUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} in this year.`
      : '';

    return {
      fy,
      directUsd,
      reserveUsd,
      totalUsd: directUsd + reserveUsd,
      laborUsd: directRows.reduce((sum, row) => sum + row.laborUsd, 0),
      materialUsd: directRows.reduce((sum, row) => sum + row.materialUsd, 0),
      integrationUsd: directRows.reduce((sum, row) => sum + row.integrationUsd, 0),
      topBreakdown,
      narrative: driverNames.length
        ? `${fy} is driven most by ${driverNames.join(' and ')}.${reserveSentence}`.trim()
        : `${fy} has no direct cost phasing in the current authority set.`,
    };
  });

  const maxYearTotalUsd = yearlyTotals.reduce((max, year) => Math.max(max, year.totalUsd), 0);

  const categoryPayload = categories.map((category) => {
    const children = category.childIds
      .map((childId) => categoriesById.get(childId))
      .filter(Boolean)
      .sort((left, right) => right.baseUsd - left.baseUsd || compareWbsId(left.id, right.id));

    const yearly = category.id === '1.0'
      ? yearlyTotals.map((year) => ({ fy: year.fy, totalUsd: year.totalUsd }))
      : yearlyTotals.map((year) => ({
          fy: year.fy,
          totalUsd: phasingByCategory.get(`${category.id}::${year.fy}`)?.totalUsd || 0,
        }));

    const componentTotals = detailRows
      .filter((row) => row.wbsId === category.id && row.detailLevel === 2)
      .map((row) => ({
        component: row.component,
        label: titleCase(row.component),
        amountUsd: row.amountUsd,
      }))
      .sort((left, right) => right.amountUsd - left.amountUsd);

    const representativeDetails = detailRows
      .filter((row) => row.wbsId === category.id && row.detailLevel === 3 && row.amountUsd > 0)
      .sort((left, right) => right.amountUsd - left.amountUsd)
      .slice(0, 6)
      .map((row) => ({
        id: row.id,
        name: row.name,
        fy: row.fy,
        component: row.component,
        amountUsd: row.amountUsd,
        sourceIds: row.sourceIds,
        traceabilityNote: row.traceabilityNote,
      }));

    const pricedLines = pricingRows
      .filter((row) => sameOrDescendant(row.wbsId, category.id))
      .sort((left, right) => right.totalPrice - left.totalPrice || left.description.localeCompare(right.description))
      .slice(0, 6)
      .map((row) => ({
        id: [row.clin, row.subclin].filter(Boolean).join('-'),
        description: row.description,
        totalUsd: row.totalPrice,
        contractType: row.contractType,
        optionYear: row.optionYear,
        sourceIds: row.sourceIds,
        notes: row.notes,
      }));

    const linkedSources = category.sourceIds
      .map((sourceId) => sourcesById.get(sourceId))
      .filter(Boolean)
      .map((source) => ({
        id: source.id,
        title: source.title,
        publisher: source.publisher,
        authorityTier: source.authorityTier,
        href: source.externalHref || source.localHref,
      }));

    const nonZeroYears = yearly.filter((entry) => entry.totalUsd > 0).sort((left, right) => right.totalUsd - left.totalUsd);
    const topYear = nonZeroYears[0];
    const shareOfProgram = rootCategory?.baseUsd ? category.baseUsd / rootCategory.baseUsd : 0;

    const meaning = category.id === '1.0'
      ? 'This is the full program-reference rollup for the Cost Explorer.'
      : summarizeText(category.notes || category.methodologyNote, 2);
    const includedNote = category.scope === 'program_reference_partner_value'
      ? 'This bucket is carried as a partner reference value for ecosystem completeness, not as NASA budget authority.'
      : 'This bucket sits inside the NASA-led portion of the program-reference estimate.';
    const judgmentNote = category.basisType.includes('schedule') || category.basisType.includes('estimate')
      ? 'Some timing, subsystem, or campaign allocation remains modeled rather than directly priced.'
      : 'This bucket is anchored by direct awards or explicit reserve treatment, then supplemented with program estimating logic.';

    return {
      ...category,
      shareOfProgram,
      timeframeLabel: formatFyRange(category.startFy, category.endFy),
      meaning,
      includedNote,
      judgmentNote,
      topYear: topYear ? { fy: topYear.fy, totalUsd: topYear.totalUsd } : null,
      yearly,
      componentTotals,
      representativeDetails,
      pricedLines,
      linkedSources,
      children: children.map((child) => ({
        id: child.id,
        name: child.name,
        baseUsd: child.baseUsd,
        lowUsd: child.lowUsd,
        highUsd: child.highUsd,
        scopeLabel: child.scopeLabel,
        basisLabel: child.basisLabel,
        confidenceLevel: child.confidenceLevel,
      })),
    };
  });

  const categoryPayloadById = new Map(categoryPayload.map((category) => [category.id, category]));
  const partnerReferenceUsd = topCategories
    .filter((category) => category.scope === 'program_reference_partner_value')
    .reduce((sum, category) => sum + category.baseUsd, 0);
  const pricedEvidenceUsd = pricingRows.reduce((sum, row) => sum + row.totalPrice, 0);
  const reserveUsd = detailRows
    .filter((row) => row.wbsId === '1.0' && row.detailLevel === 2)
    .reduce((sum, row) => sum + row.amountUsd, 0);

  const overview = {
    totalCostUsd: rootCategory?.baseUsd || 0,
    lowCostUsd: rootCategory?.lowUsd || 0,
    highCostUsd: rootCategory?.highUsd || 0,
    startFy: rootCategory?.startFy || '',
    endFy: rootCategory?.endFy || '',
    includedSummary:
      'The headline estimate is a program-reference current-cost view through FY2033. It includes NASA-led program cost and clearly flagged partner reference values where those help explain the full Gateway ecosystem.',
    judgmentSummary:
      'Annual burn plans, some subsystem splits, and reserve placement still require schedule-weighted or allocation-based judgment where no direct public burn profile exists.',
    directSummary:
      `${pricingRows.length} priced line items and multiple public award or oversight sources anchor the estimate before modeled phasing and allocation logic are applied.`,
    signals: [
      { label: 'Estimate span', value: `FY${rootCategory?.startFy || ''}-FY${rootCategory?.endFy || ''}` },
      {
        label: 'Explicit reserve',
        value: reserveUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
      },
      { label: 'Priced evidence', value: `${pricingRows.length} line items` },
      {
        label: 'Partner reference',
        value: partnerReferenceUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
      },
    ],
    majorDrivers: topCategories.slice(0, 4).map((category, index) => ({
      id: category.id,
      rank: index + 1,
      name: category.name,
      totalUsd: category.baseUsd,
      shareOfProgram: rootCategory?.baseUsd ? category.baseUsd / rootCategory.baseUsd : 0,
      scopeLabel: category.scopeLabel,
      basisLabel: category.basisLabel,
      meaning: categoryPayloadById.get(category.id)?.meaning || category.notes,
    })),
    busiestYear: yearlyTotals.reduce((best, year) => (year.totalUsd > (best?.totalUsd || 0) ? year : best), null),
  };

  const methodologyCards = [
    {
      id: 'included',
      eyebrow: 'Included Scope',
      title: 'What the estimate includes',
      summary:
        'The rebuilt cost layer keeps the CARD as the NASA-accountable baseline, then adds clearly flagged partner reference values where the ecosystem story would otherwise be incomplete.',
      items: [
        'Program-reference current cost is used for structural understanding and app-facing rollups.',
        'Partner contribution rows are labeled as reference values rather than NASA budget authority.',
        'The headline total spans FY2020 through FY2033.',
      ],
      sourceArtifact: '/cost/source/gateway_cost_basis_of_estimate.rtf',
    },
    {
      id: 'methods',
      eyebrow: 'Build Method',
      title: 'How the estimate is built',
      summary:
        'Level-2 buckets reconcile to annual phasing, while level-3 rows preserve technical weighting under each parent. This keeps the estimate readable while still tying back to time-phased authority data.',
      items: [
        'Current-cost rollups are reconciled to summed annual phasing.',
        'Schedule timing drives the phasing profile where no public burn plan exists.',
        'Subsystem rows remain weighted allocations unless priced evidence or direct sourcing is available.',
      ],
      sourceArtifact: '/cost/source/gateway_cost_basis_of_estimate.rtf',
    },
    {
      id: 'reserve',
      eyebrow: 'Reserve Logic',
      title: 'Reserve treatment is explicit',
      summary:
        'Reserve is not buried inside every subsystem. It is visible as estimation uncertainty, schedule recovery, and mass-reduction reserve so the user can see where management judgment enters the estimate.',
      items: detailRows
        .filter((row) => row.wbsId === '1.0' && row.detailLevel === 2)
        .map(
          (row) =>
            `${row.name}: ${row.amountUsd.toLocaleString('en-US', {
              style: 'currency',
              currency: 'USD',
              maximumFractionDigits: 0,
            })}`,
        ),
      sourceArtifact: '/cost/source/gateway_cost_estimate_detail.csv',
    },
    {
      id: 'judgment',
      eyebrow: 'Judgment Areas',
      title: 'Where judgment still remains',
      summary:
        'The authority layer now says clearly what is directly sourced, what is priced, what is partner reference, and what still relies on allocation or schedule judgment.',
      items: [
        'Public award values rarely provide a year-by-year burn plan.',
        'Partner contribution values remain reference values rather than appropriated NASA budget lines.',
        'Reserve annual placement is a management planning judgment informed by risk timing.',
      ],
      sourceArtifact: '/cost/source/gateway_cost_basis_of_estimate.rtf',
    },
    {
      id: 'authority',
      eyebrow: 'Authority Discipline',
      title: 'How traceability is enforced',
      summary:
        'The authority guide makes the evidence model visible: source IDs, authority tiers, basis types, and clearly labeled judgment where a public fact does not exist.',
      items: [
        'Risk, milestone, and document artifacts now carry explicit authority cues.',
        'The source register centralizes internal and public references.',
        'The Cost Explorer surfaces evidence after meaning, not instead of meaning.',
      ],
      sourceArtifact: '/cost/source/gateway_data_authority_guide.rtf',
    },
  ];

  const artifacts = [
    {
      id: 'gateway_cost_estimate.csv',
      title: 'Cost estimate rollup',
      type: 'CSV',
      href: '/cost/source/gateway_cost_estimate.csv',
      description: 'Current-cost rollup by WBS with uncertainty ranges, basis types, source IDs, and explicit-dollar companions.',
      tags: ['Rollup', 'Authority data'],
    },
    {
      id: 'gateway_cost_phasing.csv',
      title: 'Annual cost phasing',
      type: 'CSV',
      href: '/cost/source/gateway_cost_phasing.csv',
      description: 'Year-by-year current-cost values with labor, material, integration, and traceability metadata.',
      tags: ['By year', 'Current dollars'],
    },
    {
      id: 'gateway_cost_estimate_detail.csv',
      title: 'Grouped cost detail',
      type: 'CSV',
      href: '/cost/source/gateway_cost_estimate_detail.csv',
      description: 'Grouped bridge from WBS total to cost component to fiscal year, including explicit reserve detail.',
      tags: ['Drilldown', 'Reserve'],
    },
    {
      id: 'gateway_section_b_pricing.csv',
      title: 'Priced line evidence',
      type: 'CSV',
      href: '/cost/source/gateway_section_b_pricing.csv',
      description: 'Direct priced lines that anchor portions of the estimate with CLIN-level evidence.',
      tags: ['Direct evidence', 'Pricing'],
    },
    {
      id: 'gateway_source_reference_register.csv',
      title: 'Source reference register',
      type: 'CSV',
      href: '/cost/source/gateway_source_reference_register.csv',
      description: 'Internal and public source register used to support the rebuilt authority layer.',
      tags: ['Sources', 'Traceability'],
    },
    {
      id: 'gateway_cost_basis_of_estimate.rtf',
      title: 'Cost basis of estimate',
      type: 'RTF',
      href: '/cost/source/gateway_cost_basis_of_estimate.rtf',
      description: 'Narrative explanation of scope, annual phasing logic, reserve treatment, and remaining judgment.',
      tags: ['Methodology', 'Authority doc'],
    },
    {
      id: 'gateway_data_authority_guide.rtf',
      title: 'Data authority guide',
      type: 'RTF',
      href: '/cost/source/gateway_data_authority_guide.rtf',
      description: 'Explains how source IDs, authority tiers, and supporting artifacts are meant to be read.',
      tags: ['Traceability', 'Authority doc'],
    },
  ];

  const sourceList = Array.from(sourcesById.values())
    .map((source) => ({
      ...source,
      linkedCount: source.linkedCategoryIds.length,
      linkedCategoryNames: source.linkedCategoryIds
        .map((categoryId) => categoriesById.get(categoryId)?.name)
        .filter(Boolean)
        .slice(0, 4),
      href: source.externalHref || source.localHref,
    }))
    .sort((left, right) => right.linkedCount - left.linkedCount || left.id.localeCompare(right.id));

  const traceability = {
    summary:
      'This estimate is strongest when the reader can distinguish direct priced evidence, direct public sourcing, partner reference values, and modeled allocation. The app makes those distinctions visible instead of flattening them.',
    evidenceGroups: [
      {
        title: 'Direct priced lines',
        value: pricingRows.length,
        label: 'priced lines',
        note: `${pricedEvidenceUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} of direct priced evidence is available in the authority set.`,
        tone: 'brand',
      },
      {
        title: 'Public source anchors',
        value: sourceList.filter((source) => source.authorityTier === 'authoritative_public').length,
        label: 'public sources',
        note: 'NASA, GAO, and CSA sources anchor awards, oversight findings, and program framing.',
        tone: 'copper',
      },
      {
        title: 'Partner reference buckets',
        value: topCategories.filter((category) => category.scope === 'program_reference_partner_value').length,
        label: 'major buckets',
        note: 'These are clearly labeled as reference values to avoid implying NASA budget authority where that would be misleading.',
        tone: 'forest',
      },
      {
        title: 'Judgment visible',
        value: methodologyCards[3].items.length,
        label: 'judgment cues',
        note: 'Allocation, phasing, and reserve logic are surfaced explicitly rather than hidden in a spreadsheet note.',
        tone: 'plum',
      },
    ],
    artifacts,
    sources: sourceList,
  };

  return {
    generatedAt: new Date().toISOString(),
    app: {
      title: 'Gateway Cost Explorer',
      subtitle:
        'This is where the program cost comes from, how it is distributed over time, and why the estimate looks the way it does.',
      storyLine: 'Meaning first. Numbers second. Evidence third.',
      sourceNote:
        'The Cost Explorer reads a single preprocessed JSON payload from the local cost server and links back to the rebuilt authority-side source files.',
    },
    overview,
    years: yearlyTotals,
    maxYearTotalUsd,
    topCategoryIds: topCategories.map((category) => category.id),
    defaultSelection: {
      type: 'category',
      id: overview.majorDrivers[0]?.id || topCategories[0]?.id || '1.0',
      defaultYear: overview.busiestYear?.fy || yearlyTotals[0]?.fy || '',
    },
    categories: categoryPayload,
    methodology: {
      summary:
        'The method layer is part of the product, not a footnote. Assumptions, rollup logic, reserve treatment, and remaining judgment are all visible because that is what makes the estimate presentation-grade and defensible.',
      cards: methodologyCards,
      costBasisExcerpt: summarizeText(costBasisText, 5),
      authorityGuideExcerpt: summarizeText(authorityGuideText, 4),
    },
    traceability,
  };
}

let cachedDataset = null;
let cachedGeneratedAt = 0;

async function getDataset() {
  const now = Date.now();
  if (cachedDataset && now - cachedGeneratedAt < 1000) return cachedDataset;

  const [
    rawEstimateRows,
    rawPhasingRows,
    rawDetailRows,
    rawPricingRows,
    rawSourceRows,
    rawCostBasisRtf,
    rawAuthorityGuideRtf,
  ] = await Promise.all([
    readCsv(dataFiles.estimate),
    readCsv(dataFiles.phasing),
    readCsv(dataFiles.detail),
    readCsv(dataFiles.pricing),
    readCsv(dataFiles.sources),
    readText(dataFiles.costBasis),
    readText(dataFiles.authorityGuide),
  ]);

  cachedDataset = buildDataset({
    rawEstimateRows,
    rawPhasingRows,
    rawDetailRows,
    rawPricingRows,
    rawSourceRows,
    costBasisText: sanitizeRtfText(rawCostBasisRtf),
    authorityGuideText: sanitizeRtfText(rawAuthorityGuideRtf),
  });
  cachedGeneratedAt = now;
  return cachedDataset;
}

async function sendFile(response, absolutePath) {
  const extension = path.extname(absolutePath).toLowerCase();
  const mimeType = mimeTypes[extension] || 'application/octet-stream';
  const contents = await fs.readFile(absolutePath);
  response.writeHead(200, { 'Content-Type': mimeType });
  response.end(contents);
}

function notFound(response) {
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${host}:${port}`);
    const pathname = url.pathname;

    if (pathname === '/index.html' || pathname === '/simulation' || pathname === '/simulation/') {
      await sendFile(response, path.join(repoRoot, 'index.html'));
      return;
    }

    if (pathname === '/') {
      response.writeHead(302, { Location: '/cost/' });
      response.end();
      return;
    }

    if (pathname === '/cost/data/gateway-cost.json') {
      const dataset = await getDataset();
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(dataset));
      return;
    }

    if (pathname.startsWith('/cost/source/')) {
      const fileName = pathname.replace('/cost/source/', '');
      if (!Object.prototype.hasOwnProperty.call(exposedArtifacts, fileName)) {
        notFound(response);
        return;
      }
      await sendFile(response, path.join(repoRoot, exposedArtifacts[fileName]));
      return;
    }

    if (pathname === '/cost/' || pathname.startsWith('/cost/')) {
      const relativePath = pathname === '/cost/' ? 'index.html' : pathname.replace('/cost/', '');
      const absolutePath = path.join(currentDir, relativePath);
      if (!absolutePath.startsWith(currentDir)) {
        notFound(response);
        return;
      }
      await sendFile(response, absolutePath);
      return;
    }

    notFound(response);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Server error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

server.listen(port, host, () => {
  console.log(`Gateway Cost Explorer running at http://${host}:${port}/cost/`);
});
