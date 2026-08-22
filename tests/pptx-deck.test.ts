/** Asking for a deck.
 *
 * "Build me a deck" is the non-code job this app claims and had nothing for.
 * Three things have to hold for it: the instructions have to be readable by the
 * skill library, every step of the work has to get past the Guard without a
 * wall, and the file that comes out has to be handed over as a deck rather than
 * as bytes nobody can place.
 */

import { readFileSync } from 'node:fs';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { availableSkills } from '../src/agent/pi/skills';
import { evaluate } from '../src/agent/guard/policy';
import { serveFolder } from '../src/preview/serve';

const here = dirname(fileURLToPath(import.meta.url));
const SKILL = join(here, '..', 'skills', 'pptx', 'SKILL.md');

const readSkill = (): Promise<string> => readFile(SKILL, 'utf8');

const madeFolders: string[] = [];

afterAll(async () => {
  await Promise.all(madeFolders.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'graphe-deck-')));
  madeFolders.push(folder);
  return folder;
}

/* ========================================================================== */
/* D-01 the instructions                                                       */
/* ========================================================================== */

describe('D-01 the deck skill is one the library can read', () => {
  it('is found, named and described by the same reader the app draws from', async () => {
    const agentDir = await newFolder();
    await cp(join(here, '..', 'skills'), join(agentDir, 'skills'), { recursive: true });

    const found = await availableSkills(null, agentDir);
    const deck = found.find((skill) => skill.name === 'pptx');
    expect(deck, 'the deck skill was not discovered').toBeDefined();
    expect(deck?.handle).toBe('pptx');
    expect(deck?.description).toMatch(/deck|presentation|slide/i);
    // A description is what the model reads when it is choosing, so it has to
    // say the words somebody would actually type.
    expect(deck?.description.toLowerCase()).toContain('deck');
  });

  it('sends the agent to the project’s own look before it makes a slide', async () => {
    const text = await readSkill();
    expect(text).toMatch(/tokens\.css/);
    expect(text).toMatch(/tailwind\.config/i);
    expect(text).toContain('src/styles/tokens.css');
  });

  it('names both routes, and keeps the install inside the project', async () => {
    const text = await readSkill();
    expect(text).toMatch(/python-pptx/);
    expect(text).toMatch(/PptxGenJS/i);
    expect(text).toMatch(/python3 -m venv \.venv/);
    expect(text).not.toMatch(/pip install .*--user|sudo pip/);
  });

  it('makes it check its own work rather than announce it', async () => {
    const text = await readSkill();
    expect(text).toMatch(/from pptx import Presentation/);
    expect(text).toMatch(/assert len\(deck\.slides\)/);
    expect(text).toMatch(/soffice|libreoffice/);
    expect(text).toMatch(/Verify, do not announce/i);
  });

  it('tells it to say what it made and where', async () => {
    const text = await readSkill();
    expect(text).toMatch(/Name the file and where it is/i);
  });
});

/* ========================================================================== */
/* D-02 the way through                                                        */
/* ========================================================================== */

describe('D-02 every step of making a deck gets through', () => {
  const project = '/work/site';
  const kind = (command: string): string =>
    evaluate({ id: 'c', name: 'bash', input: { command } }, { projectRoot: project }).kind;

  /* Nothing here is an outright yes, and nothing here needs to be: a restore
     point is taken and the work carries on. A wall would be a `deny`. */
  it('builds, checks and renders without a wall in the way', () => {
    for (const command of [
      'python3 -m venv .venv',
      '.venv/bin/python scripts/build_deck.py',
      '.venv/bin/python scripts/check_deck.py',
      'node scripts/build-deck.mjs',
      'soffice --headless --convert-to pdf --outdir out out/deck.pptx',
      'pdftoppm -png -r 80 out/deck.pdf out/slide',
      'ls -l out/deck.pptx',
    ]) {
      expect(kind(command), command).not.toBe('deny');
    }
  });

  /* Fetching somebody else's code is the one question worth asking, and the
     skill says to let it be asked rather than route around it. */
  it('asks once, plainly, before bringing the library in', () => {
    expect(kind('.venv/bin/pip install python-pptx')).toBe('confirm');
    expect(kind('npm install pptxgenjs')).toBe('confirm');
  });

  /* Why the skill writes its check as a file: code handed straight to a runtime
     cannot be read before it runs, so it is refused — and the skill says so
     rather than teaching a command that will not run. */
  it('never hands code to a runtime on the command line', async () => {
    expect(kind('python3 -c "from pptx import Presentation; print(1)"')).toBe('deny');
    const text = await readSkill();
    expect(text).toMatch(/cannot be read before it runs/);
  });

  it('still stops a deck being written anywhere but the project', () => {
    expect(kind('.venv/bin/python scripts/build_deck.py --out /etc/deck.pptx')).toBe('deny');
    expect(kind('python3 ../../elsewhere/build_deck.py')).toBe('deny');
  });
});

/* ========================================================================== */
/* D-03 handing the file over                                                  */
/* ========================================================================== */

describe('D-03 what comes out is handed over as itself', () => {
  it('names a deck, a document and a sheet rather than sending unplaceable bytes', async () => {
    const folder = await newFolder();
    await writeFile(join(folder, 'index.html'), '<h1>Half Year</h1>');
    await writeFile(join(folder, 'deck.pptx'), 'PK not really a deck');
    await writeFile(join(folder, 'notes.docx'), 'PK');
    await writeFile(join(folder, 'numbers.xlsx'), 'PK');

    const serving = await serveFolder(folder);
    try {
      const deck = await fetch(`${serving.address}/deck.pptx`);
      expect(deck.status).toBe(200);
      expect(deck.headers.get('content-type')).toBe(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      );
      const doc = await fetch(`${serving.address}/notes.docx`);
      expect(doc.headers.get('content-type')).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      const sheet = await fetch(`${serving.address}/numbers.xlsx`);
      expect(sheet.headers.get('content-type')).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    } finally {
      await serving.stop();
    }
  });

  it('still sends a file it cannot name as bytes, rather than guessing', async () => {
    const folder = await newFolder();
    await writeFile(join(folder, 'index.html'), '<h1>Half Year</h1>');
    await writeFile(join(folder, 'deck.sketchup'), 'whatever');

    const serving = await serveFolder(folder);
    try {
      const odd = await fetch(`${serving.address}/deck.sketchup`);
      expect(odd.headers.get('content-type')).toBe('application/octet-stream');
    } finally {
      await serving.stop();
    }
  });
});

/* A skill nobody can reach is a file, not a feature. The one this app brings
   with it lives beside the source in a checkout and beside the licences in a
   packaged app, and neither is a place the reader looked before. */
describe('D-04 the app can actually find what it brought with it', () => {
  const skills = readFileSync(new URL('../src/agent/pi/skills.ts', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const packaging = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');

  it('reads a root for the skills that ship with it', () => {
    expect(skills).toContain('export function skillsShippedWith');
    expect(skills).toContain("if (shippedWith !== '') roots.push({ path: shippedWith, source: 'global' })");
  });

  it('lets anything somebody installed themselves win over it', () => {
    const own = skills.indexOf("path: join(homedir(), '.agents', 'skills')");
    const shipped = skills.indexOf("path: shippedWith");
    expect(own).toBeGreaterThan(-1);
    expect(shipped).toBeGreaterThan(own);
  });

  it('is told where they are, in a checkout and in a packaged app', () => {
    expect(shell).toContain('skillsShippedWith(');
    expect(shell).toContain('process.resourcesPath');
    expect(shell).toContain("join(app.getAppPath(), 'skills')");
  });

  it('travels with the packaged app rather than only the checkout', () => {
    const at = packaging.indexOf('extraResources:');
    expect(at).toBeGreaterThan(-1);
    expect(packaging.slice(at, at + 400)).toMatch(/^\s+- skills\s*$/m);
  });
});
