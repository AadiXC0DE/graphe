/** Choice without complexity, and the two things that go in front of it.
 *
 * Four backlog items meet in this file because they are one promise from four
 * directions — **the agent manages everything by default, and anyone who wants
 * the wheel can have it, and neither group is punished**:
 *
 *   D1  "Show me" names the real thing behind each step, and is off by default
 *   D2  the folder and the editor are one click away, always
 *   F7  a big job is quoted before it runs, and a small one just happens
 *   F8  a long conversation is tidied with one plain sentence in front of it
 *
 * The thing most of these tests are actually protecting is a *silence*: that
 * somebody who never turns anything on is never shown a command, never asked
 * about money for a small change, and never made to read the word for what
 * tidying is called. A feature that leaks is worse than one that is missing,
 * because it leaks onto the people the product exists for.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PI_CURRENCY } from '../src/agent/pi/usage';
import type { AgentEvent, ToolCall } from '../src/agent/types';
import { estimateFrom, defaultWarnThreshold, shouldWarn } from '../src/cost/estimate';
import { money } from '../src/cost/money';
import { longConversation } from '../src/cost/phrasing';
import { sizeUp } from '../src/cost/sizing';
import { CURRENCY_BEFORE_ANY_SPEND, quote, smallerFirst } from '../src/lib/estimating';
import { describeCall } from '../src/lib/describe';
import { changeCurrent, currentDesk, noDesks, openDesk, receive } from '../src/lib/projects';
import { behind, realWords, showMeCopy } from '../src/lib/showme';
import { applyEvent, said, type Turn } from '../src/lib/thread';
import { defaultPreferences, PreferenceFile } from '../src/projects/preferences';
import { findEditor, openInLabel } from '../src/shell/editors';

function call(name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id: 'c1', name, input };
}

async function inATemporaryFolder<T>(run: (folder: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), 'graphe-choices-'));
  try {
    return await run(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/* ========================================================================== */
/* D1 — "Show me"                                                              */
/* ========================================================================== */

describe('D1 — the real name of what just happened', () => {
  it('gives back the command, verbatim, for anything that runs one', () => {
    expect(realWords(call('bash', { command: 'npm install lucide-react' }))).toBe(
      'bash · npm install lucide-react',
    );
    expect(realWords(call('exec', { cmd: 'npm run build' }))).toBe('exec · npm run build');
  });

  it('gives back the whole path, where the plain sentence gives back the file name', () => {
    const editing = call('edit', { path: '/Users/you/Sites/paper-street/src/contact.html' });
    // The two are deliberately different jobs: one is what people call their
    // file, the other is what they could paste into something else.
    expect(describeCall(editing).label).toBe('Changing contact.html');
    expect(realWords(editing)).toBe('edit · /Users/you/Sites/paper-street/src/contact.html');
  });

  it('says where a search looked as well as what it looked for', () => {
    expect(realWords(call('grep', { pattern: 'hero', path: 'src/' }))).toBe('grep · hero in src/');
    expect(realWords(call('glob', { pattern: '**/*.css' }))).toBe('glob · **/*.css');
  });

  it('falls back to the tool’s own name rather than inventing an argument', () => {
    expect(realWords(call('bash', {}))).toBe('bash');
    expect(realWords(call('something_new', {}))).toBe('something_new');
    expect(realWords(call('something_new', { target: 'the hero' }))).toBe(
      'something_new · the hero',
    );
  });

  it('keeps one long command to one readable line', () => {
    const long = `echo ${'x'.repeat(900)}`;
    const shown = realWords(call('bash', { command: long }));
    expect(shown.length).toBeLessThan(430);
    expect(shown.endsWith('…')).toBe(true);
  });

  it('flattens a multi-line command instead of letting it become a terminal', () => {
    expect(realWords(call('bash', { command: 'npm run build\n\n  && npm test' }))).toBe(
      'bash · npm run build && npm test',
    );
  });

  /* The boundary. Jargon is allowed in exactly one module, and the point of
     saying so in a test is that the exemption stays a boundary rather than
     becoming a habit. */
  it('is the one place the machinery’s own words are allowed', () => {
    const jargon = /\b(git|commit|bash|grep|compact\w*|context|token)\b/i;
    const theRealWords = [
      behind.versions,
      behind.putBack,
      behind.naming,
      behind.spend,
      behind.tidying,
      realWords(call('bash', { command: 'npm test' })),
    ];
    expect(theRealWords.some((one) => jargon.test(one))).toBe(true);

    // And the sentence it hangs under is still clean.
    const inFront = [
      longConversation.tidying,
      showMeCopy.label,
      showMeCopy.hint,
      describeCall(call('bash', { command: 'npm test' })).label,
    ];
    for (const sentence of inFront) expect(sentence).not.toMatch(jargon);
  });

  it('is off until somebody asks for it, and remembered once they have', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'preferences.json');
      const first = await PreferenceFile.open(file);
      expect(first.all()).toEqual(defaultPreferences);
      expect(first.all().showMe).toBe(false);

      expect((await first.change({ showMe: true })).showMe).toBe(true);

      // The next launch, which is the whole of "sticky".
      const later = await PreferenceFile.open(file);
      expect(later.all().showMe).toBe(true);

      expect((await later.change({ showMe: false })).showMe).toBe(false);
      expect((await PreferenceFile.open(file)).all().showMe).toBe(false);
    });
  });

  it('starts from the defaults rather than failing when the file is nonsense', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'preferences.json');
      await writeFile(file, '{ this is not json', 'utf8');
      expect((await PreferenceFile.open(file)).all()).toEqual(defaultPreferences);

      await writeFile(file, JSON.stringify({ preferences: { showMe: 'yes please' } }), 'utf8');
      expect((await PreferenceFile.open(file)).all().showMe).toBe(false);
    });
  });

  it('writes the whole file, so a half-written one cannot exist', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'preferences.json');
      const preferences = await PreferenceFile.open(file);
      await preferences.change({ showMe: true });
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
        version: 1,
        preferences: {
          showMe: true,
          model: null,
          thinking: {},
          kept: {},
          trusted: {},
          showFiles: false,
          heldBack: {},
          howMuch: null,
          ceiling: null,
        },
      });
    });
  });

  it('holds back one project without changing another', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'preferences.json');
      const preferences = await PreferenceFile.open(file);
      await preferences.change({ heldBack: { ...preferences.all().heldBack, ['/one']: true } });
      const read = await PreferenceFile.open(file);
      // The project that asked is held back; the other is not asked for.
      expect(read.all().heldBack['/one']).toBe(true);
      expect(read.all().heldBack['/two']).toBeUndefined();
    });
  });

  /* The words are recorded on every turn whether or not anybody asked for them,
     so turning the switch on explains the conversation you already had. A
     history that starts when you ask for it is no use for working out what just
     happened. */
  it('records the real words even while the switch is off', () => {
    const started: AgentEvent = {
      type: 'tool-start',
      call: call('bash', { command: 'npm run build' }),
    };
    const [turn] = applyEvent([], started);
    expect(turn?.kind).toBe('did');
    expect(turn?.kind === 'did' ? turn.real : null).toBe('bash · npm run build');
  });
});

/* ========================================================================== */
/* D2 — the way out                                                            */
/* ========================================================================== */

describe('D2 — the folder and the editor, one click away', () => {
  const everywhere = ['/Applications', '/Users/you/Applications'];

  function installed(...bundles: string[]) {
    const there = new Set(bundles);
    return (path: string) => Promise.resolve(there.has(path));
  }

  it('finds the editor most of this audience has, when it is there', async () => {
    const found = await findEditor({
      folders: everywhere,
      exists: installed('/Applications/Visual Studio Code.app'),
    });
    expect(found).toEqual({
      name: 'VS Code',
      bundle: '/Applications/Visual Studio Code.app',
    });
    expect(openInLabel(found)).toBe('Open in VS Code');
  });

  it('names whatever it actually found, rather than "your editor"', async () => {
    const found = await findEditor({
      folders: everywhere,
      exists: installed('/Applications/Cursor.app', '/Applications/Zed.app'),
    });
    expect(openInLabel(found)).toBe('Open in Cursor');
  });

  it('prefers VS Code over the rest when several are installed', async () => {
    const found = await findEditor({
      folders: everywhere,
      exists: installed(
        '/Applications/Zed.app',
        '/Applications/Visual Studio Code.app',
        '/Applications/Sublime Text.app',
      ),
    });
    expect(found?.name).toBe('VS Code');
  });

  it('looks in the per-user Applications folder, which people forget', async () => {
    const found = await findEditor({
      folders: everywhere,
      exists: installed('/Users/you/Applications/Nova.app'),
    });
    expect(found?.name).toBe('Nova');
  });

  it('offers nothing rather than a button that opens nothing', async () => {
    const found = await findEditor({ folders: everywhere, exists: installed() });
    expect(found).toBeNull();
    expect(openInLabel(found)).toBeNull();
  });
});

/* ========================================================================== */
/* F7 — an estimate before a big job, and silence before a small one           */
/* ========================================================================== */

describe('F7 — sizing a request up before it runs', () => {
  it('calls an ordinary change a tweak', () => {
    for (const request of [
      'make the header sticky',
      'change the colour of the buttons',
      'move the logo up a bit',
      'fix the typo in the footer',
    ]) {
      expect(sizeUp(request).size).toBe('tweak');
    }
  });

  it('recognises the jobs that have a shape', () => {
    expect(sizeUp('add a contact form to the about page')).toEqual({
      kind: 'contact-form',
      size: 'feature',
    });
    expect(sizeUp('build the landing page').kind).toBe('landing-page');
    expect(sizeUp('bring in this Figma file').kind).toBe('figma-import');
    expect(sizeUp('build me a website for my studio').size).toBe('project');
  });

  it('lets the wording move the size in both directions', () => {
    expect(sizeUp('rebuild the whole navigation').size).toBe('project');
    expect(sizeUp('just change the colour on the landing page').size).toBe('tweak');
  });

  it('treats a long brief as a job rather than a change', () => {
    const brief = `I would like the top of the page to feel calmer. ${'The spacing is too tight and the type is too large and the images are competing with the words. '.repeat(2)}Somewhere between what we have and something quieter.`;
    expect(sizeUp(brief).size).not.toBe('tweak');
  });

  it('calls anything it does not recognise a tweak, so nothing is asked about', () => {
    expect(sizeUp('hmm')).toEqual({ kind: 'tweak', size: 'tweak' });
    expect(sizeUp('')).toEqual({ kind: 'tweak', size: 'tweak' });
    expect(quote([], null, 'hmm').prompt).toBeNull();
  });
});

describe('F7 — what gets said, and to whom', () => {
  it('says nothing at all about a small change', () => {
    const priced = quote([], null, 'make the header sticky');
    expect(priced.warn).toBe(false);
    expect(priced.prompt).toBeNull();
  });

  /* The pause before something big is the whole point of this question. The
     price never was: a subscription is not metered per token, and a confident
     number we cannot check is worse than none. */
  it('asks before a big one, in minutes and never in money', () => {
    const priced = quote([], null, 'build me a website for my studio');
    expect(priced.warn).toBe(true);
    expect(priced.prompt?.title).toBe('This is a bigger job');
    expect(priced.prompt?.body).toMatch(/It should take/);
    expect(priced.prompt?.confirm).toBe('Go ahead');
    expect(priced.prompt?.alternative).toBe('Do a smaller version first');
  });

  it('puts no price anywhere in the question, in any currency', () => {
    for (const spent of [null, money(4000, 'INR'), money(100, 'USD')]) {
      const priced = quote([], spent, 'build me a website for my studio');
      const words = `${priced.prompt?.body ?? ''} ${priced.prompt?.note ?? ''}`;
      expect(words).not.toMatch(/[₹$€£]|\d+(\.\d+)?\s*(cents?|dollars?|rupees?)/i);
    }
  });

  it('admits it is guessing until it has measured something', () => {
    expect(quote([], null, 'build me a website').estimate.confidence).toBe('no-history');
    expect(quote([], null, 'build me a website').prompt?.note).toMatch(/haven’t done one of these/);
  });

  /* The estimate still carries a currency, because the ceiling somebody set is
     in one and the two have to be comparable. Only the sentence stays silent. */
  it('estimates in whatever the account is actually billed in', () => {
    const inr = quote([], money(4000, 'INR'), 'build me a website');
    expect(inr.estimate.expected.currency).toBe('INR');
  });

  /** The window cannot import from src/agent/pi — the renderer is not allowed
   *  to know Pi exists. So the currency is written down on both sides of that
   *  line, and this is the thing that stops the two drifting apart. */
  it('quotes the first job of all in the currency pricing will arrive in', () => {
    expect(CURRENCY_BEFORE_ANY_SPEND).toBe(PI_CURRENCY);
  });

  it('uses what this project actually cost once there is anything to use', () => {
    const at = Date.now();
    const cheap = Array.from({ length: 6 }, (_, index) => ({
      kind: 'landing-page',
      size: 'page' as const,
      cost: money(9, 'USD'),
      durationMs: 30_000,
      at: at + index,
    }));
    const priced = quote(cheap, money(100, 'USD'), 'build the landing page');
    expect(priced.estimate.confidence).toBe('measured');
    expect(priced.estimate.expected).toEqual(money(9, 'USD'));
    // Nine cents is nobody's idea of a bigger job, so nothing is said — which is
    // the point of measuring rather than guessing forever.
    expect(priced.warn).toBe(false);
  });

  it('ignores history billed in another currency rather than comparing it', () => {
    const inRupees = [
      { kind: 'landing-page', size: 'page' as const, cost: money(200, 'INR'), at: 1 },
    ];
    const priced = quote(inRupees, money(100, 'USD'), 'build the landing page');
    expect(priced.estimate.confidence).toBe('no-history');
    expect(priced.estimate.expected.currency).toBe('USD');
  });

  it('leaves the decision where estimate.ts already put it', () => {
    // Not a second threshold of our own: the same call, on the same objects.
    const priced = quote([], null, 'build me a website for my studio');
    expect(priced.warn).toBe(
      shouldWarn(
        estimateFrom([], priced.task, CURRENCY_BEFORE_ANY_SPEND),
        defaultWarnThreshold(CURRENCY_BEFORE_ANY_SPEND),
      ),
    );
  });

  it('has a sentence for “I would rather start smaller” that is not a refusal', () => {
    expect(smallerFirst).toMatch(/smaller/);
    expect(smallerFirst).not.toMatch(/\b(cannot|can’t|won’t|too expensive)\b/i);
  });
});

/* ========================================================================== */
/* F7 — measuring what it came to                                              */
/* ========================================================================== */

describe('F7 — filing what each job actually cost', () => {
  const path = '/Users/you/Sites/paper-street';

  function aDeskDoingSomething(size: 'page' | 'feature' = 'feature') {
    const desks = openDesk(noDesks, { path, name: 'paper-street' });
    return changeCurrent(desks, (one) => ({
      ...one,
      doing: { task: { kind: 'contact-form', size }, startedAt: 1000 },
    }));
  }

  function settledAt(totalMinor: number): AgentEvent {
    return {
      type: 'spend-summary',
      summary: {
        currency: 'USD',
        total: money(totalMinor, 'USD'),
        work: money(totalMinor, 'USD'),
        retry: money(0, 'USD'),
        retryShare: 0,
        entryCount: 3,
        firstAt: 0,
        lastAt: 1,
        largestRetry: null,
      },
    };
  }

  it('records what the job came to, and how long it took', () => {
    const after = receive(aDeskDoingSomething(), { project: path, event: settledAt(140) }, 61_000);
    const desk = currentDesk(after);
    expect(desk?.jobs).toHaveLength(1);
    expect(desk?.jobs[0]?.kind).toBe('contact-form');
    expect(desk?.jobs[0]?.cost).toEqual(money(140, 'USD'));
    expect(desk?.jobs[0]?.durationMs).toBe(60_000);
    expect(desk?.doing).toBeNull();
  });

  /** The ledger reports the whole sitting each time, so a second job charged the
   *  running total would be recorded as costing everything spent since lunch —
   *  and every estimate after it would be nonsense. */
  it('charges each job the difference, not the running total', () => {
    let desks = receive(aDeskDoingSomething(), { project: path, event: settledAt(140) }, 2000);
    desks = changeCurrent(desks, (one) => ({
      ...one,
      doing: { task: { kind: 'blog', size: 'feature' }, startedAt: 3000 },
    }));
    desks = receive(desks, { project: path, event: settledAt(365) }, 4000);

    const desk = currentDesk(desks);
    expect(desk?.jobs.map((one) => one.cost.minor)).toEqual([140, 225]);
  });

  it('files nothing when nothing was being done, and nothing when it was free', () => {
    const idle = openDesk(noDesks, { path, name: 'paper-street' });
    expect(currentDesk(receive(idle, { project: path, event: settledAt(140) }))?.jobs).toEqual([]);

    const free = receive(aDeskDoingSomething(), { project: path, event: settledAt(0) }, 2000);
    expect(currentDesk(free)?.jobs).toEqual([]);
    expect(currentDesk(free)?.doing).toBeNull();
  });

  it('keeps one project’s measurements out of another’s', () => {
    const other = '/Users/you/Sites/atlas-studio';
    let desks = openDesk(aDeskDoingSomething(), { path: other, name: 'atlas-studio' });
    desks = receive(desks, { project: path, event: settledAt(140) }, 2000);

    expect(desks.byPath[path]?.jobs).toHaveLength(1);
    expect(desks.byPath[other]?.jobs).toEqual([]);
  });
});

/* ========================================================================== */
/* F8 — a long conversation, tidied                                            */
/* ========================================================================== */

describe('F8 — tidying up, in our words and Pi’s machinery', () => {
  const tidying: AgentEvent = { type: 'tidying' };

  it('says one plain sentence, and it is the one from the cost copy', () => {
    const turns = applyEvent([], tidying);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.kind).toBe('tidying');
    // The sentence itself lives in phrasing.ts and is swept with the rest.
    expect(longConversation.tidying).toMatch(/covered a lot in here/);
    expect(longConversation.tidying).toMatch(/nothing gets lost/);
  });

  it('says it once, however many times the runtime announces itself', () => {
    let turns: readonly Turn[] = applyEvent([], tidying);
    turns = applyEvent(turns, tidying);
    turns = applyEvent(turns, tidying);
    expect(turns.filter((one) => one.kind === 'tidying')).toHaveLength(1);
  });

  it('finishes the line when the tidying finishes', () => {
    const turns = applyEvent(applyEvent([], tidying), { type: 'tidied', ok: true });
    expect(turns[0]).toMatchObject({ kind: 'tidying', state: 'done' });
  });

  it('does not dress a tidy that failed up as one that worked', () => {
    const turns = applyEvent(applyEvent([], tidying), { type: 'tidied', ok: false });
    expect(turns[0]).toMatchObject({ kind: 'tidying', state: 'failed' });
  });

  it('has nothing to close when nothing was open', () => {
    const before: readonly Turn[] = [said('graphe', 'Working in paper-street.')];
    expect(applyEvent(before, { type: 'tidied', ok: true })).toEqual(before);
  });

  it('can happen again later in the same conversation', () => {
    let turns: readonly Turn[] = applyEvent([], tidying);
    turns = applyEvent(turns, { type: 'tidied', ok: true });
    turns = applyEvent(turns, tidying);
    expect(turns.filter((one) => one.kind === 'tidying')).toHaveLength(2);
  });

  it('costs the thread nothing else — no message, no error, no money line', () => {
    const turns = applyEvent(applyEvent([], tidying), { type: 'tidied', ok: true });
    expect(turns.every((one) => one.kind === 'tidying')).toBe(true);
  });
});
