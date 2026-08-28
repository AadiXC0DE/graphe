/** One model does the work; a stronger one is asked when it matters.
 *
 *  Three promises are worth holding on to here, and they are what this file is:
 *
 *  1. **A tool an extension registered has to reach the allowlist.** Pi reads a
 *     named `tools` array as the whole list, so a name missing from it is a
 *     tool somebody installed and can never call — which is exactly how the
 *     advisor failed to load before.
 *  2. **The settings file belongs to whoever opened it.** Three keys are ours;
 *     everything else in it survives being written through.
 *  3. **A no-op never writes.** A preference saved on every launch is a file
 *     rewritten for nothing, and `change` is the one place that can tell.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { evaluate } from '../src/agent/guard/policy';

import {
  ADVISOR_PACKAGE,
  advisorSettings,
  advisorToolNames,
  advisorWords,
  asAdvisor,
  extensionToolNames,
  modelRef,
  sameAdvisor,
  worthHaving,
} from '../src/agent/advisor';
import { PreferenceFile, defaultPreferences } from '../src/projects/preferences';

const OPUS = { providerId: 'anthropic', modelId: 'claude-opus-4-5' };
const HAIKU = { providerId: 'anthropic', modelId: 'claude-haiku-4-5' };

const extension = (path: string, tools: readonly string[]) => ({
  resolvedPath: path,
  tools: new Map(tools.map((name) => [name, {}])),
});

describe('the words', () => {
  it('names the two roles and never a mechanism', () => {
    expect(advisorWords.does).toBe('Does the work');
    expect(advisorWords.advises).toBe('Advises');
    const everything = Object.values(advisorWords).join(' ').toLowerCase();
    for (const jargon of ['tool', 'extension', 'token', 'api', 'package', 'ask_advisor']) {
      expect(everything, `says "${jargon}"`).not.toContain(jargon);
    }
  });

  /** The press used to say "Add the advisor" and land on a screen called
   *  something else entirely, which reads as a dead end rather than a step. */
  it('says the addition is missing before offering anything, and names where the press lands', () => {
    expect(advisorWords.missing).toMatch(/addition/i);
    expect(advisorWords.missingAdd).toBe('Add more to Graphe');
  });
});

describe('a model choice out of a file', () => {
  it('takes a pair of names and nothing else', () => {
    expect(asAdvisor(OPUS)).toEqual(OPUS);
    expect(asAdvisor(null)).toBeNull();
    expect(asAdvisor('anthropic/claude-opus-4-5')).toBeNull();
    expect(asAdvisor([OPUS])).toBeNull();
    expect(asAdvisor({ providerId: 'anthropic' })).toBeNull();
    expect(asAdvisor({ providerId: '', modelId: 'x' })).toBeNull();
    expect(asAdvisor({ providerId: 'anthropic', modelId: 7 })).toBeNull();
  });

  it('compares two of them, either of which may be nobody', () => {
    expect(sameAdvisor(null, null)).toBe(true);
    expect(sameAdvisor(OPUS, null)).toBe(false);
    expect(sameAdvisor(OPUS, { ...OPUS })).toBe(true);
    expect(sameAdvisor(OPUS, HAIKU)).toBe(false);
  });

  it('spells a model the way Pi’s own settings do', () => {
    expect(modelRef(OPUS)).toBe('anthropic/claude-opus-4-5');
  });
});

describe('whether a second opinion is worth offering', () => {
  it('stays out of the way when every model costs about the same', () => {
    expect(worthHaving([{ rates: { input: 3, output: 15 } }, { rates: { input: 2, output: 12 } }])).toBe(
      false,
    );
    expect(worthHaving([])).toBe(false);
  });

  it('offers itself once the account has a step up in it', () => {
    expect(worthHaving([{ rates: { input: 0.14, output: 0.28 } }, { rates: { input: 15, output: 75 } }])).toBe(
      true,
    );
  });
});

describe('the tools an extension registered', () => {
  const loaded = [
    extension(`/Users/you/.pi/agent/packages/${ADVISOR_PACKAGE}/extensions/index.ts`, [
      'ask_advisor',
      'record_advisor_outcome',
    ]),
    extension('/Users/you/.pi/agent/packages/pi-lens/index.ts', ['lens_map']),
  ];

  it('all reach the allowlist, or they were installed for nothing', () => {
    expect([...extensionToolNames(loaded)].sort()).toEqual([
      'ask_advisor',
      'lens_map',
      'record_advisor_outcome',
    ]);
  });

  it('separates the advisor’s own, so a chip can turn those and only those off', () => {
    expect([...advisorToolNames(loaded)].sort()).toEqual(['ask_advisor', 'record_advisor_outcome']);
  });

  /** `pi-advisor` is a real, different package. A prefix match would hand its
   *  tools to a chip that was never told about it. */
  it('never lets a shorter package name answer for a longer one', () => {
    const sibling = [extension('/Users/you/.pi/agent/packages/pi-advisor/index.ts', ['ask_advisor'])];
    expect(advisorToolNames(sibling)).toEqual([]);
  });

  it('reads an extension that registered nothing without complaint', () => {
    expect(extensionToolNames([{ resolvedPath: '/somewhere/none.ts' }])).toEqual([]);
  });
});

describe('the settings the addition reads', () => {
  it('writes the choice and leaves everything else exactly as it was', () => {
    const theirs = { advisorGitContext: 'full', advisorMaxCallsPerSession: 3, advisorRedactSecrets: false };
    const next = advisorSettings(theirs, { advises: OPUS, does: HAIKU });
    expect(next).toEqual({
      advisorGitContext: 'full',
      advisorMaxCallsPerSession: 3,
      // Theirs, not ours: a false somebody wrote is an answer, not an absence.
      advisorRedactSecrets: false,
      advisor: 'anthropic/claude-opus-4-5',
      executor: 'anthropic/claude-haiku-4-5',
      alwaysOn: true,
    });
  });

  it('holds secrets back on the first write, because nothing has been said yet', () => {
    expect(advisorSettings(null, { advises: OPUS, does: null })).toEqual({
      advisor: 'anthropic/claude-opus-4-5',
      alwaysOn: true,
      advisorRedactSecrets: true,
    });
  });

  it('turns it off without forgetting who was asked', () => {
    const on = advisorSettings(null, { advises: OPUS, does: HAIKU });
    expect(advisorSettings(on, { advises: null, does: HAIKU })).toEqual({ ...on, alwaysOn: false });
  });
});

describe('remembering the choice', () => {
  const folders: string[] = [];

  const file = async (): Promise<string> => {
    const folder = await mkdtemp(join(tmpdir(), 'graphe-advisor-'));
    folders.push(folder);
    return join(folder, 'preferences.json');
  };

  afterEach(async () => {
    for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
  });

  it('starts with nobody advising', async () => {
    expect(defaultPreferences.advisor).toBeNull();
    expect((await PreferenceFile.open(await file())).all().advisor).toBeNull();
  });

  it('survives the quit, and comes back as a pair of names', async () => {
    const where = await file();
    await (await PreferenceFile.open(where)).change({ advisor: OPUS });
    expect((await PreferenceFile.open(where)).all().advisor).toEqual(OPUS);
  });

  it('turning it off is remembered too', async () => {
    const where = await file();
    const prefs = await PreferenceFile.open(where);
    await prefs.change({ advisor: OPUS });
    await prefs.change({ advisor: null });
    expect((await PreferenceFile.open(where)).all().advisor).toBeNull();
  });

  it('does not write when nothing changed', async () => {
    const where = await file();
    const prefs = await PreferenceFile.open(where);
    await prefs.change({ advisor: OPUS });
    const written = await readFile(where, 'utf8');

    // A file nobody rewrote is a file this line cannot break.
    await writeFile(where, 'not json any more', 'utf8');
    await prefs.change({ advisor: { ...OPUS } });
    expect(await readFile(where, 'utf8')).toBe('not json any more');

    await prefs.change({ advisor: HAIKU });
    expect(await readFile(where, 'utf8')).not.toBe(written);
  });

  it('drops a choice a hand-edited file cannot spell', async () => {
    const where = await file();
    await writeFile(
      where,
      JSON.stringify({ version: 1, preferences: { advisor: 'anthropic/claude-opus-4-5' } }),
      'utf8',
    );
    expect((await PreferenceFile.open(where)).all().advisor).toBeNull();
  });
});


/* ========================================================================== */
/* What may leave with a question                                             */
/* ========================================================================== */

describe('the Guard on a second opinion', () => {
  const facts = { projectRoot: '/Users/mira/Projects/portfolio' };
  const ask = (input: Record<string, unknown>) =>
    evaluate({ id: 'call-1', name: 'ask_advisor', input }, facts);

  it('lets an ordinary question straight through, because the choice was the consent', () => {
    expect(ask({ question: 'Is this the right shape for the router?' }).kind).toBe('allow');
  });

  it('is a tool the Guard has an opinion about at all', () => {
    expect(ask({ question: 'anything' }).kind).not.toBe('confirm');
    expect(evaluate({ id: 'c', name: 'record_advisor_outcome', input: { outcome: 'helped' } }, facts).kind)
      .toBe('allow');
  });

  /* The advisor forwards whatever it was handed, so a key in any field of the
     call leaves the machine — not only one in a field we thought to name. */
  it('refuses a key wherever in the call it is hiding', () => {
    const key = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(ask({ question: `Why does ${key} not work?` }).kind).toBe('deny');
    expect(ask({ question: 'Why does this fail?', draft: key }).kind).toBe('deny');
    expect(ask({ question: 'Why does this fail?', context: { env: key } }).kind).toBe('deny');
    expect(ask({ question: 'Why does this fail?', notes: [key] }).kind).toBe('deny');
  });
});
