/** The page beside the conversation, as the agent reaches it.
 *
 * Two failures are guarded here.
 *
 * The first is the Guard letting the agent press things on somebody's live site
 * without asking. A press there is not a file: no restore point puts back an
 * order that was placed or a message that was sent, so the question is the
 * whole of the protection, and every rung below "get on with it" has to keep
 * asking it. The rung that turns off file questions is the one that got this
 * wrong in every design we tried before this one.
 *
 * The second is the tools pretending. The pane is closed as often as it is
 * open, it can be empty, and on the board it belongs to a different copy of the
 * project than the one being worked in. Every one of those has to come back as
 * a plain sentence — never a throw, and never an answer about a page that is
 * not there.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { changesAnything, evaluate, type GuardFacts } from '../src/agent/guard/policy';
import { PAGE_WORDS, grapheTools, holdPage, pageTools } from '../src/agent/pi/tools';
import type { LivePage, PageAct, PageDone, PageReading, ToolCall, Verdict } from '../src/agent/types';

const ROOT = '/Users/mira/Projects/portfolio';
const ctx: GuardFacts = { projectRoot: ROOT };

function call(name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-1', name, input };
}

/** Every string a person could end up reading, from one verdict. */
function spoken(verdict: Verdict): string {
  if (verdict.kind === 'allow') return '';
  if (verdict.kind === 'deny') return verdict.reason;
  if (verdict.kind === 'snapshot-first') return verdict.reason;
  return [verdict.question, verdict.detail ?? '', verdict.consequence ?? ''].join(' ');
}

/* ========================================================================== */
/* BP-01 what the Guard says about each of them                                */
/* ========================================================================== */

describe('BP-01 reading the page is a read', () => {
  it('never asks about reading, scrolling, the messages or the picture', () => {
    for (const name of ['page_read', 'page_scroll', 'page_trouble', 'page_picture']) {
      expect(evaluate(call(name, {}), ctx).kind, name).toBe('allow');
    }
  });

  /* "Look and do not touch" has to leave looking alone, or the rung means
     nothing. A read that fell through to the unknown floor would be refused
     here along with everything else. */
  it('still reads the page when the agent has been told to look and not touch', () => {
    const looking: GuardFacts = { projectRoot: ROOT, howFar: 'looking' };
    expect(evaluate(call('page_read'), looking).kind).toBe('allow');
    expect(evaluate(call('page_scroll', { way: 'down' }), looking).kind).toBe('allow');
  });

  it('counts none of them as a change, so a standing "ask me first" stays quiet', () => {
    const strict: GuardFacts = { projectRoot: ROOT, askBeforeEveryChange: true };
    expect(changesAnything(call('page_read'), ctx)).toBe(false);
    expect(changesAnything(call('page_scroll'), ctx)).toBe(false);
    expect(evaluate(call('page_read'), strict).kind).toBe('allow');
  });
});

describe('BP-02 pressing and typing always ask', () => {
  it('asks before a press, and says what a press on a live page can do', () => {
    const verdict = evaluate(call('page_click', { target: 'Place order' }), ctx);
    expect(verdict.kind).toBe('confirm');
    if (verdict.kind !== 'confirm') return;
    // Named, not the unreadable-call question the deny-by-default floor gives
    // anything it does not recognise.
    expect(verdict.question).toContain('Press this on the page');
    expect(verdict.consequence).toContain('cannot take that back');
  });

  it('says out loud when typing will send the form, and when it will not', () => {
    const sending = evaluate(call('page_type', { target: 'Email', text: 'a@b.co', submit: true }), ctx);
    const quiet = evaluate(call('page_type', { target: 'Email', text: 'a@b.co' }), ctx);
    expect(sending.kind).toBe('confirm');
    expect(quiet.kind).toBe('confirm');
    if (sending.kind !== 'confirm' || quiet.kind !== 'confirm') return;
    expect(sending.question).toContain('send it');
    expect(quiet.detail).toContain('Nothing is sent');
    expect(quiet.question).not.toContain('send it');
  });

  it('counts a press and a typed word as changes', () => {
    expect(changesAnything(call('page_click', { target: 'Buy' }), ctx)).toBe(true);
    expect(changesAnything(call('page_type', { target: 'Email', text: 'hi' }), ctx)).toBe(true);
  });

  /* The rung that says "change files without asking" still stops before
     anything that reaches the internet. A press is how a page reaches it. */
  it('keeps asking on the rung that turns off the questions about files', () => {
    const changing: GuardFacts = { projectRoot: ROOT, howFar: 'changing' };
    expect(evaluate(call('write', { path: 'src/App.tsx', content: 'x' }), changing).kind).toBe('allow');
    expect(evaluate(call('page_click', { target: 'Place order' }), changing).kind).toBe('confirm');
    expect(evaluate(call('page_type', { target: 'Email', text: 'hi' }), changing).kind).toBe('confirm');
  });

  it('refuses a press outright when the agent has been told to look and not touch', () => {
    const looking: GuardFacts = { projectRoot: ROOT, howFar: 'looking' };
    const verdict = evaluate(call('page_click', { target: 'Delete account' }), looking);
    expect(verdict.kind).toBe('deny');
  });
});

describe('BP-03 a key is never typed into somebody else page', () => {
  /* A page keeps every word as it arrives and can send it anywhere. This is the
     one place a key leaves without a request that looks like one, so it is a
     refusal rather than a question somebody can wave through. */
  it('refuses, rather than asking, when the words carry a key', () => {
    const verdict = evaluate(
      call('page_type', { target: 'Search', text: 'sk-proj-abcdefghijklmnopqrstuvwxyz012345' }),
      ctx,
    );
    expect(verdict.kind).toBe('deny');
    if (verdict.kind !== 'deny') return;
    expect(verdict.reason).toContain('private key');
  });

  it('refuses a key the user told us about, whatever it looks like', () => {
    const facts: GuardFacts = { projectRoot: ROOT, knownSecretValues: ['hunter2-the-real-one'] };
    expect(evaluate(call('page_type', { target: 'Notes', text: 'hunter2-the-real-one' }), facts).kind).toBe(
      'deny',
    );
  });
});

describe('BP-04 what a person reads', () => {
  const asked = [
    call('page_click', { target: 'Place order' }),
    call('page_type', { target: 'Email', text: 'a@b.co', submit: true }),
    call('page_type', { target: 'Email', text: 'a@b.co' }),
    call('page_type', { target: 'Key', text: 'sk-proj-abcdefghijklmnopqrstuvwxyz012345' }),
  ];

  /** research/03: the words a designer has told us mean nothing to them. */
  const retired = ['terminal', 'shell', 'stdout', 'runtime', 'localhost', 'dependency', 'binary', 'null'];

  for (const one of asked) {
    const label = `${one.name} ${JSON.stringify(one.input).slice(0, 40)}`;

    it(`uses no retired jargon: ${label}`, () => {
      const words = spoken(evaluate(one, ctx)).toLowerCase();
      for (const word of retired) {
        expect(words, `"${word}" appeared in: ${words}`).not.toContain(word);
      }
    });

    it(`says something, and does not blame the person: ${label}`, () => {
      const words = spoken(evaluate(one, ctx));
      expect(words.trim().length).toBeGreaterThan(15);
      expect(words.toLowerCase()).not.toContain('invalid');
      expect(words.toLowerCase()).not.toContain('error');
      // Heavy em-dash use is a known machine-written tell (research/04).
      expect(words).not.toContain('—');
    });
  }
});

/* ========================================================================== */
/* BP-05 the tools, against a page that is not there                           */
/* ========================================================================== */

/** A page that answers whatever it is told to, and remembers what it was
 *  asked. Nothing here touches a real view. */
function fakePage(
  options: {
    project?: string | null;
    address?: string;
    reading?: PageReading | null;
    done?: PageDone;
  } = {},
): { page: LivePage; acted: PageAct[] } {
  const acted: PageAct[] = [];
  const reading: PageReading = options.reading ?? {
    address: options.address ?? 'http://127.0.0.1:5173/',
    title: 'Home',
    outline: '- heading "Welcome" [ref=e1]\n- link "Pricing" [ref=e2]',
  };
  return {
    acted,
    page: {
      open: () => ({
        project: options.project === undefined ? ROOT : options.project,
        address: options.address ?? 'http://127.0.0.1:5173/',
      }),
      read: () => Promise.resolve(options.reading === undefined ? reading : options.reading),
      act: (what) => {
        acted.push(what);
        return Promise.resolve(
          options.done ?? { ok: true as const, did: 'Pressed link "Pricing".', now: reading },
        );
      },
      trouble: () => Promise.resolve({ said: [], unanswered: [] }),
      picture: () => Promise.resolve({ mimeType: 'image/jpeg', bytes: 'AAAA' }),
    },
  };
}

type Answer = { content: readonly { type: string; text?: string; data?: string }[] };

async function run(name: string, params: Record<string, unknown> = {}, cwd = ROOT): Promise<Answer> {
  const tool = pageTools(cwd).find((one) => one.name === name);
  expect(tool, name).toBeDefined();
  const execute = tool?.execute as unknown as (
    id: string,
    input: Record<string, unknown>,
  ) => Promise<Answer>;
  return execute('call-1', params);
}

async function words(name: string, params: Record<string, unknown> = {}, cwd = ROOT): Promise<string> {
  const answer = await run(name, params, cwd);
  return answer.content[0]?.text ?? '';
}

afterEach(() => {
  holdPage(null);
});

describe('BP-05 no page open', () => {
  it('says so plainly, and never throws, for every one of them', async () => {
    holdPage(null);
    for (const name of ['page_read', 'page_click', 'page_type', 'page_scroll', 'page_trouble', 'page_picture']) {
      const said = await words(name, { target: 'Pricing', text: 'hi' });
      expect(said, name).toBe(PAGE_WORDS.closed);
    }
  });

  it('says a page with nothing loaded in it is a page with nothing to read', async () => {
    holdPage(fakePage({ address: '' }).page);
    expect(await words('page_read')).toBe(PAGE_WORDS.blank);
    expect(await words('page_click', { target: 'Pricing' })).toBe(PAGE_WORDS.blank);
  });

  it('treats a page sitting on nothing at all the same way', async () => {
    holdPage(fakePage({ address: 'about:blank' }).page);
    expect(await words('page_read')).toBe(PAGE_WORDS.blank);
  });
});

describe('BP-06 a page that belongs to other work', () => {
  /* Every piece of work on the board runs in a copy of its own, while the page
     belongs to the folder somebody is looking at. Pressing things there is
     meddling with a page about somebody else work. */
  it('leaves it alone rather than pressing something in it', async () => {
    const { page, acted } = fakePage({ project: '/Users/mira/Projects/portfolio-copy-2' });
    holdPage(page);
    const said = await words('page_click', { target: 'Place order' });
    expect(said).toContain('different copy of the project');
    expect(acted).toEqual([]);
  });

  it('still reads it, and says whose page it is before anything else', async () => {
    holdPage(fakePage({ project: '/Users/mira/Projects/portfolio-copy-2' }).page);
    const said = await words('page_read');
    expect(said).toContain('different copy of the project');
    expect(said).toContain('Pricing');
  });

  it('says nothing about copies when the page is the project being worked in', async () => {
    holdPage(fakePage({ project: ROOT }).page);
    expect(await words('page_read')).not.toContain('different copy');
  });
});

/* ========================================================================== */
/* BP-07 what the tools do with an answer                                      */
/* ========================================================================== */

describe('BP-07 the answers', () => {
  it('sends a press through as a press, and says what the page looks like after', async () => {
    const { page, acted } = fakePage();
    holdPage(page);
    const said = await words('page_click', { target: '  Pricing  ' });
    expect(acted).toEqual([{ kind: 'press', target: 'Pricing' }]);
    expect(said).toContain('Pressed link "Pricing".');
    expect(said).toContain('http://127.0.0.1:5173/');
    expect(said).toContain('- link "Pricing" [ref=e2]');
  });

  it('never sends the form unless it was asked to', async () => {
    const { page, acted } = fakePage();
    holdPage(page);
    await words('page_type', { target: 'Email', text: 'mira@example.com' });
    await words('page_type', { target: 'Email', text: 'mira@example.com', submit: true });
    expect(acted).toEqual([
      { kind: 'write', target: 'Email', text: 'mira@example.com', submit: false },
      { kind: 'write', target: 'Email', text: 'mira@example.com', submit: true },
    ]);
  });

  it('turns a way it cannot read into down, rather than passing it on', async () => {
    const { page, acted } = fakePage();
    holdPage(page);
    await words('page_scroll', { way: 'sideways' });
    await words('page_scroll', { way: 'TOP' });
    await words('page_scroll', { target: 'Pricing', way: 'up' });
    expect(acted).toEqual([
      { kind: 'move', target: null, way: 'down' },
      { kind: 'move', target: null, way: 'top' },
      { kind: 'move', target: 'Pricing', way: 'up' },
    ]);
  });

  /* A thing that is not on the page is something to aim at better, not a step
     that failed. A thrown execute is what marks one failed in the feed. */
  it('hands back a refusal from the page as words', async () => {
    holdPage(
      fakePage({ done: { ok: false, because: 'Nothing on the page reads like "Buy now".' } }).page,
    );
    expect(await words('page_click', { target: 'Buy now' })).toBe(
      'Nothing on the page reads like "Buy now".',
    );
  });

  it('hands the picture back as a picture', async () => {
    holdPage(fakePage().page);
    const answer = await run('page_picture');
    expect(answer.content[0]?.type).toBe('image');
    expect(answer.content[0]?.data).toBe('AAAA');
  });

  it('says plainly when the page has not complained about anything', async () => {
    holdPage(fakePage().page);
    expect(await words('page_trouble')).toContain('has printed no messages');
  });

  it('says both halves when it has', async () => {
    const { page } = fakePage();
    holdPage({
      ...page,
      trouble: () =>
        Promise.resolve({
          said: ['a problem: Cannot read properties of undefined'],
          unanswered: ['404 — GET http://127.0.0.1:5173/logo.svg'],
        }),
    });
    const said = await words('page_trouble');
    expect(said).toContain('Cannot read properties of undefined');
    expect(said).toContain('logo.svg');
  });

  /* Everything a reading holds is paid for again in every later turn that
     carries it, so a page with ten thousand things on it comes back short. */
  it('cuts a very long reading down and says it did', async () => {
    const outline = Array.from({ length: 900 }, (_, at) => `- text "row ${String(at)}"`).join('\n');
    holdPage(fakePage({ reading: { address: 'http://127.0.0.1:5173/', title: 'Long', outline } }).page);
    const said = await words('page_read');
    expect(said).toContain('row 399');
    expect(said).not.toContain('row 400');
    expect(said).toContain('500 more');
  });
});

/* ========================================================================== */
/* BP-08 on the list the model is actually handed                              */
/* ========================================================================== */

describe('BP-08 the tools reach the model', () => {
  /* A tool nobody passes at the call site is a tool that does not exist, and a
     unit test on the tool itself cannot see that. */
  it('are on the list once a shell has said there is a page', () => {
    holdPage(fakePage().page);
    const names = grapheTools('/tmp/agent', null, null, undefined, ROOT).map((one) => one.name);
    for (const name of ['page_read', 'page_click', 'page_type', 'page_scroll', 'page_trouble', 'page_picture']) {
      expect(names, name).toContain(name);
    }
  });

  /* A helper runs in a process of its own with no window in it. There is no
     page there to work on, so there is no tool for it either. */
  it('are absent where there is no page at all', () => {
    holdPage(null);
    const names = grapheTools('/tmp/agent', null, null, undefined, ROOT).map((one) => one.name);
    expect(names).not.toContain('page_read');
    expect(names).not.toContain('page_click');
  });

  /* One page, one hand. Two presses at once on the same page is not two things
     happening, it is one of them landing somewhere nobody meant. */
  it('never run alongside anything else', () => {
    for (const tool of pageTools(ROOT)) {
      expect(tool.executionMode, tool.name).toBe('sequential');
    }
  });
});
