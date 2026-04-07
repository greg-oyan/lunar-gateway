const COST_ANCHOR_GROUPS = [
  { anchorId: 'ppe', groupIds: ['1.3'] },
  { anchorId: 'halo', groupIds: ['1.4'] },
  { anchorId: 'airlock', groupIds: ['1.7'] },
  { anchorId: 'ihab', groupIds: ['1.5'] },
  { anchorId: 'esprit', groupIds: ['1.6'] },
  { anchorId: 'canadarm3', groupIds: ['1.8'] },
  { anchorId: 'launch', groupIds: ['1.10'] },
  { anchorId: 'backbone', groupIds: ['1.1', '1.2', '1.9', '1.11', '1.12'] },
];

function cleanValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function compareWbsId(left, right) {
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

function uniqueById(items = []) {
  const seen = new Map();
  items.filter(Boolean).forEach((item) => {
    if (item?.id && !seen.has(item.id)) {
      seen.set(item.id, item);
    }
  });
  return [...seen.values()];
}

function basenameFromPath(pathValue) {
  const cleanPath = cleanValue(pathValue);
  if (!cleanPath) return '';
  const withoutHash = cleanPath.split('#')[0];
  const withoutQuery = withoutHash.split('?')[0];
  return decodeURIComponent(withoutQuery).split('/').filter(Boolean).at(-1) || '';
}

const SIMULATION_MODULES = {
  PPE: {
    moduleKey: 'PPE',
    label: 'Power and Propulsion Element',
    primaryWbsId: '1.3',
    relation: 'direct',
    note: 'Direct simulation-to-WBS match.',
  },
  MHC: {
    moduleKey: 'MHC',
    label: 'Minimum Habitation Capability',
    primaryWbsId: '1.4',
    relation: 'closest',
    note: 'Mapped to HALO as the closest currently modeled habitation and logistics branch.',
  },
  IHAB: {
    moduleKey: 'IHAB',
    label: 'International Habitat',
    primaryWbsId: '1.5',
    relation: 'direct',
    note: 'Direct simulation-to-WBS match.',
  },
  USHAB: {
    moduleKey: 'USHAB',
    label: 'United States Habitat',
    primaryWbsId: '1.5',
    relation: 'closest',
    note: 'Mapped to I-HAB as the closest available habitation branch in the current explorer datasets.',
  },
  AIRLOCK: {
    moduleKey: 'AIRLOCK',
    label: 'Airlock',
    primaryWbsId: '1.7',
    relation: 'direct',
    note: 'Direct simulation-to-WBS match.',
  },
  EVR: {
    moduleKey: 'EVR',
    label: 'Extravehicular Robotics',
    primaryWbsId: '1.8',
    relation: 'direct',
    note: 'Mapped to Canadarm3 as the matching robotic-system branch.',
  },
};

const CONTROL_DOCUMENT_HINTS = [
  { pattern: /cost|financial|estimate|pricing|budget/, docIds: ['doc-cost-basis', 'doc-cost-estimate', 'doc-cost-detail'] },
  { pattern: /schedule|launch campaign|milestone|ims/, docIds: ['doc-master-schedule', 'doc-milestones'] },
  { pattern: /risk|reliability|fmea|safety/, docIds: ['doc-risk-register', 'doc-source-register'] },
  { pattern: /requirements|interface|icd|review package|configuration|baseline/, docIds: ['doc-card', 'doc-doc-tracker', 'doc-source-register'] },
  { pattern: /environmental/, docIds: ['doc-doc-tracker', 'doc-source-register'] },
  { pattern: /engineering report|analysis/, docIds: ['doc-source-register', 'doc-master-schedule'] },
];

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function dateValue(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(`${value}T00:00:00Z`).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function sortMilestones(left, right) {
  return dateValue(left.date) - dateValue(right.date) || cleanText(left.name).localeCompare(cleanText(right.name));
}

function getTopLevelWbsId(wbsId) {
  const parts = String(wbsId ?? '').split('.').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length < 2) return parts[0];
  return `${parts[0]}.${parts[1]}`;
}

function findCostAnchorId(wbsId) {
  const topLevelWbsId = getTopLevelWbsId(wbsId);
  const match = COST_ANCHOR_GROUPS.find((group) => group.groupIds.includes(topLevelWbsId));
  return match?.anchorId || '';
}

function getSimulationModuleKeys(wbsId) {
  const topLevelWbsId = getTopLevelWbsId(wbsId);
  return Object.values(SIMULATION_MODULES)
    .filter((moduleRecord) => getTopLevelWbsId(moduleRecord.primaryWbsId) === topLevelWbsId)
    .map((moduleRecord) => moduleRecord.moduleKey);
}

function addScore(scoreMap, docCatalog, docId, points) {
  if (!docId || !docCatalog.byId[docId]) return;
  scoreMap.set(docId, (scoreMap.get(docId) || 0) + points);
}

function addScores(scoreMap, docCatalog, docIds, points) {
  docIds.forEach((docId) => addScore(scoreMap, docCatalog, docId, points));
}

function sortDocIds(scoreMap, docCatalog) {
  return [...scoreMap.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return docCatalog.byId[left[0]].title.localeCompare(docCatalog.byId[right[0]].title);
    })
    .map(([docId]) => docId);
}

function collectSourceDocIdsFromLinks(items, docCatalog, scoreMap, points) {
  items.forEach((item) => {
    const candidatePaths = [item?.href, item?.localHref, item?.externalHref].filter(Boolean);
    candidatePaths.forEach((pathValue) => {
      const fileName = basenameFromPath(pathValue);
      addScore(scoreMap, docCatalog, docCatalog.byFileName[fileName], points);
    });
  });
}

function collectControlDocumentHints(controlDocuments, docCatalog, scoreMap) {
  controlDocuments.forEach((documentRecord) => {
    const fingerprint = lowerText(`${documentRecord.type} ${documentRecord.name} ${documentRecord.notes}`);
    CONTROL_DOCUMENT_HINTS.forEach((hint) => {
      if (hint.pattern.test(fingerprint)) {
        addScores(scoreMap, docCatalog, hint.docIds, 3);
      }
    });
  });
}

function buildDocumentCatalog(documentsManifest) {
  const byId = {};
  const byFileName = {};

  (documentsManifest.documents || []).forEach((documentRecord) => {
    let preferredRoute = 'documents';
    if (documentRecord.category === 'WBS Dataset') preferredRoute = 'wbs';
    if (documentRecord.category === 'Cost Dataset' || documentRecord.category === 'Contract Pricing Dataset') preferredRoute = 'cost';
    if (documentRecord.category === 'Schedule Dataset') preferredRoute = 'schedule';
    if (documentRecord.category === 'Risk Dataset') preferredRoute = 'risk';

    byId[documentRecord.id] = {
      id: documentRecord.id,
      title: documentRecord.title,
      filename: documentRecord.filename,
      category: documentRecord.category,
      preferredRoute,
    };
    byFileName[documentRecord.filename] = documentRecord.id;
  });

  return { byId, byFileName };
}

function scoreWbsSourceDocs(node, docCatalog) {
  const scoreMap = new Map();

  addScores(scoreMap, docCatalog, ['doc-wbs', 'doc-wbs-dictionary'], 5);

  if (node.related.cost.estimates.length || node.related.cost.contractHighlights.length) {
    addScores(scoreMap, docCatalog, ['doc-cost-basis', 'doc-cost-estimate', 'doc-cost-detail'], 4);
    addScore(scoreMap, docCatalog, 'doc-section-b', 3);
  }

  if (node.metrics.taskCount || node.related.schedule.milestones.length) {
    addScores(scoreMap, docCatalog, ['doc-master-schedule', 'doc-milestones'], 4);
  }

  if (node.related.risks.items.length) {
    addScore(scoreMap, docCatalog, 'doc-risk-register', 5);
  }

  if (node.related.documents.items.length) {
    addScores(scoreMap, docCatalog, ['doc-doc-tracker', 'doc-source-register'], 4);
    collectControlDocumentHints(node.related.documents.items, docCatalog, scoreMap);
  }

  if (node.related.glossary?.items?.length) {
    addScore(scoreMap, docCatalog, 'doc-glossary', 4);
  }

  return sortDocIds(scoreMap, docCatalog);
}

function scoreMilestoneSourceDocs(milestone, docCatalog) {
  const scoreMap = new Map();

  addScores(scoreMap, docCatalog, ['doc-master-schedule', 'doc-milestones'], 5);

  if (milestone.linkedRisks.length) {
    addScore(scoreMap, docCatalog, 'doc-risk-register', 5);
  }

  if (milestone.linkedDocuments.length) {
    addScores(scoreMap, docCatalog, ['doc-doc-tracker', 'doc-source-register'], 4);
    collectControlDocumentHints(milestone.linkedDocuments, docCatalog, scoreMap);
  }

  collectSourceDocIdsFromLinks(milestone.linkedSources, docCatalog, scoreMap, 6);

  return sortDocIds(scoreMap, docCatalog);
}

function scoreRiskSourceDocs(risk, riskMilestones, primaryWbsContext, docCatalog) {
  const scoreMap = new Map();

  addScore(scoreMap, docCatalog, 'doc-risk-register', 6);
  collectSourceDocIdsFromLinks(riskMilestones.flatMap((milestone) => milestone.linkedSources), docCatalog, scoreMap, 5);
  collectControlDocumentHints(riskMilestones.flatMap((milestone) => milestone.linkedDocuments), docCatalog, scoreMap);

  const riskFingerprint = lowerText(`${risk.title} ${risk.category} ${risk.description} ${(risk.tags || []).join(' ')}`);
  if (riskFingerprint.includes('schedule') || riskFingerprint.includes('launch')) {
    addScores(scoreMap, docCatalog, ['doc-master-schedule', 'doc-milestones'], 3);
  }
  if (riskFingerprint.includes('cost') || riskFingerprint.includes('contract')) {
    addScores(scoreMap, docCatalog, ['doc-cost-basis', 'doc-cost-estimate'], 3);
  }

  addScores(scoreMap, docCatalog, primaryWbsContext?.documents?.sourceDocIds || [], 2);

  return sortDocIds(scoreMap, docCatalog);
}

function buildPrimaryMilestoneContext(node, scheduleData, phasesById) {
  const directTasks = node.related.schedule.tasks.filter((task) => task.wbsId === node.id);
  const directTaskIds = new Set(directTasks.map((task) => task.id));
  const directMilestones = node.related.schedule.milestones
    .map((milestone) => scheduleData.milestones.find((item) => item.id === milestone.id) || milestone)
    .filter(Boolean);

  const exactTaskMilestones = directMilestones.filter(
    (milestone) => directTaskIds.has(milestone.relatedTask) || milestone.task?.wbsId === node.id,
  );

  const milestonesFromSchedule = scheduleData.milestones.filter((milestone) => milestone.task?.wbsId === node.id);
  const milestonePool =
    exactTaskMilestones.length > 0
      ? exactTaskMilestones
      : milestonesFromSchedule.length > 0
        ? milestonesFromSchedule
        : directMilestones;

  const sortedMilestones = [...milestonePool].sort(sortMilestones);
  const primaryMilestone = sortedMilestones[0] || null;
  const primaryTaskId = cleanText(primaryMilestone?.relatedTask || primaryMilestone?.task?.id);

  let reason = `No milestone is directly linked to WBS ${node.id} in the current schedule extract.`;
  if (primaryMilestone && exactTaskMilestones.length > 0 && primaryTaskId) {
    reason = `Selected because milestone ${primaryMilestone.id} is backed by task ${primaryTaskId}, which maps directly to WBS ${node.id}.`;
  } else if (primaryMilestone && milestonesFromSchedule.length > 0) {
    reason = `Selected because milestone ${primaryMilestone.id} is tied to a task mapped directly to WBS ${node.id}.`;
  } else if (primaryMilestone && exactTaskMilestones.length > 0) {
    reason = `Selected because milestone ${primaryMilestone.id} is tied directly to WBS ${node.id} in the current schedule extract.`;
  } else if (primaryMilestone) {
    reason = `Selected as the clearest milestone already linked to WBS ${node.id} in the current roll-up.`;
  }

  let phaseId = primaryMilestone?.phaseId || '';
  if (!phaseId) {
    const probeDate = directTasks
      .map((task) => task.startDate || task.endDate)
      .find(Boolean);
    const probeValue = dateValue(probeDate);
    phaseId =
      scheduleData.phases.find(
        (phase) => probeValue >= dateValue(phase.start) && probeValue <= dateValue(phase.end),
      )?.id || '';
  }

  return {
    phaseId,
    milestoneIds: uniqueById([...directMilestones, ...milestonesFromSchedule]).map((milestone) => milestone.id),
    primaryMilestoneId: primaryMilestone?.id || '',
    taskIds: uniqueById(directTasks).map((task) => task.id),
    reason,
    phaseName: phaseId ? phasesById.get(phaseId)?.name || '' : '',
  };
}

function buildWbsContexts(wbsData, scheduleData, docCatalog) {
  const phasesById = new Map(scheduleData.phases.map((phase) => [phase.id, phase]));
  const contexts = {};

  wbsData.nodes.forEach((node) => {
    const scheduleContext = buildPrimaryMilestoneContext(node, scheduleData, phasesById);
    const riskIds = uniqueById(node.related.risks.items).map((risk) => risk.id);
    const controlDocuments = uniqueById(node.related.documents.items);
    const sourceDocIds = scoreWbsSourceDocs(node, docCatalog);

    contexts[node.id] = {
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      topLevelWbsId: getTopLevelWbsId(node.id),
      cost: {
        primaryCategoryId: node.id,
        anchorId: findCostAnchorId(node.id),
        relation: 'direct',
      },
      schedule: scheduleContext,
      risks: {
        ids: riskIds,
        primaryRiskId:
          [...node.related.risks.items].sort((left, right) => Number(right.riskScore) - Number(left.riskScore))[0]?.id || '',
        reason: riskIds.length
          ? `Showing risks linked directly to WBS ${node.id} in the current risk roll-up.`
          : `No direct risks are linked to WBS ${node.id} in the current register.`,
      },
      documents: {
        controlDocuments,
        sourceDocIds,
        reason: controlDocuments.length
          ? 'Showing the strongest downloadable source-library files plus the controlled records already tracked against this branch.'
          : 'Showing the strongest available source-library files for this branch.',
      },
      simulation: {
        moduleKeys: getSimulationModuleKeys(node.id),
      },
    };
  });

  return contexts;
}

function buildMilestoneContexts(scheduleData, wbsContexts, docCatalog) {
  const contexts = {};

  scheduleData.milestones.forEach((milestone) => {
    const primaryWbsId = cleanText(milestone.task?.wbsId);
    const relatedWbsIds = primaryWbsId ? [primaryWbsId] : [];
    const sourceDocIds = scoreMilestoneSourceDocs(milestone, docCatalog);

    contexts[milestone.id] = {
      id: milestone.id,
      name: milestone.name,
      primaryWbsId,
      wbsIds: relatedWbsIds,
      cost: {
        anchorId: primaryWbsId ? wbsContexts[primaryWbsId]?.cost.anchorId || '' : '',
        categoryIds: primaryWbsId ? [primaryWbsId] : [],
      },
      risks: {
        ids: milestone.linkedRisks.map((risk) => risk.id),
      },
      documents: {
        controlDocuments: uniqueById(milestone.linkedDocuments),
        sourceDocIds,
      },
      simulation: {
        moduleKeys: primaryWbsId ? wbsContexts[primaryWbsId]?.simulation.moduleKeys || [] : [],
      },
      reason: primaryWbsId
        ? `Selected because task ${milestone.task.id} maps directly to WBS ${primaryWbsId}.`
        : 'Selected because this milestone is already one of the strongest schedule anchors in the current dataset.',
    };
  });

  return contexts;
}

function buildRiskContexts(riskManifest, scheduleData, wbsContexts, docCatalog) {
  const riskWbsMap = new Map();

  Object.values(wbsContexts).forEach((context) => {
    context.risks.ids.forEach((riskId) => {
      if (!riskWbsMap.has(riskId)) riskWbsMap.set(riskId, new Set());
      riskWbsMap.get(riskId).add(context.id);
    });
  });

  const contexts = {};

  (riskManifest.risks || []).forEach((risk) => {
    const wbsIds = [...(riskWbsMap.get(risk.id) || new Set())].sort(compareWbsId);
    const primaryWbsId = wbsIds[0] || '';
    const linkedMilestones = scheduleData.milestones
      .filter((milestone) => milestone.linkedRisks.some((linkedRisk) => linkedRisk.id === risk.id))
      .sort(sortMilestones);
    const primaryWbsContext = primaryWbsId ? wbsContexts[primaryWbsId] : null;

    contexts[risk.id] = {
      id: risk.id,
      title: risk.title,
      primaryWbsId,
      wbsIds,
      milestoneIds: linkedMilestones.map((milestone) => milestone.id),
      primaryMilestoneId:
        linkedMilestones[0]?.id || primaryWbsContext?.schedule.primaryMilestoneId || '',
      documents: {
        controlDocuments: uniqueById(linkedMilestones.flatMap((milestone) => milestone.linkedDocuments)),
        sourceDocIds: scoreRiskSourceDocs(risk, linkedMilestones, primaryWbsContext, docCatalog),
      },
      cost: {
        anchorId: primaryWbsContext?.cost.anchorId || '',
        categoryIds: primaryWbsId ? [primaryWbsId] : [],
      },
      simulation: {
        moduleKeys: primaryWbsContext?.simulation.moduleKeys || [],
      },
      reason: primaryWbsId
        ? `Risk ${risk.id} is tied most directly to WBS ${primaryWbsId} in the current register and schedule cross-links.`
        : `Risk ${risk.id} is not tied to one direct WBS branch in the current crosswalk.`,
    };
  });

  return contexts;
}

function buildSimulationContexts(wbsContexts) {
  return Object.fromEntries(
    Object.entries(SIMULATION_MODULES).map(([moduleKey, moduleRecord]) => {
      const primaryWbsContext = wbsContexts[moduleRecord.primaryWbsId];
      return [
        moduleKey,
        {
          ...moduleRecord,
          costAnchorId: primaryWbsContext?.cost.anchorId || '',
          primaryMilestoneId: primaryWbsContext?.schedule.primaryMilestoneId || '',
          primaryRiskId: primaryWbsContext?.risks.primaryRiskId || '',
          documents: primaryWbsContext?.documents || { controlDocuments: [], sourceDocIds: [], reason: '' },
        },
      ];
    }),
  );
}

function buildAnchorContexts(wbsContexts) {
  return Object.fromEntries(
    COST_ANCHOR_GROUPS.map((group) => {
      const linkedContexts = group.groupIds
        .map((wbsId) => wbsContexts[wbsId])
        .filter(Boolean);
      const linkedMilestoneIds = linkedContexts.flatMap((context) => context.schedule.milestoneIds);
      const linkedRiskIds = linkedContexts.flatMap((context) => context.risks.ids);
      const controlDocuments = linkedContexts.flatMap((context) => context.documents.controlDocuments);
      const sourceDocIds = linkedContexts.flatMap((context) => context.documents.sourceDocIds);
      const moduleKeys = linkedContexts.flatMap((context) => context.simulation.moduleKeys);

      return [
        group.anchorId,
        {
          id: group.anchorId,
          wbsIds: linkedContexts.map((context) => context.id).sort(compareWbsId),
          primaryWbsId: linkedContexts[0]?.id || '',
          primaryMilestoneId: uniqueById(
            linkedMilestoneIds
              .map((milestoneId) => ({ id: milestoneId }))
              .filter(Boolean),
          )[0]?.id || '',
          riskIds: uniqueById(linkedRiskIds.map((riskId) => ({ id: riskId }))).map((item) => item.id),
          documents: {
            controlDocuments: uniqueById(controlDocuments),
            sourceDocIds: uniqueById(sourceDocIds.map((docId) => ({ id: docId }))).map((item) => item.id),
          },
          simulation: {
            moduleKeys: uniqueById(moduleKeys.map((moduleKey) => ({ id: moduleKey }))).map((item) => item.id),
          },
          reason: linkedContexts.length
            ? `This cost area rolls up WBS ${linkedContexts.map((context) => context.id).sort(compareWbsId).join(', ')}.`
            : 'No direct WBS mapping is exposed for this cost area in the current crosswalk.',
        },
      ];
    }),
  );
}

function buildPhaseContexts(scheduleData, milestoneContexts) {
  return Object.fromEntries(
    scheduleData.phases.map((phase) => {
      const phaseMilestones = scheduleData.milestones
        .filter((milestone) => milestone.phaseId === phase.id)
        .sort(sortMilestones);
      const milestoneIds = phaseMilestones.map((milestone) => milestone.id);
      const wbsIds = uniqueById(
        phaseMilestones
          .flatMap((milestone) => milestoneContexts[milestone.id]?.wbsIds || [])
          .map((wbsId) => ({ id: wbsId })),
      )
        .map((item) => item.id)
        .sort(compareWbsId);
      const riskIds = uniqueById(
        phaseMilestones
          .flatMap((milestone) => milestoneContexts[milestone.id]?.risks.ids || [])
          .map((riskId) => ({ id: riskId })),
      ).map((item) => item.id);
      const controlDocuments = uniqueById(
        phaseMilestones.flatMap((milestone) => milestoneContexts[milestone.id]?.documents.controlDocuments || []),
      );
      const sourceDocIds = uniqueById(
        phaseMilestones
          .flatMap((milestone) => milestoneContexts[milestone.id]?.documents.sourceDocIds || [])
          .map((docId) => ({ id: docId })),
      ).map((item) => item.id);
      const moduleKeys = uniqueById(
        phaseMilestones
          .flatMap((milestone) => milestoneContexts[milestone.id]?.simulation.moduleKeys || [])
          .map((moduleKey) => ({ id: moduleKey })),
      ).map((item) => item.id);

      return [
        phase.id,
        {
          id: phase.id,
          name: phase.name,
          milestoneIds,
          primaryMilestoneId: milestoneIds[0] || '',
          wbsIds,
          primaryWbsId: wbsIds[0] || '',
          riskIds,
          documents: {
            controlDocuments,
            sourceDocIds,
          },
          simulation: {
            moduleKeys,
          },
          reason: wbsIds.length
            ? `This phase is tied most directly to WBS ${wbsIds.slice(0, 3).join(', ')} in the current schedule crosswalk.`
            : 'No direct WBS branch is attached to this phase in the current crosswalk.',
        },
      ];
    }),
  );
}

export function buildSuiteCrosswalk({
  wbsData,
  scheduleData,
  riskManifest,
  documentsManifest,
}) {
  const docCatalog = buildDocumentCatalog(documentsManifest);
  const wbsContexts = buildWbsContexts(wbsData, scheduleData, docCatalog);
  const milestoneContexts = buildMilestoneContexts(scheduleData, wbsContexts, docCatalog);
  const phaseContexts = buildPhaseContexts(scheduleData, milestoneContexts);
  const riskContexts = buildRiskContexts(riskManifest, scheduleData, wbsContexts, docCatalog);
  const anchorContexts = buildAnchorContexts(wbsContexts);
  const simulationContexts = buildSimulationContexts(wbsContexts);

  return {
    generatedAt: new Date().toISOString(),
    documents: docCatalog,
    wbs: { byId: wbsContexts },
    schedule: { byMilestoneId: milestoneContexts, byPhaseId: phaseContexts },
    risk: { byId: riskContexts },
    cost: { byAnchorId: anchorContexts },
    simulation: { byModuleKey: simulationContexts },
  };
}
