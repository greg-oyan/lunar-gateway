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
const WS5_LANDED = true;

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
      // Dataset content is exempt from the chrome-copy budget: data folders
      // and the server.mjs generators that author whyItMatters/plainEnglish
      // narrative fields.
      if (file.includes(`${path.sep}data${path.sep}`)) continue;
      if (file.endsWith('server.mjs')) continue;
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

// Scope is explicit-only: the top suite nav must never derive params from the
// current selection. These are string-level checks against each app's
// buildTopNavContext and its applySuiteNav call sites - deliberately narrow so
// item-level "Open in X" link builders are not flagged, and admittedly brittle
// against reformatting (noted here so a rename or refactor updates them too).
async function checkTopNavPurity() {
  for (const appDir of APP_DIRS) {
    const file = `${appDir}/app.js`;
    let contents = '';
    try {
      contents = await fs.readFile(path.join(repoRoot, file), 'utf8');
    } catch {
      fail('top-nav', `${file}: unable to read`);
      continue;
    }

    const start = contents.indexOf('function buildTopNavContext');
    if (start === -1) {
      fail('top-nav', `${file}: missing buildTopNavContext`);
      continue;
    }
    const end = contents.indexOf('\n}', start);
    const body = contents.slice(start, end);

    if (!/wbs:\s*getScope\(\)\?\.id\s*\|\|\s*''/.test(body)) {
      fail('top-nav', `${file}: top-nav wbs must be getScope()?.id || '' and nothing else`);
    }
    if (/primaryWbsId|wbsId|context\.wbs|sharedContext/.test(body)) {
      fail('top-nav', `${file}: derived-wbs reference inside buildTopNavContext`);
    }
    if (/(milestone|risk|doc|module|phase)\s*:/.test(body)) {
      fail('top-nav', `${file}: derived param key inside buildTopNavContext`);
    }

    const navCalls = contents.match(/applySuiteNav\([^)]*\)/g) || [];
    if (!navCalls.length) {
      fail('top-nav', `${file}: no applySuiteNav call found`);
    }
    navCalls.forEach((call) => {
      if (!call.includes('buildTopNavContext()')) {
        fail('top-nav', `${file}: applySuiteNav must be fed by buildTopNavContext(): ${call.replace(/\s+/g, ' ')}`);
      }
      if (/(milestone|risk|doc|module|phase)\s*:/.test(call)) {
        fail('top-nav', `${file}: derived param key passed to applySuiteNav: ${call.replace(/\s+/g, ' ')}`);
      }
    });
  }
}

// Item links must never inject a derived wbs (which would silently scope the
// destination). The only legal `wbs:` value in a navigation params object is an
// active scope (getScope()?.id) or the risk app's navWbsValue() wrapper around
// it. This flags derived-wbs fallbacks - node.id, primaryWbsId, context.wbsId -
// wherever they are used as a `wbs:` value. It matches a derived *property
// access* (`node.id`, `.primaryWbsId`, `.wbsId`), so a bare validated scope id
// (e.g. `wbs: wbsId` in applySelectionScope, where wbsId came from
// resolveScopeFromSelection) is not flagged. The top-nav builder already uses
// getScope()?.id, and getScope reads state.sharedContext?.wbs (never a `wbs:`
// value), so both are excluded by construction.
const DERIVED_WBS_VALUE = /wbs:\s*[^,\n}]*(\bnode\.id\b|\.primaryWbsId\b|\.wbsId\b)/;

// Documents scoping must be honest: a program-wide class has to exist, and no
// WBS node may map to the entire library (which would make "scoping" a no-op).
async function checkDocumentScoping() {
  const crosswalk = await readJson('suite-assets/data/gateway-crosswalk.json');
  const byId = crosswalk?.documents?.byId || {};
  const totalDocs = Object.keys(byId).length;
  if (!totalDocs) {
    fail('doc-scoping', 'Crosswalk documents.byId is empty.');
    return;
  }

  const programWideIds = crosswalk?.documents?.programWideIds;
  if (!Array.isArray(programWideIds) || !programWideIds.length) {
    fail('doc-scoping', 'Crosswalk must expose a non-empty documents.programWideIds program-wide class.');
  }

  // Every document must be classified: element-specific (elementWbsIds set) or
  // program-wide, never both and never neither.
  Object.values(byId).forEach((documentRecord) => {
    const elementWbsIds = documentRecord.elementWbsIds;
    if (!Array.isArray(elementWbsIds)) {
      fail('doc-scoping', `${documentRecord.id}: missing elementWbsIds classification array.`);
      return;
    }
    const isProgramWide = (programWideIds || []).includes(documentRecord.id);
    if (elementWbsIds.length && isProgramWide) {
      fail('doc-scoping', `${documentRecord.id}: classified as both element-specific and program-wide.`);
    }
    if (!elementWbsIds.length && !isProgramWide) {
      fail('doc-scoping', `${documentRecord.id}: classified as neither element-specific nor program-wide.`);
    }
  });

  const maxPerNode = Math.max(
    0,
    ...Object.values(crosswalk?.wbs?.byId || {}).map((node) => (node.documents?.sourceDocIds || []).length),
  );
  if (maxPerNode >= totalDocs) {
    fail('doc-scoping', `A WBS node maps to all ${totalDocs} documents (max per node ${maxPerNode}); scoping would be a no-op.`);
  }
}

// Matches a single buildSuiteAction(route, label, { ...flat params... }) call.
// The params objects in these builders are flat (no nested braces), so a
// non-greedy {...} capture is sufficient.
const SUITE_ACTION_CALL = /buildSuiteAction\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*\{([\s\S]*?)\}\s*\)/g;

async function checkItemLinkWbsPurity() {
  for (const appDir of APP_DIRS) {
    const file = `${appDir}/app.js`;
    let contents = '';
    try {
      contents = await fs.readFile(path.join(repoRoot, file), 'utf8');
    } catch {
      fail('item-link-wbs', `${file}: unable to read`);
      continue;
    }
    contents.split('\n').forEach((line, index) => {
      if (DERIVED_WBS_VALUE.test(line)) {
        fail('item-link-wbs', `${file}:${index + 1} derived wbs in a link param: ${line.trim()}`);
      }
    });

    // An item link may carry `wbs` only when paired with the explicit `scope`
    // marker - that is the only way a scope (and never a derived association)
    // travels with an item link. buildTopNavContext is not a buildSuiteAction
    // call, so the top nav (bare `wbs`, no marker) is correctly excluded here.
    for (const match of contents.matchAll(SUITE_ACTION_CALL)) {
      const block = match[1];
      if (/\bwbs:/.test(block) && !/\bscope:/.test(block)) {
        fail('item-link-wbs', `${file}: item link carries wbs without a scope marker: ${match[0].replace(/\s+/g, ' ').slice(0, 80)}...`);
      }
    }
  }
}

// The WBS app must treat an item id as context when an explicit scope is
// active, never replacing the scoped branch with an item-derived (possibly
// out-of-subtree) WBS id. These are string-level guards on the source: brittle
// against renames, but they pin the intent so a future refactor that breaks the
// rule is caught. They also confirm the wbsIsScope rule is documented as the
// final three-case rule (bare wbs / wbs+item+marker / wbs+item without marker).
async function checkScopeAwareWbsSelection() {
  // 1. resolveSelectedIdFromContext in wbs/app.js must be scope-aware: when
  //    actively scoped it returns the scope id (sharedContext.wbs), not an
  //    item-derived branch.
  let wbsApp = '';
  try {
    wbsApp = await fs.readFile(path.join(repoRoot, 'wbs/app.js'), 'utf8');
  } catch {
    fail('scope-aware-wbs', 'wbs/app.js: unable to read');
    return;
  }
  const start = wbsApp.indexOf('function resolveSelectedIdFromContext');
  if (start === -1) {
    fail('scope-aware-wbs', 'wbs/app.js: missing resolveSelectedIdFromContext');
  } else {
    const body = wbsApp.slice(start, wbsApp.indexOf('\n}', start));
    if (!/wbsIsScope\(sharedContext\)/.test(body)) {
      fail('scope-aware-wbs', 'resolveSelectedIdFromContext must branch on wbsIsScope(sharedContext)');
    }
    // The scoped branch must resolve the selection from sharedContext.wbs (the
    // active scope id), guaranteeing an item id cannot re-home the scope.
    if (!/wbsIsScope\(sharedContext\)\)\s*\{\s*return[^}]*sharedContext\.wbs/.test(body)) {
      fail('scope-aware-wbs', 'the scoped branch of resolveSelectedIdFromContext must return sharedContext.wbs');
    }
  }

  // 2. The wbsIsScope rule must be documented as the final three-case rule:
  //    its comment has to mention the scope marker, not the stale absolute
  //    "wbs alongside an item id is never a scope".
  let ctx = '';
  try {
    ctx = await fs.readFile(path.join(repoRoot, 'suite-assets/suite-context.js'), 'utf8');
  } catch {
    fail('scope-aware-wbs', 'suite-assets/suite-context.js: unable to read');
    return;
  }
  const fnIndex = ctx.indexOf('export function wbsIsScope');
  const commentRegion = fnIndex === -1 ? '' : ctx.slice(Math.max(0, fnIndex - 700), fnIndex);
  if (!/scope=1|scope marker/i.test(commentRegion)) {
    fail('scope-aware-wbs', 'wbsIsScope must be documented with the scope=1 marker rule (three-case rule)');
  }
}

// Selection drives an exact WBS scope across the suite. These string-level and
// data-level guards pin the behavior: WBS node/structure selection auto-scopes,
// the non-WBS apps auto-scope from a selection's primary WBS home, Schedule
// never falls back to its default selection while actively scoped, scope
// filtering supports exact ids at any depth, and Clear drops both wbs + scope.
async function checkSelectionScoping() {
  const read = async (rel) => {
    try {
      return await fs.readFile(path.join(repoRoot, rel), 'utf8');
    } catch {
      fail('selection-scope', `${rel}: unable to read`);
      return '';
    }
  };

  // WBS: selectNode auto-scopes (non-root) via resolveScopeFromSelection, and
  // the old explicit-arm constant/control is gone.
  const wbsApp = await read('wbs/app.js');
  const selStart = wbsApp.indexOf('function selectNode');
  const selBody = selStart === -1 ? '' : wbsApp.slice(selStart, wbsApp.indexOf('\n}', selStart));
  if (!/scopeArmed\s*=\s*Boolean\(resolveScopeFromSelection\(/.test(selBody)) {
    fail('selection-scope', 'wbs selectNode must auto-scope via resolveScopeFromSelection');
  }
  if (/STRUCTURE_CLICK_SCOPES/.test(wbsApp)) {
    fail('selection-scope', 'STRUCTURE_CLICK_SCOPES must be removed - selection auto-scopes now');
  }
  if (!/structureSvg\.addEventListener\('click'[\s\S]*?selectNode\(nodeId\)/.test(wbsApp)) {
    fail('selection-scope', 'structure-view node click must call selectNode (auto-scope)');
  }

  // Non-WBS apps auto-scope from a selection via resolveScopeFromSelection.
  for (const appDir of ['risk', 'cost', 'schedule', 'documents']) {
    const src = await read(`${appDir}/app.js`);
    if (!/function applySelectionScope\(/.test(src) || !/resolveScopeFromSelection\(/.test(src)) {
      fail('selection-scope', `${appDir}: missing applySelectionScope via resolveScopeFromSelection`);
    }
  }

  // Schedule must not fall back to its default selection while actively scoped.
  const sched = await read('schedule/app.js');
  const riStart = sched.indexOf('function resolveInitialSelection');
  const riBody = riStart === -1 ? '' : sched.slice(riStart, sched.indexOf('\n}\n', riStart));
  const scopeIdx = riBody.indexOf('wbsIsScope(state.sharedContext)');
  const defIdx = riBody.indexOf('defaultSelection');
  if (scopeIdx === -1) {
    fail('selection-scope', 'schedule resolveInitialSelection must branch on wbsIsScope(state.sharedContext)');
  } else if (defIdx !== -1 && defIdx < scopeIdx) {
    // defaultSelection must only appear in the unscoped tail (after the active-
    // scope branch has already returned an in-scope item or null).
    fail('selection-scope', 'schedule active-scope branch must not fall back to defaultSelection');
  }

  // Clear removes both wbs and scope everywhere a scope can be set.
  for (const appDir of ['risk', 'cost', 'schedule', 'documents']) {
    const src = await read(`${appDir}/app.js`);
    if (!/delete state\.sharedContext\.wbs;[\s\S]{0,80}delete state\.sharedContext\.scope;/.test(src)) {
      fail('selection-scope', `${appDir}: clearScope must delete both wbs and scope`);
    }
  }
  // WBS clears via resetView, which wipes the whole shared context.
  if (!/function resetView\(\)[\s\S]*?state\.sharedContext = \{\};/.test(wbsApp)) {
    fail('selection-scope', 'wbs resetView must reset state.sharedContext (clears wbs + scope)');
  }

  // Scope filtering supports exact WBS ids at any depth (prefix subtree test).
  const crosswalk = await readJson('suite-assets/data/gateway-crosswalk.json');
  const has = (scopeId, candidate) => candidate === scopeId || candidate.startsWith(`${scopeId}.`);
  const deep = Object.keys(crosswalk?.wbs?.byId || {}).find((id) => id.split('.').length >= 3);
  if (deep) {
    const parent = deep.split('.').slice(0, -1).join('.');
    if (!has(deep, deep)) fail('selection-scope', `subtree for ${deep} must include itself`);
    if (has(deep, parent)) fail('selection-scope', `exact scope ${deep} must not include its parent ${parent}`);
    if (!has(parent, deep)) fail('selection-scope', `scope ${parent} must include descendant ${deep}`);
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
  await checkTopNavPurity();
  await checkItemLinkWbsPurity();
  await checkScopeAwareWbsSelection();
  await checkSelectionScoping();
  await checkDocumentScoping();
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
