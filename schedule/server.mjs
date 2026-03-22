import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4373);

const dataFiles = {
  milestones: 'Contract_Cost_Schedule Documents/data/gateway_milestones.csv',
  masterSchedule: 'Contract_Cost_Schedule Documents/data/gateway_master_schedule.csv',
  risks: 'Contract_Cost_Schedule Documents/data/gateway_risk_register.csv',
  documents: 'Contract_Cost_Schedule Documents/data/gateway_contract_documents_tracker.csv',
  sources: 'Contract_Cost_Schedule Documents/data/gateway_source_reference_register.csv',
  authorityGuide: 'Contract_Cost_Schedule Documents/docs/gateway_data_authority_guide.rtf',
};

const exposedArtifacts = {
  'gateway_milestones.csv': dataFiles.milestones,
  'gateway_master_schedule.csv': dataFiles.masterSchedule,
  'gateway_risk_register.csv': dataFiles.risks,
  'gateway_contract_documents_tracker.csv': dataFiles.documents,
  'gateway_source_reference_register.csv': dataFiles.sources,
  'gateway_data_authority_guide.rtf': dataFiles.authorityGuide,
};

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.rtf': 'application/rtf',
};

const phaseNarratives = {
  Formulation: {
    id: 'phase-formulation',
    tone: 'brand',
    summaryTitle: 'Architecture and baseline definition',
    summary:
      'Gateway moves from congressional direction into requirements, architecture studies, and the system definition that later hardware branches inherit.',
    whyItMatters:
      'This phase defines the mission logic and technical backbone that every later contract, integration date, and launch commitment depends on.',
    takeaways: [
      'Requirements and system definition create the baseline that later reviews and contracts must satisfy.',
      'Without this phase, later schedule commitments would read like isolated dates instead of a coherent program.',
    ],
  },
  Development: {
    id: 'phase-development',
    tone: 'copper',
    summaryTitle: 'Contracts, design gates, and partner commitments',
    summary:
      'Major hardware awards, preliminary design, critical design, and program-baseline approval turn Gateway from concept into committed execution.',
    whyItMatters:
      'This is where the schedule becomes programmatic: contracts are placed, designs mature, and the formal PCA baseline locks the program timeline.',
    takeaways: [
      'The development phase carries most of the schedule-defining design gates and partner commitments.',
      'Later integration pressure usually traces back to whether this phase closed requirements, mass, and interface logic cleanly.',
    ],
  },
  Fabrication: {
    id: 'phase-fabrication',
    tone: 'forest',
    summaryTitle: 'Hardware becomes flight articles',
    summary:
      'The schedule shifts from design intent to real hardware delivery, with the first flight articles moving toward integrated assembly.',
    whyItMatters:
      'Fabrication converts paper maturity into physical readiness. Once hardware is late here, the whole integration branch starts to compress.',
    takeaways: [
      'Flight article delivery dates are the handoff from isolated module work into integrated schedule pressure.',
      'This phase is where design maturity has to prove itself in hardware form.',
    ],
  },
  Integration: {
    id: 'phase-integration',
    tone: 'plum',
    summaryTitle: 'Separate hardware branches converge',
    summary:
      'PPE, HALO, and linked partner hardware come together through mechanical mate, integrated test, and pre-shipment closeout.',
    whyItMatters:
      'Integration is the first moment where separate branches must succeed together. Delays here immediately threaten launch readiness.',
    takeaways: [
      'Integrated test exposes schedule coupling that is easy to miss when looking only at separate module plans.',
      'Mass, interfaces, and late partner deliveries all become visible here at once.',
    ],
  },
  Test: {
    id: 'phase-test',
    tone: 'brand',
    summaryTitle: 'Environmental qualification before launch',
    summary:
      'Environmental campaigns and final verification close the evidence chain needed to ship the launch stack.',
    whyItMatters:
      'These tests are not background activity. They are the hard proof gates before shipment, launch processing, and formal readiness review.',
    takeaways: [
      'Test completion dates are evidence-based gates, not just schedule decorations.',
      'A slip here propagates quickly because later launch processing windows are already tight.',
    ],
  },
  Launch: {
    id: 'phase-launch',
    tone: 'copper',
    summaryTitle: 'Ground campaign and first crewed mission gates',
    summary:
      'Launch operations cover the Falcon Heavy stack, the later Artemis IV crewed visit, and the expansion launches that grow Gateway on orbit.',
    whyItMatters:
      'This is where years of prior work convert into visible mission events. Every upstream slip tends to surface here.',
    takeaways: [
      'Launch milestones are public-facing, but their dates are only credible when the upstream integration chain is healthy.',
      'Crewed mission timing is especially sensitive to partner readiness and launch-window constraints.',
    ],
  },
  Operations: {
    id: 'phase-operations',
    tone: 'forest',
    summaryTitle: 'Transit, arrival, and expansion to initial capability',
    summary:
      'Gateway transitions from launch to NRHO transit, first crewed operations, and on-orbit expansion toward initial operational capability.',
    whyItMatters:
      'Operations show whether Gateway becomes a usable lunar-orbit platform rather than just a successful launch campaign.',
    takeaways: [
      'The operational schedule includes both transit risk and the staged activation of later partner contributions.',
      'Initial operational capability is a roll-up outcome, not a single isolated date.',
    ],
  },
};

const milestoneShortNames = {
  'M-001': 'Program start',
  'M-003': 'PPE award',
  'M-005': 'HALO design award',
  'M-006': 'Falcon Heavy award',
  'M-007': 'HALO fabrication award',
  'M-009': 'PCA baseline',
  'M-010': 'PPE CDR',
  'M-011': 'HALO CDR',
  'M-013': 'PPE ready to ship',
  'M-017': 'Mechanical integration',
  'M-018': 'Integrated test',
  'M-023': 'Launch readiness review',
  'M-024': 'PPE-HALO launch',
  'M-026': 'NRHO insertion',
  'M-029': 'Artemis IV launch',
  'M-030': 'First crewed arrival',
  'M-031': 'I-HAB activation',
  'M-037': 'Initial operational capability',
};

const driverSeeds = [
  {
    id: 'driver-baseline',
    name: 'Baseline closure and program commitment',
    tone: 'brand',
    primaryPhaseId: 'phase-development',
    windowLabel: '2019 to 2022',
    summary:
      'Requirements closure, system definition, the pre-PCA review, and the PCA baseline are the schedule story that turns Gateway into a committed program.',
    takeaways: [
      'The program only becomes analytically defensible after SRR, SDR, NAR, and PCA align into one baseline story.',
      'This driver is where requirements, cost, and schedule reasoning first lock together.',
    ],
    taskIds: ['T-011', 'T-012', 'T-003', 'T-004', 'T-008'],
    milestoneIds: ['M-002', 'M-004', 'M-008', 'M-009'],
    riskIds: [],
    documentIds: ['CD-001', 'CD-004', 'CD-015', 'CD-025'],
  },
  {
    id: 'driver-mass-interface',
    name: 'Mass closure and interface control',
    tone: 'danger',
    primaryPhaseId: 'phase-integration',
    windowLabel: '2024 to 2026',
    summary:
      'Mass reduction, HLS interface revision, and late integration compatibility work are the pressure points most likely to compress the launch-ready stack.',
    takeaways: [
      'This driver connects the GAO-highlighted mass problem to real schedule windows in integration and launch preparation.',
      'The work is partly technical and partly interface-governance, which is why it shows up across multiple artifacts.',
    ],
    taskIds: ['T-009', 'T-015', 'T-018', 'T-019', 'T-118', 'T-119'],
    milestoneIds: ['M-014', 'M-015', 'M-017', 'M-018'],
    riskIds: ['R-001', 'R-002', 'R-004', 'R-006'],
    documentIds: ['CD-004', 'CD-005', 'CD-007', 'CD-011', 'CD-028'],
  },
  {
    id: 'driver-flight-stack',
    name: 'Flight-stack assembly and qualification',
    tone: 'plum',
    primaryPhaseId: 'phase-test',
    windowLabel: '2025 to 2027',
    summary:
      'PPE and HALO have to converge into one tested launch stack before any launch date is meaningful.',
    takeaways: [
      'This is the part of the schedule where separate module plans stop being separate and start behaving like one vehicle.',
      'Environmental campaigns and final shipment are the hard gates that feed launch readiness.',
    ],
    taskIds: ['T-063', 'T-068', 'T-072', 'T-118', 'T-121', 'T-122', 'T-124', 'T-125'],
    milestoneIds: ['M-017', 'M-018', 'M-019', 'M-020', 'M-021', 'M-022'],
    riskIds: ['R-003', 'R-009'],
    documentIds: ['CD-005', 'CD-011', 'CD-021', 'CD-029'],
  },
  {
    id: 'driver-launch-transit',
    name: 'Launch, transit, and first crewed arrival',
    tone: 'copper',
    primaryPhaseId: 'phase-launch',
    windowLabel: '2026 to 2028',
    summary:
      'Launch windows, Falcon Heavy readiness, low-thrust transit, and crewed Artemis IV timing are the public schedule hinges of the whole program.',
    takeaways: [
      'This driver is where integration outcomes become visible mission events.',
      'Transit and crewed arrival add another layer of schedule logic after launch itself.',
    ],
    taskIds: ['T-131', 'T-132', 'T-134', 'T-135', 'T-136', 'T-138', 'T-139', 'T-140'],
    milestoneIds: ['M-023', 'M-024', 'M-026', 'M-027', 'M-028', 'M-029', 'M-030'],
    riskIds: ['R-004', 'R-005', 'R-007'],
    documentIds: ['CD-006', 'CD-007', 'CD-021', 'CD-023', 'CD-029'],
  },
  {
    id: 'driver-expansion',
    name: 'Partner expansion to initial capability',
    tone: 'forest',
    primaryPhaseId: 'phase-operations',
    windowLabel: '2028 to 2031',
    summary:
      'Gateway does not reach initial operational capability from PPE and HALO alone. It depends on the later cadence of I-HAB, ESPRIT, Canadarm3, and the UAE airlock.',
    takeaways: [
      'This is the long-tail schedule logic that connects partner hardware readiness to full program capability.',
      'The dates are real milestones, but the roll-up meaning is interpretive across several partner branches.',
    ],
    taskIds: ['T-086', 'T-090', 'T-110', 'T-113', 'T-163', 'T-164', 'T-165'],
    milestoneIds: ['M-031', 'M-032', 'M-033', 'M-034', 'M-035', 'M-036', 'M-037'],
    riskIds: ['R-006', 'R-010', 'R-011'],
    documentIds: ['CD-008', 'CD-009', 'CD-010'],
  },
];

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function splitIds(value) {
  return normalizeText(value)
    .split(';')
    .map((item) => normalizeText(item))
    .filter(Boolean);
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
      if (character === '\r' && nextCharacter === '\n') index += 1;
      currentRow.push(currentValue);
      if (currentRow.some((cell) => cell !== '')) rows.push(currentRow);
      currentValue = '';
      currentRow = [];
      continue;
    }

    currentValue += character;
  }

  if (currentValue !== '' || currentRow.length > 0) {
    currentRow.push(currentValue);
    if (currentRow.some((cell) => cell !== '')) rows.push(currentRow);
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

async function readOptionalText(relativePath) {
  try {
    return await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
  } catch {
    return '';
  }
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

function dateValue(value) {
  return new Date(`${value}T00:00:00Z`).getTime();
}

function compareDates(left, right) {
  return dateValue(left) - dateValue(right);
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return dateValue(leftStart) <= dateValue(rightEnd) && dateValue(leftEnd) >= dateValue(rightStart);
}

function formatDateLabel(value) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatMonthYear(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function pluralize(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function getWbsBranch(wbsId) {
  const parts = String(wbsId || '').split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : String(wbsId || '');
}

function resolveArtifactHref(fileName) {
  return exposedArtifacts[fileName] ? `/schedule/artifacts/${fileName}` : null;
}

function sourceTone(authorityTier) {
  switch (authorityTier) {
    case 'authoritative_public':
      return 'brand';
    case 'internal_controlled':
      return 'forest';
    case 'internal_working':
      return 'plum';
    case 'credible_partner':
      return 'copper';
    default:
      return 'brand';
  }
}

function basisInfo(dateBasis) {
  switch (dateBasis) {
    case 'direct_public_announcement':
      return { label: 'Direct public anchor', tone: 'brand', category: 'direct' };
    case 'formal_program_baseline':
      return { label: 'Formal baseline anchor', tone: 'forest', category: 'direct' };
    case 'schedule_plan_net':
      return { label: 'IMS NET milestone', tone: 'plum', category: 'ims' };
    default:
      return { label: 'Linked schedule authority', tone: 'copper', category: 'linked' };
  }
}

function classifyMilestoneType(name, phaseName) {
  const normalized = normalizeText(name).toLowerCase();
  if (normalized.includes('contract award')) return 'Contract award';
  if (normalized.includes('baseline approval') || normalized.includes('commitment agreement')) return 'Baseline gate';
  if (normalized.includes('review')) return 'Review gate';
  if (normalized.includes('integration')) return 'Integration gate';
  if (normalized.includes('test')) return 'Qualification gate';
  if (normalized.includes('launch')) return 'Launch event';
  if (normalized.includes('docking') || normalized.includes('arrival')) return 'Crewed operations';
  if (normalized.includes('operational capability') || normalized.includes('commissioning')) return 'Capability gate';
  return `${phaseName} milestone`;
}

function milestoneMeaning(programPhase, typeLabel) {
  if (typeLabel === 'Contract award') {
    return 'This date matters because it turns planned scope into a funded execution branch with real downstream schedule obligations.';
  }
  if (typeLabel === 'Baseline gate') {
    return 'This is the point where Gateway becomes a formally committed program baseline rather than a set of planning assumptions.';
  }
  if (typeLabel === 'Review gate') {
    return 'This review matters because it shows enough design or program maturity to move the next branch of work forward.';
  }
  if (typeLabel === 'Integration gate') {
    return 'This is where previously separate hardware or interface branches have to work as one schedule path.';
  }
  if (typeLabel === 'Qualification gate') {
    return 'This is a hard evidence point before shipment, launch processing, or higher-consequence operations can continue.';
  }
  if (typeLabel === 'Launch event') {
    return 'This date matters because it converts years of earlier schedule work into a visible mission event with limited recovery room.';
  }
  if (typeLabel === 'Crewed operations') {
    return 'This marks the transition from launch success into actual crewed use of Gateway on orbit.';
  }
  if (typeLabel === 'Capability gate') {
    return 'This is a roll-up milestone showing whether Gateway has become a functioning platform, not just a launched stack.';
  }
  if (programPhase === 'Fabrication') {
    return 'This date matters because the schedule is moving from design intent to real flight hardware delivery.';
  }
  return 'This is one of the named points that makes the overall Gateway schedule legible to a first-time audience.';
}

function shortMilestoneName(id, name) {
  return milestoneShortNames[id] || name.replace(/\s+\$[\d.]+[MB]/g, '').replace(/\s+-\s+L-Day/, '').trim();
}

function buildTaskPreview(task) {
  if (!task) return null;
  return {
    id: task.task_id,
    name: task.task_name,
    startDate: task.start_date,
    endDate: task.end_date,
    windowLabel: `${formatMonthYear(task.start_date)} to ${formatMonthYear(task.end_date)}`,
    wbsId: task.wbs_id,
  };
}

function buildRiskPreview(risk) {
  return {
    id: risk.risk_id,
    title: risk.risk_title,
    score: Number(risk.risk_score || 0),
    status: risk.status,
  };
}

function buildDocumentPreview(document) {
  return {
    id: document.doc_id,
    name: document.document_name,
    type: document.document_type,
    status: document.status,
    evidenceRole: document.evidence_role,
  };
}

function buildMilestonePreview(milestone) {
  return {
    id: milestone.id,
    name: milestone.name,
    shortName: milestone.shortName,
    date: milestone.date,
    dateLabel: milestone.dateLabel,
    phaseId: milestone.phaseId,
    phaseName: milestone.phaseName,
    whyItMatters: milestone.whyItMatters,
  };
}

async function buildScheduleData() {
  const [milestoneRows, taskRows, riskRows, documentRows, sourceRows, authorityGuideText] = await Promise.all([
    readCsv(dataFiles.milestones),
    readCsv(dataFiles.masterSchedule),
    readCsv(dataFiles.risks),
    readCsv(dataFiles.documents),
    readCsv(dataFiles.sources),
    readOptionalText(dataFiles.authorityGuide),
  ]);

  const tasksById = new Map(taskRows.map((task) => [task.task_id, task]));
  const sourcesById = new Map(sourceRows.map((source) => [source.source_id, source]));
  const documents = documentRows.filter((document) =>
    document.related_milestone ||
    ['baseline_definition', 'technical_evidence', 'risk_authority', 'schedule_authority', 'execution_reference'].includes(document.evidence_role),
  );
  const risks = riskRows.filter((risk) => Number(risk.risk_score || 0) >= 9 || risk.risk_category === 'schedule_integration');

  const milestoneRecords = milestoneRows
    .map((row) => {
      const task = tasksById.get(row.related_task) || null;
      const basis = basisInfo(row.date_basis);
      const typeLabel = classifyMilestoneType(row.milestone_name, row.program_phase);
      const sourceIds = splitIds(row.source_id);
      const linkedRisks = risks
        .filter((risk) => {
          if (task && getWbsBranch(risk.wbs_id) === getWbsBranch(task.wbs_id)) return true;
          if (row.program_phase === 'Launch' && risk.risk_category === 'schedule_integration') return true;
          if (row.program_phase === 'Integration' && ['R-001', 'R-002', 'R-003', 'R-009'].includes(risk.risk_id)) return true;
          if (row.program_phase === 'Operations' && ['R-005', 'R-006', 'R-007', 'R-010', 'R-011'].includes(risk.risk_id)) return true;
          return false;
        })
        .sort((left, right) => Number(right.risk_score) - Number(left.risk_score))
        .slice(0, 3)
        .map(buildRiskPreview);

      const linkedDocuments = documents
        .filter((document) => {
          if (document.related_milestone === row.milestone_id) return true;
          if (task && getWbsBranch(document.related_wbs) === getWbsBranch(task.wbs_id)) return true;
          return false;
        })
        .slice(0, 3)
        .map(buildDocumentPreview);

      const linkedSources = sourceIds
        .map((sourceId) => sourcesById.get(sourceId))
        .filter(Boolean)
        .map((source) => ({
          id: source.source_id,
          title: source.title,
          publisher: source.publisher,
          href: source.location.startsWith('http') ? source.location : resolveArtifactHref(path.basename(source.location)),
        }));

      return {
        id: row.milestone_id,
        name: row.milestone_name,
        shortName: shortMilestoneName(row.milestone_id, row.milestone_name),
        date: row.date,
        dateLabel: formatDateLabel(row.date),
        year: new Date(`${row.date}T00:00:00Z`).getUTCFullYear(),
        phaseId: phaseNarratives[row.program_phase].id,
        phaseName: row.program_phase,
        relatedTaskId: row.related_task,
        task: buildTaskPreview(task),
        directnessLabel: basis.label,
        directnessTone: basis.tone,
        directnessCategory: basis.category,
        typeLabel,
        tone: phaseNarratives[row.program_phase].tone,
        confidenceLabel: `${normalizeText(row.confidence_level).replace(/_/g, ' ')} confidence`,
        whyItMatters: milestoneMeaning(row.program_phase, typeLabel),
        linkedRisks,
        linkedDocuments,
        linkedSources,
      };
    })
    .sort((left, right) => compareDates(left.date, right.date));

  const milestoneById = new Map(milestoneRecords.map((item) => [item.id, item]));
  const startDate = taskRows.map((task) => task.start_date).sort(compareDates)[0];
  const endDate = milestoneRecords.map((milestone) => milestone.date).sort(compareDates).slice(-1)[0];

  const phases = Object.entries(phaseNarratives).map(([phaseName, narrative]) => {
    const phaseMilestones = milestoneRecords.filter((milestone) => milestone.phaseName === phaseName);
    const phaseStart = phaseMilestones.map((item) => item.date).sort(compareDates)[0];
    const phaseEnd = phaseMilestones.map((item) => item.date).sort(compareDates).slice(-1)[0];
    const phaseTasks = taskRows.filter((task) => overlaps(task.start_date, task.end_date, phaseStart, phaseEnd));
    const representativeTasks = phaseTasks
      .filter((task) => task.critical_flag === 'TRUE')
      .slice(0, 4)
      .map(buildTaskPreview);

    return {
      id: narrative.id,
      name: phaseName,
      tone: narrative.tone,
      summaryTitle: narrative.summaryTitle,
      summary: narrative.summary,
      whyItMatters: narrative.whyItMatters,
      takeaways: narrative.takeaways,
      start: phaseStart,
      end: phaseEnd,
      rangeLabel: `${formatMonthYear(phaseStart)} to ${formatMonthYear(phaseEnd)}`,
      milestoneCount: phaseMilestones.length,
      criticalTaskCount: phaseTasks.filter((task) => task.critical_flag === 'TRUE').length,
      keyMilestoneIds: phaseMilestones.slice(0, 3).map((item) => item.id),
      representativeTasks,
      milestones: phaseMilestones.map(buildMilestonePreview),
    };
  });

  const years = [];
  for (let year = new Date(`${startDate}T00:00:00Z`).getUTCFullYear(); year <= new Date(`${endDate}T00:00:00Z`).getUTCFullYear(); year += 1) {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const yearMilestones = milestoneRecords.filter((milestone) => milestone.year === year);
    const activePhases = phases.filter((phase) => overlaps(phase.start, phase.end, yearStart, yearEnd));
    const criticalTasks = taskRows.filter(
      (task) => task.critical_flag === 'TRUE' && overlaps(task.start_date, task.end_date, yearStart, yearEnd),
    );

    years.push({
      year,
      label: String(year),
      start: yearStart,
      end: yearEnd,
      milestoneCount: yearMilestones.length,
      criticalTaskCount: criticalTasks.length,
      phaseIds: activePhases.map((phase) => phase.id),
      highlightMilestoneIds: yearMilestones.slice(0, 3).map((item) => item.id),
      summary:
        yearMilestones.length > 0
          ? `${yearMilestones[0].shortName} and ${pluralize(Math.max(yearMilestones.length - 1, 0), 'other milestone')} make this part of the schedule visible.`
          : 'This year mostly carries background task work rather than a public milestone moment.',
    });
  }

  const drivers = driverSeeds.map((seed) => ({
    ...seed,
    representativeTasks: seed.taskIds.map((taskId) => buildTaskPreview(tasksById.get(taskId))).filter(Boolean),
    linkedMilestones: seed.milestoneIds.map((id) => buildMilestonePreview(milestoneById.get(id))).filter(Boolean),
    linkedRisks: seed.riskIds.map((riskId) => risks.find((risk) => risk.risk_id === riskId)).filter(Boolean).map(buildRiskPreview),
    linkedDocuments: seed.documentIds.map((docId) => documents.find((document) => document.doc_id === docId)).filter(Boolean).map(buildDocumentPreview),
  }));

  const directCount = milestoneRecords.filter((item) => item.directnessCategory === 'direct').length;
  const imsCount = milestoneRecords.filter((item) => item.directnessCategory === 'ims').length;
  const authorityGuideSummary =
    summarizeText(sanitizeRtfText(authorityGuideText), 2) ||
    'The authority guide reinforces that the source documents, not the app, carry the formal burden of definition, traceability, and evidence discipline.';

  const usageCounts = new Map();
  milestoneRows.forEach((row) => splitIds(row.source_id).forEach((id) => usageCounts.set(id, (usageCounts.get(id) || 0) + 1)));
  risks.forEach((risk) => splitIds(risk.source_id).forEach((id) => usageCounts.set(id, (usageCounts.get(id) || 0) + 1)));

  const traceabilitySources = sourceRows
    .filter((source) => ['INT-001', 'INT-003', 'WEB-001', 'WEB-002', 'WEB-003', 'WEB-004', 'WEB-005', 'WEB-006', 'WEB-008', 'WEB-009', 'WEB-010', 'WEB-011'].includes(source.source_id))
    .map((source) => {
      const isExternal = source.location.startsWith('http');
      return {
        id: source.source_id,
        title: source.title,
        publisher: source.publisher,
        authorityTierLabel: normalizeText(source.authority_tier).replace(/_/g, ' '),
        relevance: source.relevance,
        usageLabel: `${usageCounts.get(source.source_id) || 0} schedule references in the current lens`,
        href: isExternal ? source.location : resolveArtifactHref(path.basename(source.location)),
        linkLabel: isExternal ? 'Open source' : 'Open local artifact',
        tone: sourceTone(source.authority_tier),
      };
    });

  return {
    startDate,
    endDate,
    milestoneRecords,
    criticalTaskCount: taskRows.filter((task) => task.critical_flag === 'TRUE').length,
    phases,
    years,
    drivers,
    directCount,
    imsCount,
    authorityGuideSummary,
    milestoneById,
    traceabilitySources,
  };
}

async function buildSchedulePayload() {
  const {
    startDate,
    endDate,
    milestoneRecords,
    criticalTaskCount,
    phases,
    years,
    drivers,
    directCount,
    imsCount,
    authorityGuideSummary,
    milestoneById,
    traceabilitySources,
  } = await buildScheduleData();

  return {
    appTitle: 'Gateway Schedule Explorer',
    appSubtitle:
      'This is how the Gateway program unfolds over time, what moments matter most, and which schedule branches drive everything else.',
    generatedAt: new Date().toISOString(),
    defaultSelection: { type: 'milestone', id: 'M-024' },
    defaultPhaseId: 'phase-launch',
    defaultDriverId: 'driver-launch-transit',
    overview: {
      spanValue: `${new Date(`${startDate}T00:00:00Z`).getUTCFullYear()}-${new Date(`${endDate}T00:00:00Z`).getUTCFullYear()}`,
      spanLabel: `${formatMonthYear(startDate)} to ${formatMonthYear(endDate)}`,
      story:
        'Gateway unfolds as a long sequence of baseline, design, fabrication, integration, launch, and on-orbit activation gates rather than a single mission date.',
      signals: [
        { label: 'Overall span', value: `${new Date(`${startDate}T00:00:00Z`).getUTCFullYear()}-${new Date(`${endDate}T00:00:00Z`).getUTCFullYear()}` },
        { label: 'Named milestones', value: pluralize(milestoneRecords.length, 'milestone') },
        { label: 'Critical work', value: pluralize(criticalTaskCount, 'critical task') },
        { label: 'Direct anchors', value: pluralize(directCount, 'anchor') },
      ],
      signatureMoments: [
        { label: 'PCA baseline', value: milestoneById.get('M-009')?.dateLabel || 'N/A' },
        { label: 'PPE-HALO launch', value: milestoneById.get('M-024')?.dateLabel || 'N/A' },
        { label: 'First crewed arrival', value: milestoneById.get('M-030')?.dateLabel || 'N/A' },
      ],
      contextNotes: [
        {
          title: 'What the schedule captures',
          body:
            'This lens captures the named Gateway milestone file, the critical portions of the master schedule extract, linked schedule risks, and supporting schedule-relevant documents.',
        },
        {
          title: 'What is directly anchored',
          body:
            'Public contract awards, formal program baseline gates, and named milestone entries from the schedule authority layer are presented as direct anchors.',
        },
        {
          title: 'Where interpretation enters',
          body:
            'Phase framing, schedule-driver grouping, and plain-English consequence statements are analytic rollups built from the source artifacts rather than direct quotations from one file.',
        },
      ],
      phasePreviewIds: ['phase-formulation', 'phase-development', 'phase-integration', 'phase-launch'],
    },
    timeline: {
      start: startDate,
      end: endDate,
      storyTitle: 'Gateway only makes sense when the timeline is read as one connected sequence',
      story:
        'The program begins with baseline and architecture work, narrows through hardware convergence, then widens again into launch, transit, crewed arrival, and partner expansion.',
      takeaways: [
        'Most of the schedule pressure sits in the handoffs between development, integration, and launch.',
        'Public launch dates are the visible output of a much longer chain of design, mass, interface, and qualification work.',
      ],
      hint: 'Showing the full program arc from formulation through operations.',
      keyMilestoneIds: ['M-001', 'M-003', 'M-009', 'M-017', 'M-024', 'M-026', 'M-029', 'M-037'],
    },
    phaseLensSummary:
      'The phase view groups dates into large narrative blocks so the schedule reads like a program sequence instead of a flat milestone list.',
    driverLensSummary:
      'The driver view condenses the schedule into a handful of branches that create the most timing pressure, dependency sensitivity, or visible mission consequence.',
    milestones: milestoneRecords,
    phases,
    years,
    drivers,
    methodology: {
      title: 'What is directly schedule-anchored, and what is interpretive',
      preview: 'Open the authority discipline, caveats, and interpretation boundaries.',
      summary:
        'The milestone file and master schedule extract are the primary schedule authorities in this lens. Public announcements and formal baselines anchor some dates directly, while broader schedule meaning is built by linking those dates to critical tasks, risks, and supporting documents.',
      authorityGuideSummary,
      cards: [
        {
          eyebrow: 'Direct anchors',
          title: 'Dates that come straight from schedule authority',
          body:
            'Some schedule moments are directly anchored in public announcements or formal baseline decisions, and they are treated differently from purely interpretive rollups.',
          items: [
            `${directCount} milestones are currently treated as direct public or formal baseline anchors.`,
            'These include contract awards, baseline approval, and named mission events that carry clear external or formal references.',
          ],
        },
        {
          eyebrow: 'IMS authority',
          title: 'Dates that come from the schedule layer itself',
          body:
            'Many Gateway milestones are NET points from the integrated schedule authority. They are still anchored, but they should be read as controlled forecast points rather than immutable historical facts.',
          items: [
            `${imsCount} milestones are labeled as IMS NET schedule-authority points.`,
            'These dates are useful and explicit, but they are not identical to public event history.',
          ],
        },
        {
          eyebrow: 'Interpretation',
          title: 'Where the app adds meaning on top of the documents',
          body:
            'Phase stories and schedule-driver groups are analytic structures added by the app so a first-time audience can understand why the dates matter.',
          items: [
            'Driver groupings connect tasks, milestones, risks, and documents into a few consequential branches.',
            'Plain-English explanations are derived from the authority layer, not copied from one single source.',
          ],
        },
        {
          eyebrow: 'Limits',
          title: 'What the schedule authority layer still does not expose',
          body:
            'The authority files are strong enough for presentation and traceability, but they still are not a full live project-management tool.',
          items: [
            'The app does not claim to show full network logic, float, or real-time replanning.',
            'When implications are inferred across branches, the app labels that as interpretation instead of direct schedule fact.',
          ],
        },
      ],
    },
    traceability: {
      title: 'Where the timeline comes from, and where interpretation begins',
      preview: 'Open the authority files, source register, and evidence model behind the schedule.',
      summary:
        'The schedule lens stands on named milestone and schedule artifacts first, then links out to risk, document, and source authorities so the user can see exactly what is direct, what is linked, and what is interpretive.',
      evidenceModel: [
        {
          label: 'Direct public or formal anchors',
          value: `${directCount} milestones`,
          description: 'Publicly announced awards, formal baseline gates, and other explicitly anchored moments.',
        },
        {
          label: 'IMS schedule authority points',
          value: `${imsCount} milestones`,
          description: 'Named NET milestones coming directly from the schedule authority layer itself.',
        },
        {
          label: 'Interpretive rollups',
          value: `${drivers.length} driver groups`,
          description: 'Plain-English phase and driver framing built from linked tasks, risks, and supporting documents.',
        },
      ],
      artifacts: [
        {
          title: 'Gateway milestone authority extract',
          meta: 'Primary milestone file',
          fileType: 'CSV',
          description: 'Named milestones with date basis, source IDs, confidence, and traceability notes.',
          href: '/schedule/artifacts/gateway_milestones.csv',
          linkLabel: 'Open milestone CSV',
          tone: 'brand',
        },
        {
          title: 'Gateway master schedule extract',
          meta: 'Critical task backbone',
          fileType: 'CSV',
          description: 'Task-level dates, predecessors, milestone flags, and criticality indicators used to frame schedule-driving work.',
          href: '/schedule/artifacts/gateway_master_schedule.csv',
          linkLabel: 'Open schedule CSV',
          tone: 'plum',
        },
        {
          title: 'Gateway risk register',
          meta: 'Schedule-linked pressure',
          fileType: 'CSV',
          description: 'Risk statements, categories, mitigation notes, and source IDs that explain timing pressure on the schedule.',
          href: '/schedule/artifacts/gateway_risk_register.csv',
          linkLabel: 'Open risk CSV',
          tone: 'danger',
        },
        {
          title: 'Gateway contract document tracker',
          meta: 'Supporting authority map',
          fileType: 'CSV',
          description: 'Controlled documents linked to milestones, WBS branches, and schedule evidence roles.',
          href: '/schedule/artifacts/gateway_contract_documents_tracker.csv',
          linkLabel: 'Open document tracker CSV',
          tone: 'forest',
        },
        {
          title: 'Gateway source reference register',
          meta: 'Source register',
          fileType: 'CSV',
          description: 'Public and internal references used to anchor the schedule artifacts and supporting analysis.',
          href: '/schedule/artifacts/gateway_source_reference_register.csv',
          linkLabel: 'Open source register CSV',
          tone: 'brand',
        },
        {
          title: 'Gateway data authority guide',
          meta: 'Authority discipline',
          fileType: 'RTF',
          description: 'Companion guidance describing how source-document rigor is separated from app-level interpretation.',
          href: '/schedule/artifacts/gateway_data_authority_guide.rtf',
          linkLabel: 'Open authority guide',
          tone: 'forest',
        },
      ],
      sources: traceabilitySources,
    },
  };
}

async function serveStaticFile(response, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const body = await fs.readFile(absolutePath);
  response.writeHead(200, { 'Content-Type': mimeTypes[extension] || 'application/octet-stream' });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/') {
      response.writeHead(302, { Location: '/schedule/' });
      response.end();
      return;
    }

    if (pathname === '/schedule/data/gateway-schedule.json') {
      const body = JSON.stringify(await buildSchedulePayload());
      response.writeHead(200, { 'Content-Type': mimeTypes['.json'] });
      response.end(body);
      return;
    }

    if (pathname.startsWith('/schedule/artifacts/')) {
      const fileName = path.basename(pathname);
      const relativePath = exposedArtifacts[fileName];
      if (!relativePath) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Artifact not found');
        return;
      }
      await serveStaticFile(response, relativePath);
      return;
    }

    const localPathMap = {
      '/schedule/': 'schedule/index.html',
      '/schedule/index.html': 'schedule/index.html',
      '/schedule/styles.css': 'schedule/styles.css',
      '/schedule/app.js': 'schedule/app.js',
    };

    if (localPathMap[pathname]) {
      await serveStaticFile(response, localPathMap[pathname]);
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : 'Unknown server error');
  }
});

server.listen(port, host, () => {
  console.log(`Gateway Schedule Explorer available at http://${host}:${port}/schedule/`);
});
