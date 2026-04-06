import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildDataset as buildWbsDataset } from '../wbs/server.mjs';
import { buildSchedulePayload } from '../schedule/server.mjs';
import { getDataset as buildCostDataset } from '../cost/server.mjs';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');

const outputs = [
  { relativePath: 'wbs/data/gateway-wbs.json', loader: buildWbsDataset },
  { relativePath: 'schedule/data/gateway-schedule.json', loader: buildSchedulePayload },
  { relativePath: 'cost/data/gateway-cost.json', loader: buildCostDataset },
];

for (const output of outputs) {
  const absolutePath = path.join(repoRoot, output.relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const payload = await output.loader();
  await fs.writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${output.relativePath}`);
}
