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
 * - Answer anything but a read. Anything other than GET or HEAD is refused,
 *   apart from one path that takes a click back from the page and never reaches
 *   the folder at all.
 * - Live longer than it is looked at. The shell stops it when the project
 *   changes or the app quits.
 *
 * Sharing this with somebody else is a later piece of work with a tunnel in it
 * (BACKLOG C2), and it will tunnel *this* — the made files — for the same reason.
 */

import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

import {
  injectPointer,
  POINT_PATH,
  SAID_MAX,
  type Pointed,
  type PointedSource,
  type Rect,
  type Trace,
} from './point';

/** A site being looked at right now. */
export type Serving = {
  /** Where a browser can find it. Never shown to anybody — see the language
   *  rule in notes/strategy/UI-DESIGN.md; this is handed to the browser and the
   *  browser shows whatever it shows. */
  readonly address: string;
  /** The folder being read from. */
  readonly folder: string;
  /** Whether a click on the page has somewhere to go. */
  readonly pointing: boolean;
  stop(): Promise<void>;
};

/** What a caller can ask for beyond the files themselves. */
export type ServeOptions = {
  /** Told about the one element somebody clicked in the preview. */
  onPointed?: (pointed: Pointed) => void;
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

/* -------------------------------------------------------------------------- */
/* The one path that takes something in                                        */
/* -------------------------------------------------------------------------- */

/** A description of one element used to be a few hundred bytes. It now carries
 *  the element's own markup, its resolved styles and the project's values in
 *  scope on it — the page sheds the least useful of those to fit, so a limit
 *  that is too small is not silence, it is a quieter answer. This is the only
 *  route that reads a request body, so it still reads as little as it can. */
const POINTED_MAX = 96 * 1024;

function asRect(value: unknown): Rect | null {
  if (typeof value !== 'object' || value === null) return null;
  const from = value as Record<string, unknown>;
  for (const side of ['x', 'y', 'width', 'height'] as const) {
    if (!Number.isFinite(from[side])) return null;
  }
  return {
    x: from['x'] as number,
    y: from['y'] as number,
    width: from['width'] as number,
    height: from['height'] as number,
  };
}

function asPlace(value: unknown): NonNullable<Pointed['place']> | null {
  if (typeof value !== 'object' || value === null) return null;
  const from = value as Record<string, unknown>;
  if (!Number.isFinite(from['nth']) || !Number.isFinite(from['of'])) return null;
  const within = from['within'];
  if (within !== undefined && typeof within !== 'string') return null;
  const place: NonNullable<Pointed['place']> = {
    nth: from['nth'] as number,
    of: from['of'] as number,
  };
  if (typeof within === 'string') place.within = within;
  return place;
}

/** Checked rather than trusted, and rebuilt rather than passed through. Whatever
 *  arrives here came off a page we did not write. */
/** Read defensively: everything here crossed a wire from a page we do not
 *  control, so a field that is not the shape it claims is left out rather than
 *  passed on. */
function words(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, said] of Object.entries(value as Record<string, unknown>)) {
    if (typeof said === 'string') out[key] = said;
  }
  return out;
}

function asSource(value: unknown): PointedSource | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const from = value as Record<string, unknown>;
  const html = from['html'];
  if (typeof html !== 'string') return null;
  const source: PointedSource = { html, styles: words(from['styles']) };
  const vars = words(from['vars']);
  if (Object.keys(vars).length > 0) source.vars = vars;
  return source;
}

function asOrigin(value: unknown): Trace[] {
  if (!Array.isArray(value)) return [];
  const out: Trace[] = [];
  for (const one of value) {
    if (typeof one !== 'object' || one === null) continue;
    const from = one as Record<string, unknown>;
    const how = from['how'];
    const file = from['file'];
    const line = from['line'];
    const column = from['column'];
    const component = from['component'];
    if (how === 'stamp' && typeof file === 'string' && typeof line === 'number') {
      const rung: Extract<Trace, { how: 'stamp' }> = { how, file, line };
      if (typeof column === 'number') rung.column = column;
      if (typeof component === 'string') rung.component = component;
      out.push(rung);
      continue;
    }
    if (how === 'stack' && typeof file === 'string' && typeof line === 'number') {
      const rung: Extract<Trace, { how: 'stack' }> = { how, file, line };
      if (typeof column === 'number') rung.column = column;
      if (typeof from['mapped'] === 'boolean') rung.mapped = from['mapped'];
      out.push(rung);
      continue;
    }
    if (how === 'owner' && typeof component === 'string') out.push({ how, component });
    if (how === 'selector' && typeof from['selector'] === 'string') {
      out.push({ how, selector: from['selector'] });
    }
    if (how === 'markup' && typeof from['html'] === 'string') out.push({ how, html: from['html'] });
    if (how === 'text' && typeof from['text'] === 'string') out.push({ how, text: from['text'] });
  }
  return out;
}

function asView(value: unknown): { width: number; height: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const from = value as Record<string, unknown>;
  const width = from['width'];
  const height = from['height'];
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width: width as number, height: height as number };
}

/** What a name for one element could plausibly be. The body may now be large,
 *  because markup and styles travel in it — but a selector or a label of that
 *  size is not a description of anything, it is somebody leaning on the door. */
const NAME_MAX = 2 * 1024;

function asPointed(value: unknown): Pointed | null {
  if (typeof value !== 'object' || value === null) return null;
  const from = value as Record<string, unknown>;

  const selector = from['selector'];
  const label = from['label'];
  const kind = from['kind'];
  if (typeof selector !== 'string' || selector === '' || selector.length > NAME_MAX) return null;
  if (typeof label !== 'string' || label.length > NAME_MAX) return null;
  if (kind !== undefined && (typeof kind !== 'string' || kind.length > NAME_MAX)) return null;

  const rect = asRect(from['rect']);
  if (rect === null) return null;

  // Somebody's own words, arriving from a page. Length is the only thing worth
  // checking here — everything downstream treats it as text and never as markup.
  const said = from['said'];
  if (said !== undefined && (typeof said !== 'string' || said.length > SAID_MAX)) return null;

  const pointed: Pointed = { selector, label, rect };
  if (typeof said === 'string' && said.trim() !== '') pointed.said = said.trim();
  if (typeof kind === 'string') pointed.kind = kind;

  if (from['place'] !== undefined) {
    const place = asPlace(from['place']);
    if (place === null) return null;
    pointed.place = place;
  }

  // Everything the reading is built from. Carried through rather than dropped:
  // the card that names a component and its tokens is made of exactly this, and
  // a seam that keeps only the selector is the reason it never existed.
  const source = asSource(from['source']);
  if (source !== null) pointed.source = source;
  const origin = asOrigin(from['origin']);
  if (origin.length > 0) pointed.origin = origin;
  const view = asView(from['view']);
  if (view !== null) pointed.view = view;

  return pointed;
}

/** The click, or null. Read to the end even once it is too big, so an oversized
 *  body gets an answer rather than a dropped connection. */
async function readPointed(request: IncomingMessage): Promise<Pointed | null> {
  const pieces: Buffer[] = [];
  let size = 0;
  let overflowed = false;

  for await (const piece of request) {
    const chunk = piece as Buffer;
    size += chunk.length;
    if (size > POINTED_MAX) {
      overflowed = true;
      pieces.length = 0;
      continue;
    }
    pieces.push(chunk);
  }
  if (overflowed) return null;

  try {
    return asPointed(JSON.parse(Buffer.concat(pieces).toString('utf8')));
  } catch {
    return null;
  }
}

async function answerPoint(
  request: IncomingMessage,
  response: ServerResponse,
  onPointed: ((pointed: Pointed) => void) | null,
): Promise<void> {
  if (request.method !== 'POST') {
    refuse(response, 405, NOT_HERE);
    return;
  }

  const pointed = await readPointed(request);
  if (pointed === null) {
    refuse(response, 400, NOT_HERE);
    return;
  }

  onPointed?.(pointed);
  response.writeHead(204, { 'cache-control': 'no-store' });
  response.end();
}

/* -------------------------------------------------------------------------- */
/* Reading files out                                                           */
/* -------------------------------------------------------------------------- */

function isPage(file: string): boolean {
  const kind = extname(file).toLowerCase();
  return kind === '.html' || kind === '.htm';
}

/** A page gets the pointer script, so clicking on it can mean something. The
 *  script changes the length, so a page is read whole rather than streamed;
 *  everything else goes out untouched. */
async function sendPage(
  file: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const page = injectPointer(await readFile(file, 'utf8'));
  response.writeHead(200, {
    'content-type': typeOf(file),
    'content-length': String(Buffer.byteLength(page)),
    'cache-control': 'no-store',
  });
  if (request.method === 'HEAD') response.end();
  else response.end(page);
}

async function answer(
  folder: string,
  request: IncomingMessage,
  response: ServerResponse,
  onPointed: ((pointed: Pointed) => void) | null,
): Promise<void> {
  const requested = pathOf(request.url);
  if (requested === null) {
    refuse(response, 400, NOT_HERE);
    return;
  }

  // Before the read-only refusal below, and before anything looks at the folder:
  // this path is ours, so it is never resolved against a file.
  if (requested === POINT_PATH) {
    await answerPoint(request, response, onPointed);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    refuse(response, 405, NOT_HERE);
    return;
  }

  const file = await resolveRequest(folder, requested);
  if (file === null) {
    refuse(response, 404, NOT_HERE);
    return;
  }

  if (isPage(file)) {
    await sendPage(file, request, response);
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
export async function serveFolder(folder: string, options?: ServeOptions): Promise<Serving> {
  const root = await realpath(resolve(folder));
  const onPointed = options?.onPointed ?? null;

  const server = createServer((request, response) => {
    void answer(root, request, response, onPointed).catch(() => {
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
    pointing: onPointed !== null,
    stop(): Promise<void> {
      return new Promise<void>((stopped) => {
        server.closeAllConnections?.();
        server.close(() => stopped());
      });
    },
  };
}
