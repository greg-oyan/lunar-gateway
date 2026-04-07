import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildDataset as buildWbsDataset } from '../wbs/server.mjs';
import { buildSchedulePayload } from '../schedule/server.mjs';
import { getDataset as buildCostDataset } from '../cost/server.mjs';
import { buildSuiteCrosswalk } from './build-suite-crosswalk.mjs';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');

const outputs = [
  { key: 'wbsData', relativePath: 'wbs/data/gateway-wbs.json', loader: buildWbsDataset },
  { key: 'scheduleData', relativePath: 'schedule/data/gateway-schedule.json', loader: buildSchedulePayload },
  { key: 'costData', relativePath: 'cost/data/gateway-cost.json', loader: buildCostDataset },
];

const generatedPayloads = {};

for (const output of outputs) {
  const absolutePath = path.join(repoRoot, output.relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const payload = await output.loader();
  generatedPayloads[output.key] = payload;
  await fs.writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${output.relativePath}`);
}

const [riskManifest, documentsManifest] = await Promise.all([
  fs.readFile(path.join(repoRoot, 'risk/data/risks.json'), 'utf8').then((contents) => JSON.parse(contents)),
  fs.readFile(path.join(repoRoot, 'documents/data/documents.json'), 'utf8').then((contents) => JSON.parse(contents)),
]);

const crosswalk = buildSuiteCrosswalk({
  wbsData: generatedPayloads.wbsData,
  scheduleData: generatedPayloads.scheduleData,
  costData: generatedPayloads.costData,
  riskManifest,
  documentsManifest,
});

const crosswalkPath = path.join(repoRoot, 'suite-assets/data/gateway-crosswalk.json');
await fs.mkdir(path.dirname(crosswalkPath), { recursive: true });
await fs.writeFile(crosswalkPath, `${JSON.stringify(crosswalk, null, 2)}\n`, 'utf8');
console.log('Wrote suite-assets/data/gateway-crosswalk.json');
