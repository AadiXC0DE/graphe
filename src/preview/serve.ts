/** Handing the finished site to a browser.
 *
 * Small on purpose. It reads files out of one folder and sends them, and it does
 * nothing else — no modules, no reloading, no sockets, no watching. That is the
 * whole reason it exists rather than reaching for the server a project already
 * has: notes/strategy/SHARING.md §1 counts eight filesystem-escape CVEs in the
 * development servers designers would otherwise be handed, several of them found
 * after the last one was fixed, one of them exploited in the wild. The pattern is
 * the finding. A server with no module graph in it has nothing to escape from.
 *
 * ## What it will not do
 *
 * - Leave the folder. Every path is resolved, then checked against the folder it
 *   must be inside — after symlinks are followed, because following one is
 *   exactly how a link inside the site becomes a file in somebody's home.
 * - Answer anything but this machine. It binds to the loopback address, so
 *   nothing on the café wifi can reach it even while it is running.
 * - Answer anything but a read. Anything other than GET or HEAD is refused.
 * - Live longer than it is looked at. The shell stops it when the project
 *   changes or the app quits.
 *
 * Sharing this with somebody else is a later piece of work with a tunnel in it
 * (BACKLOG C2), and it will tunnel *this* — the made files — for the same reason.
 */

import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

/** A site being looked at right now. */
export type Serving = {
  /** Where a browser can find it. Never shown to anybody — see the language
   *  rule in notes/strategy/UI-DESIGN.md; this is handed to the browser and the
   *  browser shows whatever it shows. */
  readonly address: string;
  /** The folder being read from. */
  readonly folder: string;
  stop(): Promise<void>;
};

/** Enough of them to cover a site a designer would make. Anything unrecognised
 *  is sent as bytes rather than guessed at, which a browser handles by
 *  downloading it — a fair outcome for a file we cannot name. */
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

/** Said to whoever asks for something that is not there. It is their own site,
 *  so it is said in our voice rather than as a status line. */
const NOT_HERE = 'That page is not part of what was made.';

function typeOf(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** The part of a request that names a file, with the query and the fragment
 *  taken off and the percent-encoding undone. Null when it cannot be read as a
 *  path at all, which is refused rather than interpreted. */
function pathOf(url: string | undefined): string | null {
  if (url === undefined) return null;
  const withoutQuery = url.split(/[?#]/)[0] ?? '';
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
}

/** Inside `folder`, or null. `realpath` first, so a link pointing out of the
 *  folder is judged by where it lands rather than by where it sits. */
async function fileInside(folder: string, candidate: string): Promise<string | null> {
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return null;
  }
  if (real !== folder && !real.startsWith(folder + sep)) return null;
  try {
    const found = await stat(real);
    return found.isFile() ? real : null;
  } catch {
    return null;
  }
}

/**
 * The file a request is asking for, or null.
 *
 * A folder means its index page, and a name with no extension is tried as a page
 * too — sites made by every static generator on earth link to `/about` and store
 * `about.html`, and a preview that 404s on the designer's own navigation would
 * be reported as us breaking their site.
 */
async function resolveRequest(folder: string, requested: string): Promise<string | null> {
  const wanted = join(folder, requested);
  const candidates = requested.endsWith('/')
    ? [join(wanted, 'index.html'), join(wanted, 'index.htm')]
    : [wanted, `${wanted}.html`, join(wanted, 'index.html'), join(wanted, 'index.htm')];

  for (const candidate of candidates) {
    const found = await fileInside(folder, candidate);
    if (found !== null) return found;
  }
  return null;
}

function refuse(response: ServerResponse, code: number, says: string): void {
  response.writeHead(code, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(`${says}\n`);
}

async function answer(
  folder: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    refuse(response, 405, NOT_HERE);
    return;
  }

  const requested = pathOf(request.url);
  if (requested === null) {
    refuse(response, 400, NOT_HERE);
    return;
  }

  const file = await resolveRequest(folder, requested);
  if (file === null) {
    refuse(response, 404, NOT_HERE);
    return;
  }

  const found = await stat(file);
  response.writeHead(200, {
    'content-type': typeOf(file),
    'content-length': String(found.size),
    // Looking at it again after a change must show the change. This is a
    // preview of work in progress; nothing here is worth caching.
    'cache-control': 'no-store',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const body = createReadStream(file);
  body.on('error', () => response.destroy());
  body.pipe(response);
}

/** The address of a listening server, on the loopback address it bound to. */
function addressOf(server: Server): string {
  const bound = server.address();
  if (bound === null || typeof bound === 'string') return 'http://127.0.0.1';
  return `http://127.0.0.1:${bound.port}`;
}

/**
 * Start reading a folder out to this machine only.
 *
 * The port is whatever is free — asking for a particular one buys nothing and
 * costs a collision with whatever the designer already has running.
 */
export async function serveFolder(folder: string): Promise<Serving> {
  const root = await realpath(resolve(folder));

  const server = createServer((request, response) => {
    void answer(root, request, response).catch(() => {
      if (!response.headersSent) refuse(response, 500, NOT_HERE);
      else response.destroy();
    });
  });

  // A page left open in a browser holds its connection; without this the server
  // takes ages to actually stop when somebody switches project.
  server.keepAliveTimeout = 1000;

  await new Promise<void>((ready, failed) => {
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', failed);
      ready();
    });
  });

  return {
    address: addressOf(server),
    folder: root,
    stop(): Promise<void> {
      return new Promise<void>((stopped) => {
        server.closeAllConnections?.();
        server.close(() => stopped());
      });
    },
  };
}
