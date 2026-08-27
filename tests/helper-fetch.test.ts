/** Fetching the piece that has to live inside another app.
 *
 *  Nothing here reaches the internet: a loopback server hands out a zip we
 *  built a moment ago, which is the same job as GitHub doing it. What is worth
 *  holding is that a file which is not the one we meant never reaches a folder
 *  somebody might then point another app at — a checked download is only
 *  checked if the check happens before the write. */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fetchHelper, helperFolder, type Helper } from '../src/agent/pi/helper';

const run = promisify(execFile);

let serving: Server;
let where: string;
let zip: Buffer;

beforeAll(async () => {
  // A zip with the shape the real one has: the file another app is pointed at,
  // beside a folder of the code it runs.
  const making = await mkdtemp(join(tmpdir(), 'graphe-helper-'));
  await mkdir(join(making, 'dist'), { recursive: true });
  await writeFile(join(making, 'manifest.json'), '{"name":"Pretend"}');
  await writeFile(join(making, 'dist', 'code.js'), 'console.log(1)');
  await run('/usr/bin/zip', ['-q', '-r', 'made.zip', 'manifest.json', 'dist'], { cwd: making });
  zip = await readFile(join(making, 'made.zip'));

  serving = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/zip' }).end(zip);
  });
  await new Promise<void>((ready) => serving.listen(0, '127.0.0.1', ready));
  const port = (serving.address() as { port: number }).port;
  where = `http://127.0.0.1:${String(port)}/made.zip`;
});

afterAll(() => {
  serving.close();
});

const asHelper = (sha256: string): Helper => ({
  name: 'pretend-1.0.0',
  from: where,
  sha256,
  points: 'manifest.json',
});

const right = (): Helper => asHelper(createHash('sha256').update(zip).digest('hex'));

async function somewhere(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'graphe-under-'));
}

describe('the piece another app needs', () => {
  it('arrives unpacked, with the file that app asks to be pointed at', async () => {
    const under = await somewhere();
    const points = await fetchHelper(under, right());
    expect(points).toBe(join(helperFolder(under, right()), 'manifest.json'));
    expect(await readFile(points, 'utf8')).toBe('{"name":"Pretend"}');
    expect((await readdir(helperFolder(under, right()))).sort()).toEqual(['dist', 'manifest.json']);
  });

  it('is named for its version, so a newer one is a different folder', async () => {
    const under = await somewhere();
    expect(helperFolder(under, right())).toMatch(/helpers\/pretend-1\.0\.0$/);
  });

  it('costs nothing to ask for twice — this runs on a press', async () => {
    const under = await somewhere();
    await fetchHelper(under, right());
    // The server is the only way to tell: if it went back, it would be served
    // again. Take the server away and ask a second time.
    serving.close();
    await expect(fetchHelper(under, right())).resolves.toContain('manifest.json');
    await new Promise<void>((ready) => serving.listen(0, '127.0.0.1', ready));
    where = `http://127.0.0.1:${String((serving.address() as { port: number }).port)}/made.zip`;
  });

  it('refuses a file that is not the one we meant', async () => {
    const under = await somewhere();
    await expect(fetchHelper(under, asHelper('00'.repeat(32)))).rejects.toThrow(/not the file I expected/);
  });

  it('leaves nothing behind when it refuses, so nobody points an app at it', async () => {
    const under = await somewhere();
    await fetchHelper(under, asHelper('11'.repeat(32))).catch(() => undefined);
    expect(await readdir(helperFolder(under, right())).catch(() => null)).toBeNull();
  });

  it('says so plainly when it cannot be fetched at all', async () => {
    const under = await somewhere();
    const nowhere = { ...right(), from: 'http://127.0.0.1:1/made.zip' };
    await expect(fetchHelper(under, nowhere)).rejects.toThrow(/could not fetch/i);
  });
});
