/** "See it" — what gets made, and what gets served.
 *
 * The load-bearing test in this file is S-02. notes/strategy/SHARING.md §1 is a
 * list of eight filesystem escapes found in development servers since March
 * 2025, several of them found after the previous one was fixed. Our answer is a
 * server with no module graph in it, and the only way that answer is worth
 * anything is if it genuinely cannot be walked out of.
 */

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { canBeShown, likelyOutputs, readTheFolder, helperFor } from '../src/preview/detect';
import { POINT_PATH, POINTER_MARK, type Pointed } from '../src/preview/point';
import { serveFolder } from '../src/preview/serve';
import { lookAt } from '../src/preview/show';
import { ago, agoInSentence, clockTime } from '../src/lib/when';

const madeFolders: string[] = [];

afterAll(async () => {
  await Promise.all(madeFolders.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-preview-')));
  madeFolders.push(folder);
  return folder;
}

async function put(root: string, file: string, contents: string): Promise<void> {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

/* ========================================================================== */
/* S-01 working out what a folder is                                           */
/* ========================================================================== */

describe('S-01 reading a folder', () => {
  it('opens a hand-written site as it stands', () => {
    expect(readTheFolder({ entries: ['index.html', 'styles.css'], manifest: null })).toEqual({
      kind: 'as-is',
    });
  });

  it('makes a project first, rather than opening the template at the top of it', () => {
    // The trap: a project has an index.html too, and it is an empty shell with
    // nothing filled in. Opening that shows a designer their own site, blank,
    // and lets them believe it.
    const recipe = readTheFolder({
      entries: ['index.html', 'package.json', 'node_modules', 'package-lock.json'],
      manifest: { scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { vite: '^6' } },
    });

    expect(recipe).toMatchObject({ kind: 'make', script: 'build', helper: 'npm' });
  });

  it('knows it has to fetch the pieces first when they are not there', () => {
    const recipe = readTheFolder({
      entries: ['package.json'],
      manifest: { scripts: { build: 'vite build' } },
    });
    expect(recipe).toMatchObject({ kind: 'make', needsPieces: true });
  });

  it('asks instead of guessing when there is nothing to open and nothing to make', () => {
    const nothing = readTheFolder({ entries: ['notes.txt'], manifest: null });
    expect(nothing.kind).toBe('unsure');

    const noRecipe = readTheFolder({
      entries: ['package.json'],
      manifest: { scripts: { test: 'vitest' } },
    });
    expect(noRecipe.kind).toBe('unsure');
  });

  it('says it in words a designer can answer', () => {
    const asked = readTheFolder({ entries: ['notes.txt'], manifest: null });
    const question = asked.kind === 'unsure' ? asked.question : '';

    expect(question).not.toBe('');
    // The vocabulary rule, on the one string in this module a person reads.
    expect(question).not.toMatch(/localhost|port|npm|build|deploy|repository|commit|dev server/i);
  });

  it('never, ever offers to run the thing a developer runs while working', () => {
    // notes/strategy/SHARING.md §1. There is no path through this module that
    // produces a `dev` script, and this is the assertion that keeps it that way.
    const recipe = readTheFolder({
      entries: ['package.json', 'node_modules'],
      manifest: { scripts: { dev: 'vite', start: 'vite', serve: 'vite', build: 'vite build' } },
    });

    expect(recipe).toMatchObject({ kind: 'make' });
    expect(recipe.kind === 'make' ? recipe.script : '').toBe('build');
  });

  it('looks where each family of project actually leaves things', () => {
    expect(likelyOutputs({ dependencies: { next: '^15' } })[0]).toBe('out');
    expect(likelyOutputs({ devDependencies: { astro: '^5' } })[0]).toBe('dist');
    expect(likelyOutputs({ dependencies: { '@11ty/eleventy': '^3' } })[0]).toBe('_site');
    // And always somewhere to look, even for something we have never met.
    expect(likelyOutputs(null).length).toBeGreaterThan(0);
  });

  it('reads which tool the project is set up for rather than asking', () => {
    expect(helperFor({ entries: ['pnpm-lock.yaml'], manifest: null })).toBe('pnpm');
    expect(helperFor({ entries: ['yarn.lock'], manifest: null })).toBe('yarn');
    expect(helperFor({ entries: [], manifest: null })).toBe('npm');
  });

  it('glances at a real folder without falling over a broken manifest', async () => {
    const folder = await newFolder();
    await put(folder, 'package.json', '{ not json at all');

    const look = await lookAt(folder);
    expect(look.entries).toContain('package.json');
    expect(look.manifest).toBeNull();
    expect(readTheFolder(look).kind).toBe('unsure');
  });
});

/* ========================================================================== */
/* S-02 the server cannot be walked out of                                     */
/* ========================================================================== */

describe('S-02 serving what was made', () => {
  async function aSite(): Promise<string> {
    const folder = await newFolder();
    await put(folder, 'index.html', '<h1>Paper Street</h1>');
    await put(folder, 'about.html', '<h1>About</h1>');
    await put(folder, 'work/index.html', '<h1>Work</h1>');
    await put(folder, 'styles.css', 'h1 { color: red }');
    return folder;
  }

  it('serves the pages of the site', async () => {
    const serving = await serveFolder(await aSite());
    try {
      const home = await fetch(`${serving.address}/`);
      expect(home.status).toBe(200);
      expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await home.text()).toContain('Paper Street');

      const styles = await fetch(`${serving.address}/styles.css`);
      expect(styles.headers.get('content-type')).toBe('text/css; charset=utf-8');
    } finally {
      await serving.stop();
    }
  });

  it('follows the links a site actually has in it', async () => {
    const serving = await serveFolder(await aSite());
    try {
      // /about → about.html, /work → work/index.html. Every static generator
      // writes links like this, and 404ing on them reads as us breaking a site.
      expect((await fetch(`${serving.address}/about`)).status).toBe(200);
      expect(await (await fetch(`${serving.address}/work`)).text()).toContain('Work');
    } finally {
      await serving.stop();
    }
  });

  it('will not hand out anything outside the folder', async () => {
    const around = await newFolder();
    await put(around, 'secrets.env', 'API_KEY=hunter2');
    const site = path.join(around, 'site');
    await mkdir(site, { recursive: true });
    await put(site, 'index.html', '<h1>hello</h1>');

    const serving = await serveFolder(site);
    try {
      for (const attempt of [
        '/../secrets.env',
        '/..%2fsecrets.env',
        '/%2e%2e/secrets.env',
        '/./../secrets.env',
        '/subfolder/../../secrets.env',
        '//../secrets.env',
      ]) {
        const refused = await fetch(`${serving.address}${attempt}`);
        expect(refused.status, attempt).toBe(404);
        expect(await refused.text()).not.toContain('hunter2');
      }
    } finally {
      await serving.stop();
    }
  });

  it('will not hand it out to a request that never went through a URL parser', async () => {
    // `fetch` tidies `..` away before it ever reaches us, so the test above is
    // only half the story. This one puts the bytes on the socket by hand, which
    // is what an attacker would do and what every one of the eight CVEs in
    // notes/strategy/SHARING.md §1 involved doing.
    const around = await newFolder();
    await put(around, 'secrets.env', 'API_KEY=hunter2');
    const site = path.join(around, 'site');
    await mkdir(site, { recursive: true });
    await put(site, 'index.html', '<h1>hello</h1>');

    const serving = await serveFolder(site);
    const port = Number.parseInt(serving.address.split(':')[2] ?? '0', 10);

    const askRaw = (target: string): Promise<string> =>
      new Promise((answered, failed) => {
        const socket = createConnection({ port, host: '127.0.0.1' }, () => {
          socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
        });
        let said = '';
        socket.setEncoding('utf8');
        socket.on('data', (piece) => {
          said += piece;
        });
        socket.on('end', () => answered(said));
        socket.on('error', failed);
      });

    try {
      for (const target of ['/../secrets.env', '/./../secrets.env', '/site/../../secrets.env']) {
        const answer = await askRaw(target);
        expect(answer, target).not.toContain('hunter2');
        expect(answer, target).toContain('404');
      }
    } finally {
      await serving.stop();
    }
  });

  it('will not follow a link out of the folder either', async () => {
    const around = await newFolder();
    await put(around, 'secrets.env', 'API_KEY=hunter2');
    const site = path.join(around, 'site');
    await mkdir(site, { recursive: true });
    await put(site, 'index.html', '<h1>hello</h1>');
    await symlink(path.join(around, 'secrets.env'), path.join(site, 'escape.env'));

    const serving = await serveFolder(site);
    try {
      const refused = await fetch(`${serving.address}/escape.env`);
      expect(refused.status).toBe(404);
      expect(await refused.text()).not.toContain('hunter2');
    } finally {
      await serving.stop();
    }
  });

  it('answers reads and nothing else', async () => {
    const serving = await serveFolder(await aSite());
    try {
      expect((await fetch(`${serving.address}/`, { method: 'HEAD' })).status).toBe(200);
      for (const method of ['POST', 'PUT', 'DELETE']) {
        expect((await fetch(`${serving.address}/`, { method })).status).toBe(405);
      }
    } finally {
      await serving.stop();
    }
  });

  it('answers this machine and nowhere else', async () => {
    const serving = await serveFolder(await aSite());
    try {
      // Bound to the loopback address, so nothing on the café wifi can reach it
      // even while it is running. Sharing is a later, deliberate piece of work.
      expect(serving.address.startsWith('http://127.0.0.1:')).toBe(true);
    } finally {
      await serving.stop();
    }
  });

  it('says missing pages in our own words rather than as a status line', async () => {
    const serving = await serveFolder(await aSite());
    try {
      const missing = await fetch(`${serving.address}/nowhere.html`);
      expect(missing.status).toBe(404);
      expect(await missing.text()).toContain('not part of what was made');
    } finally {
      await serving.stop();
    }
  });

  it('stops when it is told to', async () => {
    const serving = await serveFolder(await aSite());
    await serving.stop();
    await expect(fetch(serving.address)).rejects.toThrow();
  });
});

/* ========================================================================== */
/* S-03 when something happened                                                */
/* ========================================================================== */

describe('S-03 saying when', () => {
  const now = new Date(2026, 7, 10, 18, 30).getTime();
  const minutes = (count: number) => now - count * 60_000;
  const hours = (count: number) => now - count * 3_600_000;

  it('rounds the way a person would', () => {
    expect(ago(minutes(0), now)).toBe('Just now');
    expect(ago(minutes(1), now)).toBe('A minute ago');
    // Rounding down would say "1 minutes ago" for anything in here, and nobody
    // says that.
    expect(ago(now - 100_000, now)).toBe('A minute ago');
    expect(ago(minutes(2), now)).toBe('2 minutes ago');
    expect(ago(minutes(18), now)).toBe('18 minutes ago');
    expect(ago(hours(1), now)).toBe('An hour ago');
    expect(ago(hours(4), now)).toBe('4 hours ago');
  });

  it('says yesterday, and then says the day', () => {
    expect(ago(new Date(2026, 7, 9, 18, 12).getTime(), now)).toBe('Yesterday, 6:12pm');
    expect(ago(new Date(2026, 7, 6, 9, 5).getTime(), now)).toBe('Thursday, 9:05am');
    expect(ago(new Date(2026, 2, 12, 9, 5).getTime(), now)).toBe('12 March');
    expect(ago(new Date(2025, 2, 12, 9, 5).getTime(), now)).toBe('12 March 2025');
  });

  it('is never alarming about a clock that disagrees with ours', () => {
    // A folder written on another machine can carry a moment slightly in the
    // future. "In -3 minutes" is not a thing to show anybody.
    expect(ago(now + 20_000, now)).toBe('Just now');
  });

  it('fits inside a sentence when a sentence needs it', () => {
    expect(agoInSentence(minutes(2), now)).toBe('2 minutes ago');
    expect(agoInSentence(minutes(0), now)).toBe('a moment ago');
    expect(agoInSentence(hours(1), now)).toBe('an hour ago');
  });

  it('writes the time the way it is spoken', () => {
    expect(clockTime(new Date(2026, 7, 10, 18, 12))).toBe('6:12pm');
    expect(clockTime(new Date(2026, 7, 10, 0, 4))).toBe('12:04am');
    expect(clockTime(new Date(2026, 7, 10, 12, 0))).toBe('12:00pm');
  });
});

/* ========================================================================== */
/* S-04 clicking the thing you mean                                            */
/* ========================================================================== */

describe('S-04 pointing at what is on the page', () => {
  const page = '<!doctype html><html><body><h1>Paper Street</h1></body></html>';
  const script = 'console.log("</body>")\n';
  const styles = 'h1 { color: red }\n';

  const clicked: Pointed = {
    selector: 'main.hero > h1:nth-of-type(1)',
    label: 'Paper Street',
    kind: 'heading',
    rect: { x: 24, y: 96, width: 320, height: 48 },
    place: { nth: 1, of: 2, within: 'hero' },
  };

  async function aSite(): Promise<string> {
    const folder = await newFolder();
    await put(folder, 'index.html', page);
    await put(folder, 'styles.css', styles);
    await put(folder, 'app.js', script);
    return folder;
  }

  const post = (address: string, body: string): Promise<Response> =>
    fetch(`${address}${POINT_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

  it('hands a click back to whoever armed it', async () => {
    const heard: Pointed[] = [];
    const serving = await serveFolder(await aSite(), { onPointed: (one) => heard.push(one) });
    try {
      expect(serving.pointing).toBe(true);

      const answered = await post(serving.address, JSON.stringify(clicked));
      expect(answered.status).toBe(204);
      expect(answered.headers.get('cache-control')).toBe('no-store');
      expect(heard).toEqual([clicked]);
    } finally {
      await serving.stop();
    }
  });

  it('refuses anything that is not one element somebody clicked', async () => {
    const heard: Pointed[] = [];
    const serving = await serveFolder(await aSite(), { onPointed: (one) => heard.push(one) });
    try {
      for (const body of [
        'not json at all',
        '',
        'null',
        '[]',
        '"pointed"',
        JSON.stringify({ selector: 'h1', label: 'Paper Street' }),
        JSON.stringify({ ...clicked, selector: 12 }),
        JSON.stringify({ ...clicked, selector: '' }),
        JSON.stringify({ ...clicked, rect: { x: 0, y: 0, width: 'wide', height: 1 } }),
        JSON.stringify({ ...clicked, rect: { x: 0, y: 0, width: 1 } }),
        JSON.stringify({ ...clicked, place: 'in the hero' }),
        JSON.stringify({ ...clicked, place: { nth: 1, of: 2, within: { a: 1 } } }),
        // Longer than a description of an element could ever be.
        JSON.stringify({ ...clicked, label: 'x'.repeat(64 * 1024) }),
      ]) {
        const refused = await post(serving.address, body);
        expect(refused.status, body.slice(0, 48)).toBe(400);
      }
      expect(heard).toEqual([]);
    } finally {
      await serving.stop();
    }
  });

  it('never lets that path be a file, or be read', async () => {
    const folder = await aSite();
    // A folder of the designer's own that happens to sit where our path is.
    await put(folder, `${POINT_PATH}.html`, '<h1>hunter2</h1>');

    const serving = await serveFolder(folder, { onPointed: () => {} });
    try {
      for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
        const refused = await fetch(`${serving.address}${POINT_PATH}`, { method });
        expect(refused.status, method).toBe(405);
        expect(await refused.text()).not.toContain('hunter2');
      }
    } finally {
      await serving.stop();
    }
  });

  it('gives a page the script once, and counts the bytes it actually sends', async () => {
    const serving = await serveFolder(await aSite(), { onPointed: () => {} });
    try {
      const home = await fetch(`${serving.address}/`);
      const html = await home.text();

      expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(html).toContain('Paper Street');
      expect(html.split(POINTER_MARK).length - 1).toBe(1);
      // The injection changes the length, so the header cannot come from `stat`.
      expect(home.headers.get('content-length')).toBe(String(Buffer.byteLength(html)));
      expect(Buffer.byteLength(html)).toBeGreaterThan(Buffer.byteLength(page));

      const asked = await fetch(`${serving.address}/`, { method: 'HEAD' });
      expect(asked.headers.get('content-length')).toBe(String(Buffer.byteLength(html)));
    } finally {
      await serving.stop();
    }
  });

  it('leaves everything that is not a page exactly as it was', async () => {
    const serving = await serveFolder(await aSite(), { onPointed: () => {} });
    try {
      for (const [file, contents] of [
        ['/styles.css', styles],
        ['/app.js', script],
      ] as const) {
        const sent = await fetch(`${serving.address}${file}`);
        expect(await sent.text(), file).toBe(contents);
        expect(sent.headers.get('content-length'), file).toBe(String(Buffer.byteLength(contents)));
      }
    } finally {
      await serving.stop();
    }
  });

  it('says whether a click has anywhere to go', async () => {
    const serving = await serveFolder(await aSite());
    try {
      expect(serving.pointing).toBe(false);
      // Still on the page — it is inert until something switches it on — and a
      // click nobody is waiting for is answered rather than refused.
      expect(await (await fetch(`${serving.address}/`)).text()).toContain(POINTER_MARK);
      expect((await post(serving.address, JSON.stringify(clicked))).status).toBe(204);
    } finally {
      await serving.stop();
    }
  });
});

/* ========================================================================== */
/* S-09 whether a copy is worth its minute                                     */
/* ========================================================================== */

/** A copy of the project costs a dependency install and buys two things: the
 *  folder stays untouched, and what the work made can be shown first. Only the
 *  second is unique to it — going back covers the first — so this is the
 *  question of whether there is anything to show. */
describe('S-09 whether there is anything to look at', () => {
  it('says yes to a folder that is already a site', () => {
    const recipe = readTheFolder({ entries: ['index.html', 'styles.css'], manifest: null });
    expect(canBeShown(recipe)).toBe(true);
  });

  it('says yes to a project that makes one', () => {
    const recipe = readTheFolder({
      entries: ['package.json', 'package-lock.json', 'src'],
      manifest: { scripts: { build: 'vite build' }, devDependencies: { vite: '^6.0.0' } },
    });
    expect(recipe.kind).toBe('make');
    expect(canBeShown(recipe)).toBe(true);
  });

  it('says no to a folder whose shape it could not read', () => {
    const recipe = readTheFolder({ entries: ['notes.txt'], manifest: null });
    expect(recipe.kind).toBe('unsure');
    // Not "probably yes". A minute of installing is a poor way to treat a guess,
    // and a save point covers what the copy would have.
    expect(canBeShown(recipe)).toBe(false);
  });

  it('says no to something with no way to make a site at all', () => {
    const recipe = readTheFolder({
      entries: ['package.json', 'server.js'],
      manifest: { scripts: { start: 'node server.js' }, dependencies: { express: '^4.0.0' } },
    });
    expect(canBeShown(recipe)).toBe(false);
  });
});
