import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');

const REGISTER_PATH = 'Contract_Cost_Schedule Documents/data/gateway_risk_register.csv';
const OUTPUT_PATH = 'risk/data/risks.json';

const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const CATEGORY_LABELS = {
  technical: 'Technical',
  programmatic: 'Programmatic',
  schedule_integration: 'Schedule Integration',
  mission_operations: 'Mission Operations',
};

// The six station elements and the only name-to-WBS associations applied.
// Matching is case-insensitive with letter boundaries (digits and hyphens do
// not break a match), so "Canadarm" matches "Canadarm3" and "PPE" matches
// "PPE-HALO".
const ELEMENT_MATCHERS = [
  { pattern: 'PPE', wbsId: '1.3' },
  { pattern: 'HALO', wbsId: '1.4' },
  { pattern: 'I-?HAB', wbsId: '1.5' },
  { pattern: 'ESPRIT', wbsId: '1.6' },
  { pattern: 'Airlock', wbsId: '1.7' },
  { pattern: 'Canadarm', wbsId: '1.8' },
].map(({ pattern, wbsId }) => ({
  regex: new RegExp(`(?<![A-Za-z])(?:${pattern})(?![A-Za-z])`, 'i'),
  wbsId,
}));

const ELEMENT_WBS_IDS = new Set(ELEMENT_MATCHERS.map((matcher) => matcher.wbsId));

// Curated reader-facing content. The 15 entries that existed before the
// register rebuild are carried over verbatim; the 7 new entries (R-005,
// R-008, R-009, R-011, R-014, R-017, R-019) are written strictly from the
// register's description and mitigation columns, and every tag is a word or
// phrase that literally appears in the risk's title or description.
const CURATED_CONTENT = {
  'R-001': {
    tags: ['mass', 'launch stack', 'Falcon Heavy', 'HALO', 'PPE'],
    plainLanguage:
      'The first two Gateway modules (PPE and HALO) launch stacked together on one Falcon Heavy rocket. Their combined mass might exceed what Falcon Heavy can lift to lunar orbit. If that happens, NASA needs a more expensive rocket or a last-minute redesign — both cost billions and years.',
  },
  'R-002': {
    tags: ['controllability', 'HLS', 'interface', 'docked operations', 'PPE'],
    plainLanguage:
      'When a fully-loaded SpaceX Starship docks with Gateway, the combined mass is enormous. PPE, the small propulsion module, might not have enough thruster authority to keep Gateway safely oriented under those loads. Picture a tugboat trying to hold a supertanker steady.',
  },
  'R-003': {
    tags: ['HALO', 'contract', 'cost growth', 'Northrop Grumman', 'oversight'],
    plainLanguage:
      "HALO, the habitat module, is under a fixed-price contract that's already cost the contractor more than expected. If costs keep growing, it creates financial pressure and could force scope cuts, delays, or contract renegotiation.",
  },
  'R-004': {
    tags: ['launch window', 'manifest', 'Falcon Heavy', 'schedule', 'NRHO'],
    plainLanguage:
      "Gateway has to launch during specific orbital geometry windows. If Falcon Heavy's manifest slips for another mission, Gateway waits months for the next valid window — and every downstream Artemis mission slides with it.",
  },
  'R-005': {
    tags: ['AEPS', 'thruster', 'transit', 'NRHO insertion', 'Artemis IV'],
    plainLanguage:
      'A partial thruster failure during the roughly seven-month solar electric propulsion transit would reduce available thrust, which could prevent NRHO insertion or stretch the transit enough to delay Artemis IV. Redundant cross-strapped thruster strings mean the mission can still complete on three of four engines.',
  },
  'R-006': {
    tags: ['I-HAB', 'Artemis IV', 'ESA', 'co-manifest', 'schedule'],
    plainLanguage:
      "I-HAB is a European habitation module that rides to Gateway on the same rocket as Artemis IV. If I-HAB isn't ready in time, either Artemis IV delays or it launches without the habitation expansion — cutting crew capacity on the first extended stay.",
  },
  'R-007': {
    tags: ['DSN', 'communications', 'crewed operations', 'ESPRIT', 'network capacity'],
    plainLanguage:
      "The Deep Space Network (DSN) is NASA's antenna array that talks to everything beyond Earth orbit. It's already overbooked. When crew is on Gateway, they'll be fighting for antenna time with Mars rovers, Voyager, and every other deep-space mission.",
  },
  'R-008': {
    tags: ['xenon', 'supply chain', 'propellant', 'Hall-effect thruster', 'PPE'],
    plainLanguage:
      'Global xenon production is limited, and growing demand from commercial satellite thruster programs could squeeze availability and raise prices for PPE fueling. The program has started long-lead procurement, holds a supply contract, and is assessing krypton as an alternative propellant.',
  },
  'R-009': {
    tags: ['HALO', 'ECLSS', 'water recovery', 'qualification testing', 'rework'],
    plainLanguage:
      "HALO's ECLSS may not meet its atmospheric revitalization or water recovery specifications under all NRHO operating scenarios, and qualification testing has already identified margin concerns. Mitigation adds prototype testing, reuses heritage ISS components where feasible, and constrains operations for initial crewed missions.",
  },
  'R-010': {
    tags: ['international partners', 'budget', 'ESA', 'JAXA', 'CSA'],
    plainLanguage:
      'Gateway depends on hardware from ESA (Europe), JAXA (Japan), and CSA (Canada). If any of those space agencies get budget cut domestically, the hardware they owe either arrives late or arrives reduced in capability.',
  },
  'R-011': {
    tags: ['Canadarm3', 'AI software', 'autonomy', 'TRL', 'maintenance'],
    plainLanguage:
      "Canadarm3's AI software may not reach the maturity required for autonomous inspection and servicing, which would force more ground-in-the-loop operations and limit Gateway maintenance capability. The plan phases autonomy in gradually, starting with ground-controlled operations and enforcing TRL gates along the way.",
  },
  'R-012': {
    tags: ['UAE airlock', 'MBRSC', 'EVA', 'schedule', 'partner development'],
    plainLanguage:
      "The UAE is building Gateway's airlock — their first human-spaceflight hardware ever. Aerospace hardware is brutal on first-time providers; workforce and supply-chain issues routinely delay these programs by years, which would delay all extravehicular activity (spacewalks) on Gateway.",
  },
  'R-013': {
    tags: ['SLS Block 1B', 'Artemis IV', 'I-HAB', 'launch vehicle', 'assembly sequence'],
    plainLanguage:
      "Artemis IV uses SLS Block 1B, an upgraded version of NASA's heavy-lift rocket. The upgrade is behind schedule. If Block 1B isn't ready, Gateway assembly has to be re-sequenced — possibly launching modules on different rockets in a different order, which cascades schedule and cost impacts.",
  },
  'R-014': {
    tags: ['micrometeoroid', 'orbital debris', 'uncrewed', 'solar arrays', 'NRHO'],
    plainLanguage:
      'Gateway spends more than 200 days a year uncrewed with minimal active debris avoidance, so a micrometeoroid or debris strike on solar arrays, viewports, or antennas during that period could end the mission. Protection relies on MMOD-standard shielding, redundant critical systems, and ground-based conjunction monitoring.',
  },
  'R-015': {
    tags: ['radiation', 'crew safety', 'HALO', 'I-HAB', 'human health'],
    plainLanguage:
      "Astronauts on Gateway absorb more cosmic radiation than on the ISS because Gateway is beyond Earth's magnetic field. This creates hard limits on how long crew can stay, how many missions they can fly over a career, and how flexible mission planning can be.",
  },
  'R-016': {
    tags: ['xenon', 'refueling', 'ESPRIT', 'TRL', 'technology maturation'],
    plainLanguage:
      "ESPRIT, Gateway's refueling module, needs to transfer xenon gas between spacecraft in orbit. This has never been done at Gateway's scale. If the technology isn't ready when ESPRIT arrives, Gateway's fuel-top-up capability is stuck.",
  },
  'R-017': {
    tags: ['power budget', 'PPE', 'HLS', 'solar array', 'Orion'],
    plainLanguage:
      "With Orion, HLS, and fully outfitted modules all docked, Gateway's power demand may exceed what PPE's 60 kW generation can supply in degraded scenarios such as solar array damage or reduced sun angles. The power budget carries a 25% margin, backed by load-shedding procedures and phased module activation.",
  },
  'R-018': {
    tags: ['NRHO', 'communications', 'blackout', 'autonomy', 'crew safety'],
    plainLanguage:
      "Gateway's orbit takes it behind the Moon periodically, creating communication blackouts with Earth. During blackouts, the crew is on their own — Gateway's autonomous systems have to handle anything that goes wrong without ground support.",
  },
  'R-019': {
    tags: ['supply chain', 'long-lead electronics', 'radiation-hardened microelectronics', 'PPE', 'HALO'],
    plainLanguage:
      'Lingering COVID-era and geopolitical supply chain effects are still hitting radiation-hardened microelectronics, specialty materials, and skilled workforce, so long-lead electronics for PPE and HALO avionics face procurement delays. The response expands the vendor base and front-loads parts procurement and stockpiling.',
  },
  'R-020': {
    tags: ['test', 'thermal vacuum', 'acoustic', 'rework', 'schedule margin'],
    plainLanguage:
      "Before launch, Gateway hardware goes through punishing acoustic and thermal-vacuum tests to simulate launch and space conditions. If anything fails those tests, the fix is either rework (months of delay) or replacement (much longer). There's no easy recovery at that stage.",
  },
  'R-021': {
    tags: ['strategic', 'appropriations', 'policy', 'program continuity', 'Artemis'],
    plainLanguage:
      "The Gateway program itself could be cancelled or radically restructured — by an incoming administration, by Congressional appropriations fights, or by a larger Artemis program shakeup. This is a political risk, not a technical one, but it's the risk that could end everything regardless of engineering progress.",
  },
  'R-022': {
    tags: ['crew rescue', 'safe haven', 'Orion', 'HALO', 'contingency'],
    plainLanguage:
      'If something goes wrong while crew is on Gateway and they need to evacuate quickly, Gateway must keep them alive until rescue arrives. But Gateway is not Earth orbit — a rescue mission takes days to weeks to reach lunar space, not hours.',
  },
};

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseCsv(rawText) {
  const text = stripBom(String(rawText ?? ''));
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

  if (!rows.length) return [];
  const headers = rows[0].map((header) => stripBom(String(header ?? '')).trim());
  return rows.slice(1).map((row) => {
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = String(row[index] ?? '').trim();
    });
    return entry;
  });
}

function compareWbsId(left, right) {
  const leftParts = String(left || '').split('.').map(Number);
  const rightParts = String(right || '').split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : -1;
    const rightValue = Number.isFinite(rightParts[index]) ? rightParts[index] : -1;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

function categoryLabel(rawCategory) {
  const key = String(rawCategory || '').trim().toLowerCase();
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function topLevelElementAncestor(wbsId) {
  const parts = String(wbsId || '').split('.').filter(Boolean);
  if (parts.length < 2) return '';
  return `${parts[0]}.${parts[1]}`;
}

export function deriveElementWbsIds(row, tags) {
  const ids = new Set();

  const homeAncestor = topLevelElementAncestor(row.wbs_id);
  if (ELEMENT_WBS_IDS.has(homeAncestor)) {
    ids.add(homeAncestor);
  }

  const haystack = [row.risk_title, ...(tags || []), row.description].join(' ');
  ELEMENT_MATCHERS.forEach(({ regex, wbsId }) => {
    if (regex.test(haystack)) ids.add(wbsId);
  });

  return [...ids].sort(compareWbsId);
}

export async function buildRiskManifest() {
  const registerText = await fs.readFile(path.join(repoRoot, REGISTER_PATH), 'utf8');
  const rows = parseCsv(registerText);

  const risks = rows.map((row) => {
    const curated = CURATED_CONTENT[row.risk_id] || { tags: [], plainLanguage: '' };
    const likelihood = Number(row.likelihood) || 0;
    const impact = Number(row.consequence) || 0;
    const priority = Number(row.risk_score) || 0;

    if (priority !== likelihood * impact) {
      throw new Error(
        `${row.risk_id}: register risk_score ${priority} does not equal likelihood ${likelihood} x consequence ${impact}`,
      );
    }

    return {
      id: row.risk_id,
      title: row.risk_title,
      category: categoryLabel(row.risk_category),
      likelihood,
      impact,
      priority,
      owner: row.owner,
      mitigation: row.mitigation,
      status: row.status,
      description: row.description,
      tags: curated.tags,
      plainLanguage: curated.plainLanguage,
      wbsId: row.wbs_id,
      elementWbsIds: deriveElementWbsIds(row, curated.tags),
      confidenceLevel: row.confidence_level,
      basisType: row.basis_type,
    };
  });

  risks.sort((left, right) => left.id.localeCompare(right.id));

  return {
    appTitle: 'Gateway Risk Explorer',
    appSubtitle:
      'A focused view of the program risks that matter most, how they differ, and what mitigation context currently exists.',
    generatedAt: new Date().toISOString(),
    risks,
  };
}

export async function writeRiskManifest() {
  const manifest = await buildRiskManifest();
  const outputPath = path.join(repoRoot, OUTPUT_PATH);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUTPUT_PATH} (${manifest.risks.length} risks)`);
  return manifest;
}

if (isDirectRun) {
  await writeRiskManifest();
}
