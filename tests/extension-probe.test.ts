/** What an add-on will do, found out by running it against a stub.
 *
 * The point of the probe is that nothing is keyed to a package name, so these
 * are three fixtures with no names anybody would recognise: one that only adds
 * tools, one that drives, and one that falls over.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { cachedProbe, probe, saysCard } from '../src/agent/pi/extension-probe';

const at = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/extensions/${name}/index.mjs`, import.meta.url));

const made: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'graphe-cards-'));
  made.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

describe('an add-on that only adds tools', () => {
  it('is written down as exactly what it registered', async () => {
    const card = await probe(at('plain'));
    expect(card).not.toBeNull();
    expect(card?.id).toBe('plain');
    expect(card?.tools).toEqual(['count_words', 'spell_check']);
    expect(card?.commands).toEqual(['spell']);
    expect(card?.hooks).toEqual([]);
  });

  it('does none of the things that make an add-on a second driver', async () => {
    const card = await probe(at('plain'));
    expect(card?.startsTurns).toBe(false);
    expect(card?.runsBackgroundWork).toBe(false);
    expect(card?.rewritesSystemPrompt).toBe(false);
    expect(card?.orchestrating).toBe(false);
  });

  it('says what it adds, since there is nothing to warn about', async () => {
    const card = await probe(at('plain'));
    expect(card === null ? '' : saysCard(card)).toBe('adds 2 tools · adds one command');
  });
});

describe('an add-on that drives', () => {
  it('is caught taking the end of a turn and asking for another', async () => {
    const card = await probe(at('orchestrating'));
    expect(card?.hooks).toContain('agent_end');
    expect(card?.hooks).toContain('before_agent_start');
    expect(card?.startsTurns).toBe(true);
    expect(card?.rewritesSystemPrompt).toBe(true);
    expect(card?.runsBackgroundWork).toBe(true);
    expect(card?.orchestrating).toBe(true);
  });

  it('counts what its tool costs every prompt, in bytes rather than adjectives', async () => {
    const card = await probe(at('orchestrating'));
    expect(card?.toolPromptBytes).toBeGreaterThan(6 * 1024);
  });

  it('says all three things it will do, in the order they matter', async () => {
    const card = await probe(at('orchestrating'));
    expect(card === null ? '' : saysCard(card)).toBe(
      'starts turns on its own · runs work in the background · changes the system prompt · 6.2k of every prompt',
    );
  });
});

describe('an add-on that falls over', () => {
  it('comes back as nothing rather than as a failure somebody has to handle', async () => {
    await expect(probe(at('throws'))).resolves.toBeNull();
    await expect(probe(at('not-installed-at-all'))).resolves.toBeNull();
  });
});

describe('the same answer without running anybody’s code twice', () => {
  it('remembers a card and hands the same one back', async () => {
    const dir = await scratch();
    const first = await cachedProbe(at('orchestrating'), dir);
    const again = await cachedProbe(at('orchestrating'), dir);
    expect(again).toEqual(first);

    const held: unknown = JSON.parse(await readFile(join(dir, 'cards.json'), 'utf8'));
    const one = (held as Record<string, { card: { orchestrating: boolean } }>)[
      at('orchestrating')
    ];
    expect(one?.card.orchestrating).toBe(true);
  });

  it('remembers that an add-on could not be read, too', async () => {
    const dir = await scratch();
    await expect(cachedProbe(at('throws'), dir)).resolves.toBeNull();
    await expect(cachedProbe(at('throws'), dir)).resolves.toBeNull();
  });
});
