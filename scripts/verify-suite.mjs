import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');

const failures = [];

function fail(check, message) {
  failures.push(`[${check}] ${message}`);
}

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
  const headers = rows[0].map((header) => String(header ?? '').replace(/^﻿/, '').trim());
  return rows.slice(1).map((row) => {
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = String(row[index] ?? '').trim();
    });
    return entry;
  });
}

async function readJson(relativePath) {
  const contents = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
  return JSON.parse(contents);
}

function collectRiskIdStrings(value, found = new Set()) {
  if (typeof value === 'string') {
    if (/^R-\d{3}$/.test(value)) found.add(value);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectRiskIdStrings(item, found));
    return found;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectRiskIdStrings(item, found));
    return found;
  }
  return found;
}

async function checkRiskRegisterParity() {
  const registerRows = parseCsv(
    await fs.readFile(
      path.join(repoRoot, 'Contract_Cost_Schedule Documents/data/gateway_risk_register.csv'),
      'utf8',
    ),
  );
  const registerIds = registerRows.map((row) => row.risk_id).filter(Boolean);
  const manifest = await readJson('risk/data/risks.json');
  const manifestRisks = Array.isArray(manifest.risks) ? manifest.risks : [];
  const manifestIds = manifestRisks.map((risk) => risk.id);

  if (!registerIds.length) {
    fail('register-parity', 'Could not read any risk_id values from the register CSV.');
    return { registerRows, manifestRisks };
  }

  const registerSet = new Set(registerIds);
  const manifestSet = new Set(manifestIds);
  const missing = registerIds.filter((id) => !manifestSet.has(id));
  const extra = manifestIds.filter((id) => !registerSet.has(id));
  const duplicates = manifestIds.filter((id, index) => manifestIds.indexOf(id) !== index);

  if (missing.length) {
    fail('register-parity', `risks.json is missing register risks: ${missing.join(', ')}`);
  }
  if (extra.length) {
    fail('register-parity', `risks.json contains ids not in the register: ${extra.join(', ')}`);
  }
  if (duplicates.length) {
    fail('register-parity', `risks.json contains duplicate ids: ${duplicates.join(', ')}`);
  }

  return { registerRows, manifestRisks };
}

function checkScoreInvariant(manifestRisks) {
  manifestRisks.forEach((risk) => {
    const likelihood = Number(risk.likelihood);
    const impact = Number(risk.impact);
    const priority = Number(risk.priority);
    if (priority !== likelihood * impact) {
      fail(
        'score-invariant',
        `${risk.id}: priority ${priority} !== likelihood ${likelihood} x impact ${impact}`,
      );
    }
  });
}

async function checkCrosswalkRiskIds(manifestRisks) {
  const crosswalk = await readJson('suite-assets/data/gateway-crosswalk.json');
  const manifestSet = new Set(manifestRisks.map((risk) => risk.id));
  const referenced = collectRiskIdStrings(crosswalk);
  const ghosts = [...referenced].filter((id) => !manifestSet.has(id)).sort();

  if (ghosts.length) {
    fail('crosswalk-ghosts', `Crosswalk references risk ids missing from risks.json: ${ghosts.join(', ')}`);
  }

  return crosswalk;
}

function checkPpeRiskUnion(crosswalk, manifestRisks) {
  // Regression check for the PPE bug. Only meaningful once WS1 has landed,
  // so it self-gates on the elementWbsIds field WS1 introduces.
  const hasElementAssociations = manifestRisks.some((risk) => Array.isArray(risk.elementWbsIds));
  if (!hasElementAssociations) return;

  const node = crosswalk?.wbs?.byId?.['1.3'];
  const ids = node?.risks?.ids || [];
  ['R-001', 'R-002'].forEach((requiredId) => {
    if (!ids.includes(requiredId)) {
      fail('ppe-risk-union', `Crosswalk node 1.3 risks.ids must include ${requiredId}; got [${ids.join(', ')}]`);
    }
  });

  // Scoped-count check (WS2): the Risk app's scoped base for ?wbs=1.3 is this
  // exact list, so it must contain every register risk homed in the 1.3
  // subtree plus every risk whose elementWbsIds intersect that subtree.
  const expected = manifestRisks
    .filter((risk) => {
      const inSubtree = (id) => id === '1.3' || String(id || '').startsWith('1.3.');
      return inSubtree(risk.wbsId) || (risk.elementWbsIds || []).some(inSubtree);
    })
    .map((risk) => risk.id)
    .sort();
  const actual = [...ids].sort();
  if (expected.join('|') !== actual.join('|')) {
    fail(
      'ppe-risk-union',
      `Crosswalk node 1.3 risks.ids [${actual.join(', ')}] does not match the manifest-derived union [${expected.join(', ')}]`,
    );
  }
}

async function checkMilestonePhaseCoverage() {
  // Every milestone in the schedule dataset must be reachable through its
  // phase's full milestone list (the source for the rendered phase detail).
  const schedule = await readJson('schedule/data/gateway-schedule.json');
  const phaseListIds = new Set(
    (schedule.phases || []).flatMap((phase) => (phase.milestones || []).map((item) => item.id)),
  );
  (schedule.milestones || []).forEach((milestone) => {
    if (!phaseListIds.has(milestone.id)) {
      fail('milestone-coverage', `Milestone ${milestone.id} appears in no phase milestone list.`);
    }
    const phase = (schedule.phases || []).find((item) => item.id === milestone.phaseId);
    if (!phase) {
      fail('milestone-coverage', `Milestone ${milestone.id} references unknown phase ${milestone.phaseId}.`);
    }
  });
  (schedule.phases || []).forEach((phase) => {
    const actualCount = (schedule.milestones || []).filter((item) => item.phaseId === phase.id).length;
    const listedCount = (phase.milestones || []).length;
    if (actualCount !== listedCount || actualCount !== Number(phase.milestoneCount)) {
      fail(
        'milestone-coverage',
        `Phase ${phase.id} counts disagree: ${actualCount} in dataset, ${listedCount} listed, milestoneCount=${phase.milestoneCount}.`,
      );
    }
  });
}

const APP_DIRS = ['wbs', 'schedule', 'cost', 'risk', 'documents'];
const SOURCE_EXTENSIONS = new Set(['.js', '.html', '.css', '.json', '.mjs']);

// Flipped to true by the WS5 de-narration commit; the copy checks below only
// apply once that pass has landed.
const WS5_LANDED = false;

async function listSourceFiles(directory) {
  const absoluteDir = path.join(repoRoot, directory);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(relativePath)));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(relativePath);
    }
  }
  return files;
}

async function checkForbiddenLayerStrings() {
  if (!WS5_LANDED) return;
  for (const appDir of APP_DIRS) {
    const files = await listSourceFiles(appDir);
    for (const file of files) {
      const contents = await fs.readFile(path.join(repoRoot, file), 'utf8');
      ['Layer 1', 'Layer 2', 'Layer 3'].forEach((needle) => {
        if (contents.includes(needle)) {
          fail('forbidden-strings', `"${needle}" found in ${file}`);
        }
      });
    }
  }
}

const NARRATION_PATTERN = /Click |Choose |Select |This layer|This view|This is the|will appear here|go deeper/g;
// Per-app allowance: at most 2 matches (true empty-state orientation lines).
const NARRATION_LIMIT = 2;

async function checkNarrationBudget() {
  if (!WS5_LANDED) return;
  for (const appDir of APP_DIRS) {
    const files = await listSourceFiles(appDir);
    let count = 0;
    const hits = [];
    for (const file of files) {
      if (file.includes(`${path.sep}data${path.sep}`)) continue; // data content is exempt; chrome lives in source files
      const contents = await fs.readFile(path.join(repoRoot, file), 'utf8');
      const matches = contents.match(NARRATION_PATTERN);
      if (matches?.length) {
        count += matches.length;
        hits.push(`${file} (${matches.length})`);
      }
    }
    if (count > NARRATION_LIMIT) {
      fail('narration-budget', `${appDir}: ${count} self-narration matches (limit ${NARRATION_LIMIT}): ${hits.join('; ')}`);
    }
  }
}

const PROTECTED_PATTERN = /^(index\.html|index\.app\.html|js\/|css\/|server\.mjs|Gateway_Thumbnail|LICENSE|README)/;

function resolveBaseBranch() {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'main'], { cwd: repoRoot, stdio: 'pipe' });
    return 'main';
  } catch {
    return 'master';
  }
}

function checkProtectedFiles() {
  const baseBranch = resolveBaseBranch();
  let output = '';
  try {
    output = execFileSync('git', ['diff', '--name-only', baseBranch], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
  } catch (error) {
    fail('protected-files', `Unable to run git diff against ${baseBranch}: ${error.message}`);
    return;
  }

  output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((file) => {
      if (PROTECTED_PATTERN.test(file) || file.startsWith('Contract_Cost_Schedule Documents/')) {
        fail('protected-files', `Protected path modified: ${file}`);
      }
    });
}

async function main() {
  const { manifestRisks } = await checkRiskRegisterParity();
  checkScoreInvariant(manifestRisks);
  const crosswalk = await checkCrosswalkRiskIds(manifestRisks);
  checkPpeRiskUnion(crosswalk, manifestRisks);
  await checkMilestonePhaseCoverage();
  await checkForbiddenLayerStrings();
  await checkNarrationBudget();
  checkProtectedFiles();

  if (failures.length) {
    console.error(`verify-suite: ${failures.length} failure(s)`);
    failures.forEach((failure) => console.error(`  FAIL ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log('verify-suite: all checks passed');
}

main().catch((error) => {
  console.error(`verify-suite: unexpected error: ${error.stack || error.message}`);
  process.exitCode = 1;
});
