/** One model does the work; a stronger one is asked when it matters.
 *
 *  Three promises are worth holding on to here, and they are what this file is:
 *
 *  1. **A tool an extension registered has to reach the allowlist.** Pi reads a
 *     named `tools` array as the whole list, so a name missing from it is a
 *     tool somebody installed and can never call — which is exactly how the
 *     advisor failed to load before.
 *  2. **The settings file belongs to whoever opened it.** We write the choice
 *     and, once, the defaults the advisor is useless without; everything else
 *     in it survives being written through.
 *  3. **A no-op never writes.** A preference saved on every launch is a file
 *     rewritten for nothing, and `change` is the one place that can tell.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ADVISOR_STUCK, switchAdvisorTools } from '../src/agent/pi/adapter';
import { evaluate } from '../src/agent/guard/policy';

import {
  ADVISOR_PACKAGE,
  advisorSettings,
  advisorToolNames,
  advisorWords,
  asAdvisor,
  asAdvisorThinking,
  extensionToolNames,
  modelRef,
  sameAdvisor,
  worthHaving,
} from '../src/agent/advisor';
import { THINKING_LEVELS } from '../src/lib/thinking';
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

  /** Off was called "One model, all of it", which is true and is not the word
   *  anybody scans for when they want it to stop. */
  it('says off in the word somebody is looking for', () => {
    expect(advisorWords.off).toBe('Off');
    expect(advisorWords.turnOff.toLowerCase()).toContain('off');
    expect(advisorWords.offNote).not.toBe('');
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
    const theirs = {
      advisorGitContext: 'full',
      advisorMaxCallsPerSession: 3,
      // Theirs, not ours: a value somebody wrote is an answer, not an absence.
      advisorRedactSecrets: false,
      contextMaxChars: 8000,
      advisorToolResultMaxLines: 4000,
      advisorToolResultMaxBytes: 900_000,
    };
    const next = advisorSettings(theirs, { advises: OPUS, does: HAIKU });
    expect(next).toEqual({
      ...theirs,
      advisor: 'anthropic/claude-opus-4-5',
      executor: 'anthropic/claude-haiku-4-5',
      alwaysOn: true,
    });
  });

  /** The advisor's first answer was written on nothing at all: the package
   *  walks the conversation newest first and stops at the first entry too big
   *  for the window, and a single large file read is bigger than the window it
   *  ships with. It answered anyway, on an omission marker. */
  it('gives the advisor a window, and a cap no single step can fill', () => {
    const first = advisorSettings(null, { advises: OPUS, does: null });
    expect(first).toEqual({
      advisor: 'anthropic/claude-opus-4-5',
      alwaysOn: true,
      advisorRedactSecrets: true,
      contextMaxChars: 48_000,
      advisorToolResultMaxLines: 60,
      advisorToolResultMaxBytes: 3_000,
    });
    expect(Number(first['advisorToolResultMaxBytes'])).toBeLessThan(
      Number(first['contextMaxChars']) / 4,
    );
  });

  it('turns it off without forgetting who was asked', () => {
    const on = advisorSettings(null, { advises: OPUS, does: HAIKU });
    expect(advisorSettings(on, { advises: null, does: HAIKU })).toEqual({ ...on, alwaysOn: false });
  });
});

/* The package reads how hard the advisor thinks from `advisorEffort`, a string
   on the same ladder the rest of the app already uses. */
describe('how long the advisor thinks', () => {
  it('writes the level the control was set to', () => {
    expect(advisorSettings(null, { advises: OPUS, does: HAIKU, advisorThinks: 'high' })).toMatchObject(
      { advisorEffort: 'high' },
    );
  });

  it('leaves the file alone when nobody has said', () => {
    expect(advisorSettings(null, { advises: OPUS, does: HAIKU })).not.toHaveProperty('advisorEffort');
    expect(
      advisorSettings({ advisorEffort: 'max' }, { advises: OPUS, does: HAIKU }),
    ).toMatchObject({ advisorEffort: 'max' });
  });

  /** Unlike the defaults, this one is behind a control: pressing the row is
   *  somebody answering the question again, so their new answer wins. */
  it('overwrites a value already in the file, because the control is the answer', () => {
    expect(
      advisorSettings({ advisorEffort: 'low' }, { advises: OPUS, does: HAIKU, advisorThinks: 'xhigh' }),
    ).toMatchObject({ advisorEffort: 'xhigh' });
  });

  it('says nothing about it while the advisor is off', () => {
    const off = advisorSettings({ advisorEffort: 'low' }, { advises: null, does: HAIKU, advisorThinks: 'max' });
    expect(off).toEqual({ advisorEffort: 'low', alwaysOn: false });
  });

  it('reads a level back out of a file, and nothing else', () => {
    expect(asAdvisorThinking('medium')).toBe('medium');
    expect(asAdvisorThinking('off')).toBe('off');
    expect(asAdvisorThinking('Default (Model Default)')).toBeNull();
    expect(asAdvisorThinking(undefined)).toBeNull();
    expect(asAdvisorThinking(3)).toBeNull();
  });

  /** Ours and the package's ladders have to be the same words, or a level
   *  chosen here is a level it quietly ignores. */
  it('offers only levels the addition itself accepts', () => {
    expect([...THINKING_LEVELS]).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    for (const level of THINKING_LEVELS) expect(asAdvisorThinking(level)).toBe(level);
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

/* The chip is a switch, and a switch that did nothing has to say so: on a Pi
   with no way to change which tools are active the advisor stays exactly as
   the conversation started, whichever way it was pressed. */
describe('turning the advisor on and off mid-conversation', () => {
  const TOOLS = ['ask_advisor', 'record_advisor_outcome'];

  function sessionWith(active: string[]) {
    const state = { active };
    return {
      state,
      getActiveToolNames: (): readonly string[] => state.active,
      setActiveToolsByName: (names: string[]): void => {
        state.active = names;
      },
    };
  }

  it('adds the advisor tools when it goes on and takes them away when it goes off', () => {
    const session = sessionWith(['read', 'bash']);

    expect(switchAdvisorTools(session, TOOLS, true)).toBe(true);
    expect(session.state.active).toEqual(['read', 'bash', ...TOOLS]);

    expect(switchAdvisorTools(session, TOOLS, false)).toBe(true);
    expect(session.state.active).toEqual(['read', 'bash']);
  });

  it('says the switch did not take when the installed Pi cannot make it', () => {
    const older = {
      getActiveToolNames: (): readonly string[] => ['read'],
      setActiveToolsByName: undefined as unknown as (names: string[]) => void,
    };

    expect(switchAdvisorTools(older, TOOLS, true)).toBe(false);
    expect(switchAdvisorTools(older, TOOLS, false)).toBe(false);
  });

  it('has nothing to report when the advisor addition is not installed', () => {
    const session = sessionWith(['read']);
    expect(switchAdvisorTools(session, [], true)).toBe(true);
    expect(session.state.active).toEqual(['read']);
  });

  it('tells the window what happened instead of failing silently', () => {
    expect(ADVISOR_STUCK).toContain('advisor');
    expect(ADVISOR_STUCK).toContain('saved');

    const adapter = readFileSync(new URL('../src/agent/pi/adapter.ts', import.meta.url), 'utf8');
    // Both the setting at open and the press mid-conversation feed the same
    // line, and both say it rather than dropping it in a catch.
    expect(adapter.match(/advisorStuck = !advisorActive\(/g)).toHaveLength(2);
    expect(adapter).toContain('sayAdvisorStuck();');
  });
});

describe('every conversation gets the advisor, including a canvas one', () => {
  const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');

  it('is passed at every place a session is opened', () => {
    // A canvas opens its conversation through the same handler a tab does, so
    // "does the canvas use the advisor" is the same question as "does chat".
    const opens = main.match(/createSession\(\{/g)?.length ?? 0;
    const carried = main.match(/advisor: (?:prefs\.advisor|\(await preferences\(\)\)\.all\(\)\.advisor)/g)?.length ?? 0;
    expect(opens).toBeGreaterThan(0);
    expect(carried).toBe(opens);
  });

  it('and so is how long it thinks', () => {
    const paced = main.match(/advisorThinking: (?:prefs\.advisorThinking|\(await preferences\(\)\)\.all\(\)\.advisorThinking)/g)?.length ?? 0;
    expect(paced).toBe(main.match(/createSession\(\{/g)?.length ?? 0);
  });
});
