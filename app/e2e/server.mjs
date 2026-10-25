/**
 * The static server the Playwright tests use: the BUILT app (app/dist) at `/`, and the committed
 * data fixture (app/e2e/fixtures/data) at `/data/`. Plain Node http, no dependency.
 *
 * Why not `vite preview`: it sends `Content-Encoding: gzip` for `.gz` files, so the browser
 * unzips them and the data client (correctly) finds the body is not the length or hash the
 * manifest states. A real host must serve the `.gz` files as opaque bytes, which is what this
 * does: `Content-Type: application/gzip` and no `Content-Encoding`. (Task 9 checks that GitHub
 * Pages does the same.)
 *
 * Only GET and HEAD of files under those two folders. No query string is used or needed.
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, '..', 'dist');
const dataRoot = join(here, 'fixtures', 'data');
const port = Number(process.env['CANTRE_E2E_PORT'] ?? '4179');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gz': 'application/gzip',
};

/** The file for a URL path, or null when it is outside the two served folders. */
function resolveFile(pathname) {
  const inData = pathname.startsWith('/data/');
  const root = inData ? dataRoot : dist;
  const relative = decodeURIComponent(inData ? pathname.slice('/data/'.length) : pathname);
  const file = normalize(
    join(root, relative === '' || relative.endsWith('/') ? `${relative}index.html` : relative),
  );
  return file.startsWith(root + sep) ? file : null;
}

const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  const file = request.method === 'GET' || request.method === 'HEAD' ? resolveFile(pathname) : null;
  let size = -1;
  try {
    if (file !== null && statSync(file).isFile()) {
      size = statSync(file).size;
    }
  } catch {
    size = -1;
  }
  if (file === null || size < 0) {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': size,
    // Never a Content-Encoding: the data files are served as stored.
    'Cache-Control': 'no-cache',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`CANTRE e2e server on http://127.0.0.1:${String(port)}\n`);
});
