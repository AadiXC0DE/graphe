/** Where a downloaded release comes from, where it lands, and what is on the
 *  disk when the app says it is ready.
 *
 * 9.5 asks that a download validates its expected destination and source, and
 *  that nothing is presented as installed before the installation actually
 *  happened. The half of that reachable without a network is the fetch:
 *  `fetchHelper` (src/agent/pi/helper.ts:56) takes the one release pinned in
 *  `REACHABLE` (src/agent/pi/reach.ts:154, the helper at :171), checks it
 *  against a checksum before it is written anywhere, and hands back the path the
 *  other app is pointed at only once that file is really inside the unpacked
 *  folder.
 *
 * Not here: the app's own update. The release check (`newerRelease`,
 * electron/main.ts:6328), the notice that says a version is out
 * (`watchForANewerOne`, :6362) and the release-notes link (:6291) need Electron
 * and the network, and the signing of the artifacts a release publishes is
 * `.github/workflows/release.yml` at release time. The checksum-before-write,
 * the second press and a connection that never answers are held in
 * `tests/helper-fetch.test.ts`; what this file holds is the source and the
 * destination.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { REACHABLE } from '../../src/agent/pi/reach';
import { fetchHelper, helperFolder, HELPER_WORDS, type Helper } from '../../src/agent/pi/helper';

const run = promisify(execFile);

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function scratch(what: string): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), `graphe-ops-${what}-`)));
  made.push(folder);
  return folder;
}

/** The release, as GitHub would hand it over. Built here rather than fetched, so
 *  nothing in this file needs the network. */
let released: Buffer;

beforeAll(async () => {
  const packing = await scratch('zip');
  await mkdir(join(packing, 'dist'), { recursive: true });
  await writeFile(join(packing, 'manifest.json'), '{"name":"Pretend"}');
  await writeFile(join(packing, 'dist', 'code.js'), 'console.log(1)');
  await run('/usr/bin/zip', ['-q', '-r', 'made.zip', 'manifest.json', 'dist'], { cwd: packing });
  released = await readFile(join(packing, 'made.zip'));
});

const SOURCE = 'https://github.com/example/thing/releases/download/v1.0.0/thing-1.0.0.zip';

function asHelper(over: Partial<Helper> = {}): Helper {
  return {
    name: 'thing-1.0.0',
    from: SOURCE,
    sha256: createHash('sha256').update(released).digest('hex'),
    points: 'manifest.json',
    ...over,
  };
}

/** What the fetch was asked for, in order. */
let asked: string[] = [];

/** Answer the next fetch from the release built above, or with a status. */
function serving(status = 200, bytes: Buffer = released): void {
  asked = [];
  vi.stubGlobal('fetch', (url: string) => {
    asked.push(url);
    return Promise.resolve(
      status === 200 ? new Response(new Uint8Array(bytes)) : new Response(null, { status }),
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ========================================================================== */

describe('where a helper comes from', () => {
  it('is a release of the same version its folder is named for', () => {
    const helpers = REACHABLE.flatMap((one) => (one.helper === undefined ? [] : [one.helper]));
    expect(helpers.length).toBeGreaterThan(0);

    for (const helper of helpers) {
      const version = /(\d+\.\d+\.\d+)$/.exec(helper.name)?.[1] ?? '';
      expect(version, helper.name).not.toBe('');
      // A version in the folder and another in the URL is a folder that lies
      // about what is inside it.
      expect(helper.from, helper.name).toContain(`/releases/download/v${version}/`);
      // "Latest" is a release published after this build, which is exactly what
      // a pinned fetch is for.
      expect(helper.from, helper.name).not.toContain('/latest');
      // The checksum is compared as lowercase hex, so anything else can never
      // match and the helper can never be installed.
      expect(helper.sha256, helper.name).toMatch(/^[0-9a-f]{64}$/);
      // The file the other app is pointed at has to be inside what we unpacked.
      const folder = helperFolder('/data', helper);
      expect(resolve(join(folder, helper.points)), helper.name).toContain(`${resolve(folder)}${sep}`);
    }
  });
});

describe('where it lands', () => {
  it('is asked for at the address it was given, and nowhere else', async () => {
    const under = await scratch('under');
    serving();
    const helper = asHelper();

    const points = await fetchHelper(under, helper);

    expect(asked).toEqual([SOURCE]);
    expect(points).toBe(join(helperFolder(under, helper), 'manifest.json'));
    expect(await readFile(points, 'utf8')).toBe('{"name":"Pretend"}');
  });

  it('is nowhere at all when the release is not there any more', async () => {
    const under = await scratch('under');
    serving(404);

    await expect(fetchHelper(under, asHelper())).rejects.toThrow(HELPER_WORDS.cannotFetch);
    expect(await readdir(helperFolder(under, asHelper())).catch(() => null)).toBeNull();
  });

  it('is thrown away rather than pointed at when the file we promised is not in it', async () => {
    const under = await scratch('under');
    serving();
    // The same release, with the app told to point at something that is not in
    // it: what was unpacked is not the thing that was promised.
    const missing = asHelper({ points: 'dist/missing.js' });

    await expect(fetchHelper(under, missing)).rejects.toThrow(HELPER_WORDS.wrongFile);
    expect(await readdir(helperFolder(under, missing)).catch(() => null)).toBeNull();
  });
});
