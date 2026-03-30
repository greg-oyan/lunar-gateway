import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getDataset as buildCostDataset } from './cost/server.mjs';
import { buildSchedulePayload } from './schedule/server.mjs';
import { buildDataset as buildWbsDataset } from './wbs/server.mjs';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = currentDir;
const corpusRoot = path.join(repoRoot, 'Contract_Cost_Schedule Documents');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4073);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.rtf': 'application/rtf',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

const staticExtensions = new Set([
  '.css',
  '.gif',
  '.html',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.png',
  '.svg',
  '.txt',
  '.webp',
]);

const costArtifacts = {
  'gateway_cost_estimate.csv': 'Contract_Cost_Schedule Documents/data/gateway_cost_estimate.csv',
  'gateway_cost_phasing.csv': 'Contract_Cost_Schedule Documents/data/gateway_cost_phasing.csv',
  'gateway_cost_estimate_detail.csv':
    'Contract_Cost_Schedule Documents/data/gateway_cost_estimate_detail.csv',
  'gateway_section_b_pricing.csv':
    'Contract_Cost_Schedule Documents/data/gateway_section_b_pricing.csv',
  'gateway_source_reference_register.csv':
    'Contract_Cost_Schedule Documents/data/gateway_source_reference_register.csv',
  'gateway_master_schedule.csv': 'Contract_Cost_Schedule Documents/data/gateway_master_schedule.csv',
  'gateway_cost_basis_of_estimate.rtf':
    'Contract_Cost_Schedule Documents/docs/gateway_cost_basis_of_estimate.rtf',
  'gateway_data_authority_guide.rtf':
    'Contract_Cost_Schedule Documents/docs/gateway_data_authority_guide.rtf',
  'gateway_CARD.rtf': 'Contract_Cost_Schedule Documents/docs/gateway_CARD.rtf',
  'gateway_wbs_dictionary.rtf':
    'Contract_Cost_Schedule Documents/docs/gateway_wbs_dictionary.rtf',
};

const scheduleArtifacts = {
  'gateway_milestones.csv': 'Contract_Cost_Schedule Documents/data/gateway_milestones.csv',
  'gateway_master_schedule.csv':
    'Contract_Cost_Schedule Documents/data/gateway_master_schedule.csv',
  'gateway_risk_register.csv': 'Contract_Cost_Schedule Documents/data/gateway_risk_register.csv',
  'gateway_contract_documents_tracker.csv':
    'Contract_Cost_Schedule Documents/data/gateway_contract_documents_tracker.csv',
  'gateway_source_reference_register.csv':
    'Contract_Cost_Schedule Documents/data/gateway_source_reference_register.csv',
  'gateway_data_authority_guide.rtf':
    'Contract_Cost_Schedule Documents/docs/gateway_data_authority_guide.rtf',
};

function getMimeType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function isInsideDirectory(targetPath, parentPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function sendFile(response, absolutePath) {
  const body = await fs.readFile(absolutePath);
  response.writeHead(200, { 'Content-Type': getMimeType(absolutePath) });
  response.end(body);
}

function sendJson(response, payload) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}

async function serveRepoFile(response, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!isInsideDirectory(absolutePath, repoRoot)) {
    sendText(response, 404, 'Not found');
    return;
  }
  await sendFile(response, absolutePath);
}

async function serveAppStatic(response, pathname, appName) {
  const mount = `/${appName}`;
  if (pathname === mount) {
    response.writeHead(302, { Location: `${mount}/` });
    response.end();
    return;
  }

  const relativePath = pathname === `${mount}/` ? 'index.html' : pathname.replace(`${mount}/`, '');
  const absolutePath = path.join(repoRoot, appName, relativePath);
  const extension = path.extname(absolutePath).toLowerCase();

  if (!relativePath || !isInsideDirectory(absolutePath, path.join(repoRoot, appName))) {
    sendText(response, 404, 'Not found');
    return;
  }

  if (!staticExtensions.has(extension)) {
    sendText(response, 404, 'Not found');
    return;
  }

  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }
  } catch {
    sendText(response, 404, 'Not found');
    return;
  }

  await sendFile(response, absolutePath);
}

async function serveDocumentsSource(response, encodedRelativePath) {
  const relativePath = decodeURIComponent(encodedRelativePath || '');
  const absolutePath = path.resolve(repoRoot, relativePath);

  if (!relativePath || !isInsideDirectory(absolutePath, corpusRoot)) {
    sendText(response, 404, 'Document not found');
    return;
  }

  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      sendText(response, 404, 'Document not found');
      return;
    }
  } catch {
    sendText(response, 404, 'Document not found');
    return;
  }

  await sendFile(response, absolutePath);
}

async function serveMappedArtifact(response, fileName, artifactMap) {
  const relativePath = artifactMap[fileName];
  if (!relativePath) {
    sendText(response, 404, 'Not found');
    return;
  }
  await serveRepoFile(response, relativePath);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/' || pathname === '/index.html' || pathname === '/simulation' || pathname === '/simulation/') {
      await serveRepoFile(response, 'index.html');
      return;
    }

    if (pathname === '/index.app.html') {
      await serveRepoFile(response, 'index.app.html');
      return;
    }

    if (pathname.startsWith('/suite-assets/')) {
      const relativePath = pathname.replace(/^\//, '');
      const absolutePath = path.join(repoRoot, relativePath);
      if (!isInsideDirectory(absolutePath, path.join(repoRoot, 'suite-assets'))) {
        sendText(response, 404, 'Not found');
        return;
      }
      await sendFile(response, absolutePath);
      return;
    }

    if (pathname.startsWith('/documents/source/')) {
      await serveDocumentsSource(response, pathname.replace('/documents/source/', ''));
      return;
    }

    if (pathname === '/wbs/data/gateway-wbs.json') {
      sendJson(response, await buildWbsDataset());
      return;
    }

    if (pathname === '/schedule/data/gateway-schedule.json') {
      sendJson(response, await buildSchedulePayload());
      return;
    }

    if (pathname.startsWith('/schedule/artifacts/')) {
      await serveMappedArtifact(response, path.basename(pathname), scheduleArtifacts);
      return;
    }

    if (pathname === '/cost/data/gateway-cost.json') {
      sendJson(response, await buildCostDataset());
      return;
    }

    if (pathname.startsWith('/cost/source/')) {
      await serveMappedArtifact(response, path.basename(pathname), costArtifacts);
      return;
    }

    if (pathname.startsWith('/documents')) {
      await serveAppStatic(response, pathname, 'documents');
      return;
    }

    if (pathname.startsWith('/wbs')) {
      await serveAppStatic(response, pathname, 'wbs');
      return;
    }

    if (pathname.startsWith('/schedule')) {
      await serveAppStatic(response, pathname, 'schedule');
      return;
    }

    if (pathname.startsWith('/cost')) {
      await serveAppStatic(response, pathname, 'cost');
      return;
    }

    if (pathname.startsWith('/risk')) {
      await serveAppStatic(response, pathname, 'risk');
      return;
    }

    sendText(response, 404, 'Not found');
  } catch (error) {
    sendText(
      response,
      500,
      `Server error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
});

server.listen(port, host, () => {
  console.log(`Lunar Gateway Application Ecosystem available at http://${host}:${port}/`);
});
