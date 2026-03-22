import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');
const corpusRoot = path.join(repoRoot, 'Contract_Cost_Schedule Documents');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4473);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.rtf': 'application/rtf',
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

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}

async function serveLocalAppFile(response, pathname) {
  const localRelativePath =
    pathname === '/documents/' ? 'index.html' : pathname.replace('/documents/', '');
  const absolutePath = path.join(currentDir, localRelativePath);

  if (!isInsideDirectory(absolutePath, currentDir)) {
    sendText(response, 404, 'Not found');
    return;
  }

  await sendFile(response, absolutePath);
}

async function serveCorpusFile(response, encodedRelativePath) {
  const relativePath = decodeURIComponent(encodedRelativePath || '');
  const absolutePath = path.resolve(repoRoot, relativePath);

  if (!relativePath || !isInsideDirectory(absolutePath, corpusRoot)) {
    sendText(response, 404, 'Document not found');
    return;
  }

  let fileStats;
  try {
    fileStats = await fs.stat(absolutePath);
  } catch {
    sendText(response, 404, 'Document not found');
    return;
  }

  if (!fileStats.isFile()) {
    sendText(response, 404, 'Document not found');
    return;
  }

  await sendFile(response, absolutePath);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/index.html' || pathname === '/simulation' || pathname === '/simulation/') {
      await sendFile(response, path.join(repoRoot, 'index.html'));
      return;
    }

    if (pathname === '/') {
      response.writeHead(302, { Location: '/documents/' });
      response.end();
      return;
    }

    if (pathname.startsWith('/documents/source/')) {
      const encodedRelativePath = pathname.replace('/documents/source/', '');
      await serveCorpusFile(response, encodedRelativePath);
      return;
    }

    if (
      pathname === '/documents/' ||
      pathname === '/documents/index.html' ||
      pathname === '/documents/styles.css' ||
      pathname === '/documents/app.js' ||
      pathname === '/documents/data/documents.json'
    ) {
      await serveLocalAppFile(response, pathname);
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
  console.log(`Gateway Documents Explorer running at http://${host}:${port}/documents/`);
});
