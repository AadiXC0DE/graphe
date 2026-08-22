/** The question that must never become a wait.
 *
 * Asking before starting is the one feature in Graphe whose failure mode is
 * silence: a run that parks on a form nobody is looking at does not crash, does
 * not warn, and does not finish. Everything it touches — background work, the
 * helpers, the queue, the eviction of an idle conversation, Stop — has to stay
 * exactly as it was, and the only proof of that is the join.
 *
 * So nothing here tests the wording or the tidying of a model's questions;
 * those are covered in asking.test.ts and asked-first.test.ts where they live.
 * Everything here fails when a join comes apart: the tool being built where
 * nobody is watching, a helper getting it, the gate staying open after work has
 * begun, a follow-up reopening it mid-run, a promise nobody resolves, a
 * conversation parked on a question being put down underneath somebody, or an
 * answer from one conversation landing in another.
 *
 * A closure inside `createSession` cannot be reached without a live account, so
 * where that is the case the join is asserted from the source the way
 * gate-wired.test.ts and settling-up.test.ts do. A wiring test that fails when
 * the join comes apart is worth more than nothing.
 */

import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { Asking, Confirmations, createGuardInterceptor } from '../src/agent/pi/adapter';
import { EventRelay } from '../src/agent/pi/events';
import { ROLES } from '../src/agent/pi/child';
import { grapheTools } from '../src/agent/pi/tools';
import { changesAnything } from '../src/agent/guard/policy';
import { readOnlyTools } from '../src/agent/plan';
import { askWords, cannotAsk, saysAnswers, tidyQuestions } from '../src/agent/asking';
import { applyEvent, askingYou, type Turn } from '../src/lib/thread';
import type { AgentEvent, ToolCall } from '../src/agent/types';
import type { GuardFacts } from '../src/agent/guard/policy';

const source = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const adapter = source('src/agent/pi/adapter.ts');
const tools = source('src/agent/pi/tools.ts');
const shell = source('electron/main.ts');
const helper = source('src/agent/pi/subagent-runner.ts');

const ROOT = '/Users/mira/Projects/portfolio';
const facts: GuardFacts = { projectRoot: ROOT };

const call = (name: string, input: Record<string, unknown> = {}): ToolCall => ({
  id: 'call-1',
  name,
  input,
});

const named = (list: readonly { name: string }[]): readonly string[] =>
  list.map((one) => one.name);

/** One question, already through the tidying, for the thread cases below. */
const QUESTIONS = tidyQuestions([
  {
    question: 'Which header should I keep?',
    header: 'Header',
    choices: [
      { label: 'The tall one', note: 'More room.' },
      { label: 'The compact one', note: 'Fits above the fold.' },
    ],
  },
]);

const fold = (events: readonly AgentEvent[]): readonly Turn[] =>
  events.reduce<readonly Turn[]>((turns, event) => applyEvent(turns, event), []);

/* ========================================================================== */
/* Nobody there to answer means no tool at all                                 */
/* ========================================================================== */

describe('the tool exists only where somebody is watching', () => {
  it('is not built when the session was never given a way to ask', () => {
    // The default. Every caller that does not hand one in — a test, a helper
    // process, anything holding tools without a window — gets no `ask_first`.
    expect(named(grapheTools('/tmp/agent'))).not.toContain('ask_first');
    expect(
      named(grapheTools('/tmp/agent', null, null, undefined, '/tmp/project', undefined, undefined, null)),
    ).not.toContain('ask_first');
  });

  it('is built when there is', () => {
    const built = grapheTools(
      '/tmp/agent',
      null,
      null,
      undefined,
      '/tmp/project',
      undefined,
      undefined,
      () => Promise.resolve('anything'),
    );
    expect(named(built)).toContain('ask_first');
  });

  it('is withheld from a run nobody is watching, by the session and not by the tool', () => {
    // The tool cannot see whether anybody is there, so the decision is made
    // once, at the seam, and the tool is simply absent for background work.
    expect(adapter).toContain('options.unattended === true ? null : askFirst,');
    expect(tools).toContain('if (askFirst !== undefined && askFirst !== null) tools.push(askFirstTool(askFirst));');
  });

  it('has the board hand background work that flag', () => {
    // A piece running on the board is the night-long run this feature must
    // never be able to park. Without this line it would be given the tool.
    expect(shell).toContain('unattended: true,');
    const at = shell.indexOf('unattended: true,');
    const started = shell.lastIndexOf('await createSession({', at);
    expect(started).toBeGreaterThan(-1);
    expect(at - started).toBeLessThan(600);
  });

  it('never reaches a helper, whatever role it was sent as', () => {
    for (const role of Object.values(ROLES)) {
      expect(role.tools, `${role.name} may run ask_first`).not.toContain('ask_first');
    }
    // Two locks, and the second is the one that matters: the child builds its
    // own list from two web tools and filters it through the role's names, so
    // a tool added to `grapheTools` cannot arrive in that process by accident.
    expect(helper).toContain('const helperTools = [websearchTool, webfetchTool];');
    expect(helper).toContain('tools: [...spec.tools],');
    expect(helper).toContain("customTools: helperTools.filter((tool) => spec.tools.includes(tool.name)),");
  });

  it('stops the turn on a person rather than running beside other calls', () => {
    // Parallel, a batch beside it would keep working against an answer that
    // has not arrived — which is the same as not having asked.
    const at = tools.indexOf("name: 'ask_first',");
    const mode = tools.indexOf("executionMode: 'sequential',", at);
    expect(at).toBeGreaterThan(-1);
    expect(mode).toBeGreaterThan(at);
    expect(mode - at).toBeLessThan(2500);
  });

  it('hands back whatever the session said, as ordinary text', async () => {
    const tool = grapheTools(
      '/tmp/agent',
      null,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      () => Promise.resolve(cannotAsk.started),
    ).find((one) => one.name === 'ask_first');
    expect(tool).toBeDefined();
    const result = await tool?.execute(
      'call-1',
      { questions: [] } as never,
      undefined,
      undefined,
      undefined as never,
    );
    expect(result?.content).toEqual([{ type: 'text', text: cannotAsk.started }]);
  });
});

/* ========================================================================== */
/* The Guard knows this tool, and reads it as a read                           */
/* ========================================================================== */

describe('asking is not itself a change', () => {
  it('never puts a permission question in front of the question', () => {
    // Unlisted, it fell to the deny-by-default floor and every ask would have
    // opened with "run an instruction I do not fully recognise?" about our own
    // tool — a second card in front of the first.
    const events: AgentEvent[] = [];
    const review = createGuardInterceptor({
      facts,
      relay: new EventRelay((event) => events.push(event)),
      confirmations: new Confirmations(),
    });
    return review(call('ask_first', { questions: [] })).then((outcome) => {
      expect(outcome).toBeUndefined();
      expect(events.map((one) => one.type)).toEqual(['tool-start']);
    });
  });

  it('does not close its own gate', () => {
    // The gate closes on the first *changing* call. If asking counted as one,
    // the tool would shut the door behind itself and a model that asked twice
    // would be told work had already begun when nothing had happened.
    expect(changesAnything(call('ask_first', { questions: [] }), facts)).toBe(false);
  });

  it('survives the look-around pass, which is where the plan is asked for', () => {
    // Planning withholds everything that is not read-only. `ask_first` has to
    // come through it, because the instructions for a plan tell the model to
    // use it before the list.
    expect(readOnlyTools(['ask_first'])).toEqual(['ask_first']);
    expect(adapter).toContain("if (planning?.() === true && readOnlyTools([call.name]).length === 0)");
  });
});

/* ========================================================================== */
/* The gate: one stop, at the top, or none                                     */
/* ========================================================================== */

describe('the gate closes the moment work begins', () => {
  it('is closed by the same call that makes every earlier check stale', () => {
    // Three lines, and all three matter: only a changing call closes it, it
    // happens on the way in rather than after, and the interceptor is the
    // thing that calls it.
    expect(adapter).toContain('const forgetChecks = (call: ToolCall): void => {');
    expect(adapter).toContain('if (!changesAnything(call, facts)) return;');
    expect(adapter).toContain("if (asksLeft === 'open') asksLeft = 'started';");
    expect(adapter).toContain('filesMayHaveMoved: forgetChecks,');

    // Before the verdict, not after: a call that is about to run has already
    // started as far as somebody who walked away is concerned.
    const body = adapter.slice(adapter.indexOf('return async function review(call: ToolCall)'));
    expect(body.indexOf('filesMayHaveMoved?.(call);')).toBeLessThan(body.indexOf('relay.started(call)'));
  });

  it('reads a call the way the gate needs it read', () => {
    // Looking around first is the ordinary opening of a big job and must not
    // count as starting; anything that touches the project must.
    for (const harmless of [
      call('read', { path: `${ROOT}/src/App.tsx` }),
      call('grep', { pattern: 'header', path: ROOT }),
      call('ls', { path: ROOT }),
      call('read_map', { path: ROOT }),
    ]) {
      expect(changesAnything(harmless, facts), `${harmless.name} closed the gate`).toBe(false);
    }
    for (const real of [
      call('write', { path: `${ROOT}/src/App.tsx`, content: 'x' }),
      call('edit', { path: `${ROOT}/src/App.tsx`, old: 'a', new: 'b' }),
      call('bash', { command: 'npm install left-pad' }),
    ]) {
      expect(changesAnything(real, facts), `${real.name} left the gate open`).toBe(true);
    }
  });

  it('is asked for exactly once, and the flag is set before the wait', () => {
    // Set after the await, a second call landing while the first was parked
    // would have found the gate open and put up a second card.
    const at = adapter.indexOf('const askFirst = async (raw: unknown): Promise<string> => {');
    expect(at).toBeGreaterThan(-1);
    const body = adapter.slice(at, adapter.indexOf('const customTools = grapheTools(', at));

    expect(body).toContain("if (asksLeft === 'started') return cannotAsk.started;");
    expect(body).toContain("if (asksLeft === 'asked') return cannotAsk.already;");
    expect(body.indexOf("asksLeft = 'asked';")).toBeGreaterThan(-1);
    // A batch where nothing survived the tidying is not an ask. It happens
    // before the flag, so a model that sends junk has not spent its one stop.
    expect(body.indexOf('if (questions.length === 0) return cannotAsk.nothingWorthAsking;'))
      .toBeLessThan(body.indexOf("asksLeft = 'asked';"));
    expect(body.indexOf("asksLeft = 'asked';")).toBeLessThan(body.indexOf('await asking.ask(id)'));
    // And the card is on screen before anything waits on it.
    expect(body.indexOf("say({ type: 'asked-first'")).toBeLessThan(body.indexOf('await asking.ask(id)'));
  });

  it('reopens for a new request and never for a message landing mid-run', () => {
    // A follow-up is somebody adding to work already going. Stopping that to
    // put a form up is the exact thing this feature must never do.
    expect(adapter).toContain('if (activePrompts === 0) asksLeft = \'open\';');
    const at = adapter.indexOf("if (activePrompts === 0) asksLeft = 'open';");
    expect(adapter.indexOf('activePrompts += 1;', at) - at).toBeLessThan(60);
    // Nothing else in the file may open it.
    const opens = adapter.split('\n').filter((line) => /asksLeft = 'open'/.test(line));
    expect(opens).toHaveLength(1);
  });

  it('never opens the gate again just because a turn ended', () => {
    // `settled` lets go of anything waiting, but it must not hand the next
    // tool call of the same turn a fresh question.
    const say = adapter.slice(adapter.indexOf('const say = (event: AgentEvent): void => {'));
    const ends = say.indexOf('sayWhatTheRulesHeld();');
    expect(ends).toBeGreaterThan(-1);
    expect(say.slice(0, ends)).not.toContain("asksLeft = 'open'");
  });
});

/* ========================================================================== */
/* Every sentence back to the model ends with "carry on"                       */
/* ========================================================================== */

describe('a moment it may not ask is never a reason to stop', () => {
  it('tells the model to decide and keep going, every time', () => {
    for (const [name, sentence] of Object.entries(cannotAsk)) {
      expect(sentence, `${name} does not tell it to carry on`).toMatch(/carry on/i);
      expect(sentence, `${name} does not ask it to say what it settled`).toMatch(/settled/i);
    }
    // The same for somebody who waved it through, which arrives by a different
    // path and would otherwise be the one silence left.
    expect(askWords.skipped).toMatch(/get on with it/i);
    expect(askWords.skipped).toMatch(/settled/i);
  });

  it('says something even when every answer was empty', () => {
    // An empty form read back as an empty string would be a tool result with
    // nothing in it, which is a model with nothing to go on.
    expect(saysAnswers(QUESTIONS, {})).toBe(cannotAsk.nothingWorthAsking);
    expect(saysAnswers([], {}).trim()).not.toBe('');
  });
});

/* ========================================================================== */
/* Nothing is ever left waiting                                                */
/* ========================================================================== */

describe('every question has an ending', () => {
  it('lets go of everything waiting, with a real answer rather than a hang', async () => {
    const asking = new Asking();
    const first = asking.ask('ask-1');
    const second = asking.ask('ask-2');
    expect(asking.pending).toEqual(['ask-1', 'ask-2']);

    expect(asking.abandonAll()).toEqual(['ask-1', 'ask-2']);
    expect(asking.pending).toEqual([]);
    // Null, not left hanging: a promise nobody resolves holds the agent loop
    // for the rest of the sitting, and the run reads as still working.
    expect(await first).toBeNull();
    expect(await second).toBeNull();
  });

  it('resolves the first question when a second arrives on the same id', async () => {
    const asking = new Asking();
    const first = asking.ask('ask-1');
    const second = asking.ask('ask-1');
    expect(await first).toBeNull();
    expect(asking.pending).toEqual(['ask-1']);
    asking.answer('ask-1', { 'Which header?': ['The tall one'] });
    expect(await second).toEqual({ 'Which header?': ['The tall one'] });
  });

  it('says no rather than throwing when the answer has nowhere to go', async () => {
    const asking = new Asking();
    expect(asking.answer('never-asked', null)).toBe(false);

    const waiting = asking.ask('ask-1');
    expect(asking.answer('ask-1', null)).toBe(true);
    await waiting;
    // Twice, and after it was let go: the window can answer a card that the
    // shell has already closed, and both have to be a quiet false.
    expect(asking.answer('ask-1', null)).toBe(false);
    asking.ask('ask-2');
    asking.abandonAll();
    expect(asking.answer('ask-2', null)).toBe(false);
  });

  it('treats "just decide for me" as an answer, not a failure', async () => {
    const asking = new Asking();
    const waiting = asking.ask('ask-1');
    expect(asking.answer('ask-1', null)).toBe(true);
    expect(await waiting).toBeNull();
    // And null is what the session turns into a plain instruction.
    expect(adapter).toContain('if (answers === null) {');
    expect(adapter).toContain('return askWords.skipped;');
  });

  it('is let go on settle, on stop, and on close', () => {
    // Three endings, and a question outliving any one of them is a form that
    // reads as "still working" for the rest of the sitting.
    const say = adapter.slice(adapter.indexOf('const say = (event: AgentEvent): void => {'));
    expect(say.slice(0, say.indexOf('sayWhatTheRulesHeld();'))).toContain(
      'const dropped = asking.abandonAll();',
    );

    const stop = adapter.slice(adapter.indexOf('async stop(): Promise<void> {'));
    expect(stop.slice(0, stop.indexOf('await session.abort()'))).toContain(
      'const letGo = asking.abandonAll();',
    );

    const dispose = adapter.slice(adapter.indexOf('dispose(): void {'));
    expect(dispose.slice(0, dispose.indexOf('session.dispose();'))).toContain('asking.abandonAll();');
  });

  it('says out loud that the card has been taken away', () => {
    // Only the window can close a card, so a question let go in the session
    // and not announced leaves a form on screen whose answer goes nowhere.
    expect(adapter).toContain("options.onEvent({ type: 'asking-withdrawn', ids: dropped });");
    expect(adapter).toContain("say({ type: 'asking-withdrawn', ids: letGo });");
  });
});

/* ========================================================================== */
/* The rest of Graphe carries on around it                                     */
/* ========================================================================== */

describe('a conversation parked on a question is not put down', () => {
  it('counts an open question as waiting on a person, both kinds', () => {
    const awaiting = adapter.slice(adapter.indexOf('get awaitingAnswer(): readonly string[] {'));
    expect(awaiting.slice(0, awaiting.indexOf('},'))).toContain(
      'return [...confirmations.pending, ...asking.pending];',
    );
  });

  it('has the shell refuse to evict one', () => {
    // The limit is a memory preference, not permission to answer for somebody.
    const at = shell.indexOf('function conversationsIn(project: string)');
    expect(at).toBeGreaterThan(-1);
    const body = shell.slice(at, shell.indexOf('\n}', at));
    expect(body).toContain('session.awaitingAnswer.length === 0');
    expect(body).toContain('mayEvict: (session) =>');
  });

  it('is what the pending list is actually made of', () => {
    // The getter is only as good as the thing it reads: a question asked and
    // not yet answered has to appear, and disappear the moment it is.
    const asking = new Asking();
    expect(asking.pending).toEqual([]);
    void asking.ask('ask-1');
    expect(asking.pending).toEqual(['ask-1']);
    asking.answer('ask-1', null);
    expect(asking.pending).toEqual([]);
  });
});

describe('the window knows it is waiting on somebody', () => {
  it('reads an open card as the conversation asking, not as one working', () => {
    const turns = fold([
      { type: 'user-said', text: 'redo the header' },
      { type: 'asked-first', id: 'ask-1', questions: QUESTIONS },
    ]);
    expect(askingYou(turns)).toBe(true);
    // Which is what the tab band reads to say a conversation wants somebody.
    expect(source('src/App.tsx')).toMatch(/askingYou\(turns\)[\s\S]{0,60}'asking'/);
  });

  it('stops asking the moment the card is closed, however it closed', () => {
    const asked: AgentEvent = { type: 'asked-first', id: 'ask-1', questions: QUESTIONS };
    expect(askingYou(fold([asked, { type: 'asking-withdrawn', ids: ['ask-1'] }]))).toBe(false);
    expect(askingYou(fold([asked, { type: 'settled' }]))).toBe(false);
    expect(askingYou(fold([asked, { type: 'error', message: 'the stream died' }]))).toBe(false);
  });

  it('never rewrites a card somebody already answered', () => {
    // The window closes the card itself when somebody presses, and the shell
    // says "withdrawn" a moment later for the same id. The second must not
    // overwrite the first, or every answer would read as taken away.
    const answered = fold([{ type: 'asked-first', id: 'ask-1', questions: QUESTIONS }]).map((turn) =>
      turn.kind === 'asked-first' ? { ...turn, answered: 'answered' as const } : turn,
    );
    const after = applyEvent(answered, { type: 'asking-withdrawn', ids: ['ask-1'] });
    const card = after.find((one) => one.kind === 'asked-first');
    expect(card?.kind === 'asked-first' ? card.answered : null).toBe('answered');

    const settled = applyEvent(answered, { type: 'settled' });
    const same = settled.find((one) => one.kind === 'asked-first');
    expect(same?.kind === 'asked-first' ? same.answered : null).toBe('answered');
  });

  it('is still busy while it waits, so a second thought joins the line', () => {
    // The card goes up behind a running tool call, and the composer works out
    // it is busy from that. Both have to be true or a message typed underneath
    // would go out as a fresh request and race the answer.
    const turns = fold([
      { type: 'tool-start', call: { id: 'call-1', name: 'ask_first', input: { questions: [] } } },
      { type: 'asked-first', id: 'ask-1', questions: QUESTIONS },
    ]);
    expect(turns.some((one) => one.kind === 'did' && one.state === 'running')).toBe(true);
    expect(askingYou(turns)).toBe(true);

    const app = source('src/App.tsx');
    expect(app).toMatch(/frontBusy \?[\s\S]{0,30}'followUp'/);
    expect(app).toMatch(/deliver\([\s\S]{0,60}queue: 'followUp'/);
  });
});

describe('two conversations at once', () => {
  it('cannot answer one from the other', () => {
    // Ids are counted per session, so both conversations reach `ask-1`. The
    // only thing keeping them apart is that each has its own set of questions.
    const one = new Asking();
    const other = new Asking();
    void one.ask('ask-1');
    void other.ask('ask-1');

    expect(one.answer('ask-1', { q: ['a'] })).toBe(true);
    expect(one.pending).toEqual([]);
    // Untouched: the other conversation is still waiting on its own person.
    expect(other.pending).toEqual(['ask-1']);
  });

  it('has the shell find the session before it answers anything', () => {
    const at = shell.indexOf('handle<boolean>(CHANNEL.answerAsked');
    expect(at).toBeGreaterThan(-1);
    const body = shell.slice(at, shell.indexOf('\n  });', at));
    // Project and conversation, in that order, and no session found is a
    // quiet false rather than an answer landing somewhere else.
    expect(body).toContain('const where = whereIn(args);');
    expect(body).toContain('if (open === null) return done(false);');
    // The check running in a copy is asked first. It draws its card into the
    // same thread and is not in the map of conversations, so answering the
    // conversation behind it left the run waiting forever.
    expect(body).toContain('open.held.checking?.answerAsked(id, picked) === true');
    expect(body).toContain('sessionAt(open, where)?.answerAsked(id, picked) ?? false');
    // A blank id never reaches a session at all.
    expect(body).toContain("if (typeof id !== 'string' || id === '') return done(false);");
  });

  it('names the ids per session in the session itself', () => {
    expect(adapter).toContain('const id = `ask-${String(++askedSoFar)}`;');
    expect(adapter).toContain('let askedSoFar = 0;');
  });
});

/* ========================================================================== */
/* What the window sends back                                                  */
/* ========================================================================== */

/**
 * `asAnswers` is private to the shell's handler and there is no export to reach
 * it by. Rather than reimplementing it — a copy passes while the original
 * rots — the real one is lifted out of `electron/main.ts` and run. The lift
 * fails loudly if it is renamed or moved, which is the point.
 */
function liftFromShell(opening: string): string {
  const at = shell.indexOf(opening);
  if (at === -1) throw new Error(`${opening} is no longer in electron/main.ts`);
  let depth = 0;
  for (let index = shell.indexOf('{', at); index < shell.length; index += 1) {
    const letter = shell[index];
    if (letter === '{') depth += 1;
    else if (letter === '}') {
      depth -= 1;
      if (depth === 0) return shell.slice(at, index + 1);
    }
  }
  throw new Error(`${opening} has no end`);
}

const asAnswers = ((): ((raw: unknown) => Record<string, readonly string[]> | null) => {
  const written = liftFromShell('const asAnswers = (raw: unknown)');
  const plain = ts.transpileModule(`${written};\nreturn asAnswers;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(plain)() as (raw: unknown) => Record<string, readonly string[]> | null;
})();

describe('answers arriving from a window that cannot be trusted', () => {
  it('takes an ordinary set of picks', () => {
    expect(asAnswers({ 'Which header?': ['The tall one'] })).toEqual({
      'Which header?': ['The tall one'],
    });
  });

  it('reads anything that is not a set of questions as no answer at all', () => {
    for (const rubbish of [null, undefined, 'answers', 42, true, [], [['q', ['a']]]]) {
      expect(asAnswers(rubbish), `${JSON.stringify(rubbish) ?? 'undefined'} got through`).toBeNull();
    }
  });

  it('drops anything that is not words against a question', () => {
    expect(
      asAnswers({
        '': ['dropped, no question'],
        '   ': ['dropped, still no question'],
        nested: { label: 'not an array' },
        notAnArray: 'a string',
        empties: ['', '   '],
        mixed: [1, null, { label: 'x' }, 'kept'],
      }),
    ).toEqual({ mixed: ['kept'] });
  });

  it('is not made enormous by somebody sending something enormous', () => {
    const answers = asAnswers({
      ['q'.repeat(5000)]: ['a'.repeat(5000)],
      many: Array.from({ length: 500 }, (_, at) => `pick ${String(at)}`),
    });
    expect(answers).not.toBeNull();
    const keys = Object.keys(answers ?? {});
    expect(keys.every((one) => one.length <= 400)).toBe(true);
    expect((answers?.[keys[0] ?? ''] ?? [])[0]?.length).toBe(400);
    expect(answers?.['many']).toHaveLength(8);
  });

  it('never throws, whatever it is handed', () => {
    const nasty: unknown[] = [
      JSON.parse('{"__proto__": ["polluted"]}'),
      JSON.parse('{"constructor": ["polluted"]}'),
      { toString: ['x'] },
      Object.create(null) as unknown,
      new Map([['q', ['a']]]),
      { q: Array.from({ length: 10_000 }, () => 'a'.repeat(1000)) },
      { q: [Symbol('a') as unknown] },
    ];
    for (const one of nasty) expect(() => asAnswers(one)).not.toThrow();
  });

  /** A key named `__proto__` is refused outright, and what is built has no
   *  prototype to reach through in the first place. Both, because the answers
   *  are read back by name: left alone it assigned through the setter, and the
   *  model would have read `length` and `map` off an array as though somebody
   *  had picked them. */
  it('files no answer against a key that is not one, and pollutes nothing', () => {
    const answers = asAnswers(JSON.parse('{"__proto__": ["polluted"], "real question": ["kept"]}'));
    expect(Object.keys(answers ?? {})).toEqual(['real question']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('0');
    expect(asAnswers(JSON.parse('{"__proto__": ["polluted"]}'))).toBeNull();
    // Nothing inherited: reading a name nobody answered finds nothing at all.
    expect(Object.getPrototypeOf(answers)).toBeNull();
    expect((answers as Record<string, unknown>)['map']).toBeUndefined();
  });

  it('reads a form nobody filled in as "decide for me" rather than as a failure', () => {
    // Null all the way down: an empty result is the same instruction as the
    // plain "just decide for me" button, and the run is told so rather than
    // being left waiting for something better.
    expect(asAnswers({})).toBeNull();
    expect(asAnswers({ q: [] })).toBeNull();
    const asking = new Asking();
    const waiting = asking.ask('ask-1');
    expect(asking.answer('ask-1', asAnswers({ q: [] }))).toBe(true);
    return expect(waiting).resolves.toBeNull();
  });
});

/* ========================================================================== */
/* Work checked in a copy                                                      */
/* ========================================================================== */

/**
 * The one place this could genuinely have hung.
 *
 * "See it first" does the work in a copy, through a session made inside
 * `checkItFirst`. That session is a local of the function and is in nobody's
 * set of conversations — but every event it produces is forwarded into the
 * person's own thread, so a card it puts up is drawn and looks answerable.
 *
 * The answer used to be looked up in the set of conversations, find a session
 * that had never heard of that id, and return false without saying anything.
 * Nothing resolved the promise, `prompt` never returned, the copy was never
 * given back, and Stop reached the wrong session. It is the exact failure the
 * whole feature is built to prevent, at the top of exactly the big jobs it is
 * built for.
 */
describe('work checked in a copy', () => {
  const inCopy = shell.slice(
    shell.indexOf('async function checkItFirst('),
    shell.indexOf('\n/**', shell.indexOf('async function checkItFirst(')),
  );

  it('is reachable while it runs, and let go however it ends', () => {
    expect(inCopy).toContain('held.checking = inside;');
    // Both endings clear it: one in the failure path, one after the prompt.
    expect(inCopy.match(/held\.checking = null;/g)?.length).toBe(2);
    const before = inCopy.indexOf('held.checking = inside;');
    expect(before).toBeLessThan(inCopy.indexOf('await inside.prompt('));
  });

  it('still sends its cards to the thread, which is why it has to be reachable', () => {
    expect(inCopy).toContain('onEvent: forwardHeld(open.path, held, from),');
    const relay = shell.slice(shell.indexOf('function forwardHeld('));
    expect(relay.slice(0, relay.indexOf('\n}'))).toContain(
      'send(path, said, from.address ?? undefined);',
    );
  });

  it('is asked before the conversation behind it, for both kinds of question', () => {
    for (const channel of ['CHANNEL.answerAsked', 'CHANNEL.answer']) {
      const at = shell.indexOf(`handle<boolean>(${channel}`);
      expect(at, channel).toBeGreaterThan(-1);
      const body = shell.slice(at, shell.indexOf('\n  });', at));
      expect(body, channel).toContain('open.held.checking?.');
    }
  });

  it('is what Stop stops', () => {
    const at = shell.indexOf('handle<null>(CHANNEL.stop,');
    const body = shell.slice(at, shell.indexOf('\n  });', at));
    expect(body).toContain('await open.held.checking?.stop();');
  });

  it('is emptied out with the rest of what a project holds', () => {
    expect(shell).toContain('checking: GrapheSession | null;');
    expect(shell).toContain('checking: null,');
  });
});
