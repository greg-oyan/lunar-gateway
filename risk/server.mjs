import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4573);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/') {
      response.writeHead(302, { Location: '/risk/' });
      response.end();
      return;
    }

    if (pathname === '/risk/' || pathname.startsWith('/risk/')) {
      const relativePath = pathname === '/risk/' ? 'index.html' : pathname.replace('/risk/', '');
      const absolutePath = path.join(currentDir, relativePath);

      if (!isInsideDirectory(absolutePath, currentDir)) {
        sendText(response, 404, 'Not found');
        return;
      }

      await sendFile(response, absolutePath);
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
  console.log(`Gateway Risk Explorer running at http://${host}:${port}/risk/`);
});
