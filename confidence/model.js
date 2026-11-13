// Monte Carlo model behind the Confidence Lab. Pure functions, no DOM, so the
// same code runs in the browser and in scripts/verify-suite.mjs.
//
// Every number below that is not read from the repo's cost, risk, or schedule
// data is an ASSUMPTION. They are collected here as named constants, shown on
// screen under "Model assumptions", and the three that matter most are
// adjustable in the UI.

export const MODEL_DEFAULTS = Object.freeze({
  // Fixed trial count and seed: the same scenario always returns the same
  // numbers, which matters when the result is quoted in a talk.
  iterations: 10000,
  seed: 20260406,

  // ASSUMPTION: likelihood score to probability of occurring. Midpoints of a
  // typical 5x5 scale (under 10%, 10-25%, 25-50%, 50-75%, over 75%).
  likelihoodToProbability: Object.freeze({ 1: 0.05, 2: 0.175, 3: 0.375, 4: 0.625, 5: 0.875 }),

  // ASSUMPTION: impact score to cost consequence, as a share of the base cost
  // of the WBS elements the risk touches (most likely value if it occurs).
  impactToCostShare: Object.freeze({ 1: 0.01, 2: 0.035, 3: 0.075, 4: 0.125, 5: 0.2 }),

  // ASSUMPTION: impact score to months of slip on the first launch (most
  // likely value if the risk occurs and sits on the launch path).
  impactToSlipMonths: Object.freeze({ 1: 0.25, 2: 0.75, 3: 2, 4: 4.5, 5: 9 }),

  // ASSUMPTION: a realised consequence is triangular between these multiples
  // of its most likely value.
  consequenceSpread: Object.freeze([0.5, 1.5]),

  // ASSUMPTION: concurrent slips overlap. Total slip = the largest single slip
  // plus this share of the others.
  slipOverlapShare: 0.5,

  // ASSUMPTION (adjustable): share of the monthly burn that keeps running
  // while the launch slips.
  delayCostShare: 0.35,

  // ASSUMPTION (adjustable): correlation between element cost outcomes.
  correlation: 0.3,

  // ASSUMPTION (adjustable): scales every risk consequence (cost and slip).
  consequenceScale: 1,

  // Risks homed in these WBS branches can slip the first launch.
  launchPathWbs: Object.freeze(['1.2', '1.3', '1.4', '1.9', '1.10.1']),
  // The milestone whose date the schedule side of the model tracks.
  launchMilestoneId: 'M-024',
  // Risk categories that play out after launch, so they add cost but no slip.
  postLaunchCategories: Object.freeze(['Mission Operations']),

  // JUDGMENT CALL (flagged for review): R-021 is program cancellation or
  // restructuring. It is not a cost-growth event, so it starts switched off.
  excludedRiskIds: Object.freeze(['R-021']),
});

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standardNormal(random) {
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

// Abramowitz and Stegun 7.1.26, accurate to about 1.5e-7.
function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export function triangularInverse(u, low, mode, high) {
  if (!(high > low)) return mode;
  const split = (mode - low) / (high - low);
  if (u < split) return low + Math.sqrt(u * (high - low) * (mode - low));
  return high - Math.sqrt((1 - u) * (high - low) * (high - mode));
}

function inBranch(wbsId, branchId) {
  return wbsId === branchId || String(wbsId).startsWith(`${branchId}.`);
}

function topLevelWbs(wbsId) {
  const parts = String(wbsId || '').split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : String(wbsId || '');
}

// Turns the repo datasets into model inputs. `cost`, `risks`, `schedule` are
// the three app payloads; `crosswalk` is the suite crosswalk.
export function buildModelInputs({ cost, risks, schedule, crosswalk }, defaults = MODEL_DEFAULTS) {
  const root = cost.categories.find((item) => item.level === 0);
  const elements = cost.categories
    .filter((item) => item.level === 1)
    .map((item) => ({ id: item.id, name: item.name, low: item.lowUsd, base: item.baseUsd, high: item.highUsd }));
  const baseById = new Map(elements.map((item) => [item.id, item.base]));
  const pointEstimate = elements.reduce((sum, item) => sum + item.base, 0);
  const reserve = root.baseUsd - pointEstimate;

  const launchMilestone = schedule.milestones.find((item) => item.id === defaults.launchMilestoneId);
  const launchFy = Number(launchMilestone.date.slice(0, 4)) + (Number(launchMilestone.date.slice(5, 7)) >= 10 ? 1 : 0);
  const burnYears = cost.years.filter((year) => {
    const fy = Number(year.fy.slice(2));
    return fy <= launchFy && fy > launchFy - 3;
  });
  const monthlyBurn = burnYears.reduce((sum, year) => sum + year.directUsd, 0) / (burnYears.length * 12);

  const riskInputs = risks.risks.map((risk) => {
    const linked = crosswalk?.risk?.byId?.[risk.id]?.wbsIds || [risk.wbsId];
    const affected = (risk.elementWbsIds?.length ? risk.elementWbsIds : [topLevelWbs(risk.wbsId)]).filter((id) => baseById.has(id));
    const affectedBase = affected.reduce((sum, id) => sum + baseById.get(id), 0);
    const preLaunch = !defaults.postLaunchCategories.includes(risk.category);
    const onLaunchPath =
      preLaunch && linked.some((wbsId) => defaults.launchPathWbs.some((branch) => inBranch(wbsId, branch)));
    return {
      id: risk.id,
      title: risk.title,
      category: risk.category,
      likelihood: risk.likelihood,
      impact: risk.impact,
      priority: risk.priority,
      affected,
      affectedBase,
      onLaunchPath,
      probability: defaults.likelihoodToProbability[risk.likelihood] ?? 0,
      costMode: (defaults.impactToCostShare[risk.impact] ?? 0) * affectedBase,
      slipMode: onLaunchPath ? defaults.impactToSlipMonths[risk.impact] ?? 0 : 0,
    };
  });

  return {
    elements,
    risks: riskInputs,
    pointEstimate,
    reserve,
    budget: root.baseUsd,
    monthlyBurn,
    burnYears: burnYears.map((year) => year.fy),
    launchMilestone: { id: launchMilestone.id, name: launchMilestone.shortName || launchMilestone.name, date: launchMilestone.date },
  };
}

// Runs the simulation. `settings` may override correlation, consequenceScale,
// delayCostShare, iterations, seed, and `disabledRiskIds` (a Set or array).
export function runModel(inputs, settings = {}, defaults = MODEL_DEFAULTS) {
  const iterations = settings.iterations ?? defaults.iterations;
  const correlation = Math.min(Math.max(settings.correlation ?? defaults.correlation, 0), 0.99);
  const consequenceScale = settings.consequenceScale ?? defaults.consequenceScale;
  const delayCostShare = settings.delayCostShare ?? defaults.delayCostShare;
  const disabled = new Set(settings.disabledRiskIds ?? defaults.excludedRiskIds);
  const [spreadLow, spreadHigh] = defaults.consequenceSpread;
  const random = mulberry32(settings.seed ?? defaults.seed);

  const { elements, pointEstimate, monthlyBurn } = inputs;
  const activeRisks = inputs.risks.filter((risk) => !disabled.has(risk.id));
  const sharedWeight = Math.sqrt(correlation);
  const ownWeight = Math.sqrt(1 - correlation);

  const totals = new Float64Array(iterations);
  const slips = new Float64Array(iterations);
  const elementGrowth = new Float64Array(elements.length);
  const riskCost = new Float64Array(activeRisks.length);
  const riskSlip = new Float64Array(activeRisks.length);
  const riskHits = new Uint32Array(activeRisks.length);
  let delayCostSum = 0;

  for (let trial = 0; trial < iterations; trial += 1) {
    const shared = standardNormal(random);
    let total = 0;
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      const u = normalCdf(sharedWeight * shared + ownWeight * standardNormal(random));
      const value = triangularInverse(u, element.low, element.base, element.high);
      total += value;
      elementGrowth[index] += value - element.base;
    }

    let largestSlip = 0;
    let slipSum = 0;
    for (let index = 0; index < activeRisks.length; index += 1) {
      const risk = activeRisks[index];
      // Draws are consumed whether or not the risk occurs, so switching one
      // risk off does not reshuffle the outcomes of the others.
      const occurs = random() < risk.probability;
      const costDraw = triangularInverse(random(), spreadLow, 1, spreadHigh);
      const slipDraw = triangularInverse(random(), spreadLow, 1, spreadHigh);
      if (!occurs) continue;
      const cost = risk.costMode * consequenceScale * costDraw;
      const slip = risk.slipMode * consequenceScale * slipDraw;
      total += cost;
      riskCost[index] += cost;
      riskSlip[index] += slip;
      riskHits[index] += 1;
      slipSum += slip;
      if (slip > largestSlip) largestSlip = slip;
    }

    const slip = largestSlip + defaults.slipOverlapShare * (slipSum - largestSlip);
    const delayCost = slip * monthlyBurn * delayCostShare;
    delayCostSum += delayCost;
    totals[trial] = total + delayCost;
    slips[trial] = slip;
  }

  const sortedTotals = Float64Array.from(totals).sort();
  const sortedSlips = Float64Array.from(slips).sort();
  const mean = totals.reduce((sum, value) => sum + value, 0) / iterations;

  const sources = [
    ...elements.map((element, index) => ({
      kind: 'element',
      id: element.id,
      label: element.name,
      meanUsd: elementGrowth[index] / iterations,
    })),
    ...activeRisks.map((risk, index) => ({
      kind: 'risk',
      id: risk.id,
      label: risk.title,
      meanUsd: riskCost[index] / iterations,
    })),
    { kind: 'delay', id: 'delay', label: 'Cost of launch delay', meanUsd: delayCostSum / iterations },
  ].sort((left, right) => right.meanUsd - left.meanUsd);

  const riskStats = new Map(
    activeRisks.map((risk, index) => [
      risk.id,
      {
        meanCostUsd: riskCost[index] / iterations,
        meanSlipMonths: riskSlip[index] / iterations,
        hitRate: riskHits[index] / iterations,
      },
    ]),
  );

  return { iterations, totals, slips, sortedTotals, sortedSlips, mean, pointEstimate, sources, riskStats };
}

export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const position = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

// Share of trials at or below `value`.
export function confidenceAt(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low / sorted.length;
}

// Share of trials that meet both targets at once.
export function jointConfidence(result, costTarget, slipTarget) {
  let met = 0;
  for (let index = 0; index < result.iterations; index += 1) {
    if (result.totals[index] <= costTarget && result.slips[index] <= slipTarget) met += 1;
  }
  return met / result.iterations;
}

// Finds the pair of targets, each at the same marginal percentile, whose
// joint confidence reaches `goal`.
export function targetsForJointConfidence(result, goal = 0.7) {
  let low = goal;
  let high = 1;
  for (let step = 0; step < 30; step += 1) {
    const middle = (low + high) / 2;
    const joint = jointConfidence(result, percentile(result.sortedTotals, middle), percentile(result.sortedSlips, middle));
    if (joint < goal) low = middle;
    else high = middle;
  }
  return {
    marginal: high,
    costTarget: percentile(result.sortedTotals, high),
    slipTarget: percentile(result.sortedSlips, high),
  };
}
