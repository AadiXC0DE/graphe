/** A browser of its own.
 *
 * The page beside the conversation only ever shows the project. This is the
 * other browser — any address, kept warm between calls, driven by a program on
 * the machine. Two things are worth pinning: the words that go out to that
 * program, because a page's own text ends up in them, and the Guard's opinion
 * of every tool here, because a name it has never heard falls through to the
 * unknown-tool question and nobody decided that.
 */

import { describe, expect, it } from 'vitest';

import type { ToolCall, Verdict } from '../src/agent/types';
import { changesAnything, evaluate, type GuardFacts } from '../src/agent/guard/policy';
import {
  BROWSER_WORDS,
  MOST_BROWSER_LINES,
  browserArgs,
  browserFolder,
  browserTools,
  keepingLogins,
  fillArgs,
  isHandle,
  pressArgs,
  readAnswer,
  saysList,
  saysRequests,
  saysTrouble,
  onTheWeb,
  scrollArgs,
  sessionFor,
  setupFrom,
  stepCommands,
  trimmed,
  type BrowserHost,
} from '../src/agent/pi/computer';
import type { Ran } from '../src/share/run';

const ROOT = '/Users/mira/Projects/portfolio';
/** The words a command can start with, so a fake can tell the command from the
 *  options in front of it. */
const SAYS = ['open', 'snapshot', 'click', 'fill', 'find', 'scroll', 'scrollintoview', 'press', 'screenshot', 'console', 'errors', 'network', 'batch', 'close'];
const ctx: GuardFacts = { projectRoot: ROOT };

function call(name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-1', name, input };
}
function kindOf(one: ToolCall): Verdict['kind'] {
  return evaluate(one, ctx).kind;
}
function ran(over: Partial<Ran> = {}): Ran {
  const out = over.out ?? '';
  return { code: 0, out, errors: '', said: out, ...over };
}

/** A program that is always there and always answers well, remembering what it
 *  was asked. */
function recorder(over: Readonly<Record<string, string>> = {}): {
  host: BrowserHost;
  asked: string[][];
} {
  const asked: string[][] = [];
  const host: BrowserHost = (tool, args) => {
    asked.push([tool, ...args]);
    if (args.includes('--version')) return Promise.resolve(ran({ out: '0.35.0' }));
    const rest = [...args];
    while (rest.length > 0 && !SAYS.includes(rest[0] ?? '')) rest.shift();
    const command = rest.join(' ');
    for (const [what, said] of Object.entries(over)) {
      if (command.startsWith(what)) return Promise.resolve(ran({ out: said }));
    }
    if (command.startsWith('snapshot')) {
      return Promise.resolve(ran({ out: '{"success":true,"data":{"snapshot":"heading \\"Example\\""}}' }));
    }
    return Promise.resolve(ran({ out: '{"success":true,"data":{}}' }));
  };
  return { host, asked };
}

describe('the words that go out to the program', () => {
  it('holds every call to one browser per project', () => {
    expect(sessionFor(ROOT)).toBe(sessionFor(ROOT));
    expect(sessionFor(ROOT)).not.toBe(sessionFor('/Users/mira/Projects/other'));
    expect(sessionFor(ROOT).startsWith('graphe-')).toBe(true);
    expect(sessionFor(undefined)).toBe('graphe');
  });

  it('asks for a bounded, wrapped, machine-readable answer every time', () => {
    const args = browserArgs(['snapshot'], setupFrom({}, ROOT));
    expect(args).toContain('--json');
    expect(args).toContain('--max-output');
    expect(args).toContain('--content-boundaries');
    expect(args[args.length - 1]).toBe('snapshot');
  });

  it('cuts what one call may hand back, so a page cannot fill the conversation', () => {
    const args = browserArgs(['snapshot'], setupFrom({}, ROOT));
    expect(args[args.indexOf('--max-output') + 1]).toBe('20000');
  });

  it('takes each site once, however many times it is named', () => {
    const held = setupFrom({ GRAPHE_BROWSER_HOSTS: 'Figma.com, figma.com  figma.com,,' }, ROOT);
    expect(held.hosts).toEqual(['figma.com']);
    expect(setupFrom({ GRAPHE_BROWSER_HOSTS: '   ' }, ROOT).hosts).toEqual([]);
  });

  it('holds the browser to the sites somebody named, and only then', () => {
    expect(browserArgs(['open'], setupFrom({}, ROOT))).not.toContain('--allowed-domains');
    const held = browserArgs(
      ['open'],
      setupFrom({ GRAPHE_BROWSER_HOSTS: 'figma.com, *.railway.app' }, ROOT),
    );
    expect(held).toContain('--allowed-domains');
    expect(held).toContain('figma.com,*.railway.app');
  });

  it('keeps what a project is signed in to, in a folder of its own', () => {
    const kept = browserFolder('/data/agent', ROOT);
    expect(kept).toContain('browsers');
    expect(kept).toContain(sessionFor(ROOT));
    expect(browserFolder('/data/agent', '/other')).not.toBe(kept);
    const args = browserArgs(['open'], setupFrom({}, ROOT, kept));
    expect(args).toContain('--profile');
    expect(args).toContain(kept);
    expect(args).toContain('--restore');
  });

  it('starts clean unless somebody said otherwise', () => {
    expect(browserArgs(['open'], setupFrom({}, ROOT))).not.toContain('--profile');
  });

  /** A browser held to a few sites has to start with nothing set up in it, so
   *  the two cannot both be had. The containment wins and the answer says so. */
  it('will not both hold the browser to a few sites and keep its logins', () => {
    const both = setupFrom({ GRAPHE_BROWSER_HOSTS: 'figma.com' }, ROOT, '/data/agent/browsers/x');
    expect(keepingLogins(both).keeps).toBeNull();
    expect(keepingLogins(both).because).toBe(BROWSER_WORDS.notBoth);
    const args = browserArgs(['open'], both);
    expect(args).not.toContain('--profile');
    expect(args).toContain('--allowed-domains');
  });

  it('shows the window only when somebody asked to watch', () => {
    expect(browserArgs(['open'], setupFrom({}, ROOT))).not.toContain('--headed');
    expect(browserArgs(['open'], setupFrom({ GRAPHE_BROWSER_WATCH: 'on' }, ROOT))).toContain(
      '--headed',
    );
  });

  it('puts its own options in front of the command, never after the page’s words', () => {
    const args = browserArgs(['find', 'text', '--json is not an option here', 'click'], setupFrom({}, ROOT));
    expect(args.indexOf('--json')).toBeLessThan(args.indexOf('find'));
  });
});

describe('aiming at something on a page', () => {
  it('takes a handle from the last reading exactly', () => {
    expect(isHandle('@e12')).toBe(true);
    expect(isHandle('#submit')).toBe(true);
    expect(isHandle('Buy now')).toBe(false);
    expect(pressArgs('@e12')).toEqual(['click', '@e12']);
    expect(fillArgs('#email', 'a@b.c')).toEqual(['fill', '#email', 'a@b.c']);
  });

  it('falls back to the words on screen when there is no handle', () => {
    expect(pressArgs('Sign in')).toEqual(['find', 'text', 'Sign in', 'click']);
    expect(fillArgs('Email', 'a@b.c')).toEqual(['find', 'label', 'Email', 'fill', 'a@b.c']);
  });

  it('reads any unreadable direction as down, which is what was meant', () => {
    expect(scrollArgs(null, 'sideways')).toEqual(['scroll', 'down']);
    expect(scrollArgs(null, 'up')).toEqual(['scroll', 'up']);
    expect(scrollArgs('@e3', 'up')).toEqual(['scrollintoview', '@e3']);
  });
});

describe('reading what the program said', () => {
  it('takes the readable part of a good answer', () => {
    const answer = readAnswer(ran({ out: '{"success":true,"data":{"snapshot":"heading \\"Hi\\""}}' }));
    expect(answer.ok).toBe(true);
    expect(answer.text).toContain('heading');
  });

  it('carries the program’s own reason for a refusal, because it is the answer', () => {
    const answer = readAnswer(
      ran({ code: 1, out: '{"success":false,"error":"a banner covers @e1"}' }),
    );
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain('banner');
  });

  it('treats a line it cannot read as words rather than as nothing', () => {
    const answer = readAnswer(ran({ code: 1, out: '', errors: 'no browser found', said: 'no browser found' }));
    expect(answer.ok).toBe(false);
    expect(answer.text).toBe('no browser found');
  });

  it('cuts a very long page and says how much it cut', () => {
    const long = Array.from({ length: MOST_BROWSER_LINES + 40 }, (_, at) => `line ${String(at)}`).join('\n');
    const cut = trimmed(long);
    expect(cut.split('\n').length).toBe(MOST_BROWSER_LINES + 1);
    expect(cut).toContain('40 more');
  });
});

describe('what the page complained about', () => {
  it('keeps the requests that did not come back well, and no others', () => {
    const lines = saysRequests({
      requests: [
        { method: 'GET', url: 'https://x.com/a', status: 200 },
        { method: 'GET', url: 'https://x.com/b.css', status: 404 },
        { method: 'POST', url: 'https://x.com/api', status: 500 },
        { method: 'GET', url: 'https://x.com/c', status: 0 },
        { method: 'GET', url: 'https://x.com/d', status: 302 },
      ],
    });
    expect(lines).toEqual([
      'GET https://x.com/b.css — 404',
      'POST https://x.com/api — 500',
      'GET https://x.com/c — never came back',
    ]);
    expect(saysRequests(null)).toEqual([]);
    expect(saysRequests({ requests: 'nonsense' })).toEqual([]);
  });

  it('says how much is wrong in one line, or says nothing', () => {
    expect(saysTrouble({ printed: 0, threw: 0, failed: 0 })).toBeNull();
    expect(saysTrouble({ printed: 4, threw: 0, failed: 0 })).toBe('4 messages');
    expect(saysTrouble({ printed: 4, threw: 1, failed: 0 })).toBe('1 error');
    expect(saysTrouble({ printed: 0, threw: 2, failed: 3 })).toBe('2 errors, 3 requests failed');
    expect(saysTrouble({ printed: 0, threw: 0, failed: 1 })).toBe('1 request failed');
  });
});

describe('a run of steps', () => {
  it('turns plain words into the program’s own list', () => {
    expect(
      stepCommands([
        { do: 'open', url: 'https://example.com' },
        { do: 'click', target: '@e2' },
        { do: 'type', target: '@e3', text: 'hello', submit: true },
        { do: 'read' },
      ]),
    ).toEqual([
      ['open', 'https://example.com'],
      ['click', '@e2'],
      ['fill', '@e3', 'hello'],
      ['press', 'Enter'],
      ['snapshot', '-c', '-u'],
    ]);
  });

  it('leaves out a step that names nothing it could do', () => {
    expect(stepCommands([{ do: 'sing' }, { do: 'click' }])).toEqual([]);
  });
});

describe('what the tools do', () => {
  it('offers exactly the ten, named for what they do', () => {
    expect(browserTools(ROOT, recorder().host).map((one) => one.name).sort()).toEqual([
      'browser_click',
      'browser_close',
      'browser_open',
      'browser_picture',
      'browser_read',
      'browser_scroll',
      'browser_steps',
      'browser_trace',
      'browser_trouble',
      'browser_type',
    ]);
  });

  it('opens a page and comes back with what is on it', async () => {
    const { host, asked } = recorder();
    const tools = browserTools(ROOT, host);
    const open = tools.find((one) => one.name === 'browser_open');
    const result = await open?.execute(
      'call-1',
      { url: 'https://example.com' },
      undefined,
      undefined,
      undefined as never,
    );
    const said = result?.content[0];
    expect(said?.type === 'text' ? said.text : '').toContain('Example');
    expect(asked.some((one) => one.includes('open'))).toBe(true);
    expect(asked.some((one) => one.includes('snapshot'))).toBe(true);
  });

  /** The list a page keeps of what it threw cannot be cleared, so a page that
   *  loads cleanly after a broken one reported the broken one's errors. */
  it('starts each page with a clean sheet', async () => {
    const { host, asked } = recorder({
      errors: '{"success":true,"data":{"errors":[{"text":"an old one"}]}}',
    });
    const tools = browserTools(ROOT, host);
    const open = tools.find((one) => one.name === 'browser_open');
    const result = await open?.execute(
      'call-1',
      { url: 'https://example.com' },
      undefined,
      undefined,
      undefined as never,
    );
    const flat = asked.map((one) => one.join(' '));
    expect(flat.some((one) => one.includes('console --clear'))).toBe(true);
    expect(flat.some((one) => one.includes('network requests --clear'))).toBe(true);
    const said = result?.content[0];
    expect(said?.type === 'text' ? said.text : '').not.toContain('an old one');
    expect(result?.details).toEqual({});
  });

  it('reads a list out of an answer, and nothing out of nonsense', () => {
    expect(saysList({ messages: [{ type: 'log', text: 'hi' }, 'plain'] }, 'messages')).toEqual([
      'log: hi',
      'plain',
    ]);
    expect(saysList(null, 'messages')).toEqual([]);
    expect(saysList({ messages: 3 }, 'messages')).toEqual([]);
  });

  it('says the program is missing rather than failing obscurely', async () => {
    const missing: BrowserHost = () => Promise.resolve(ran({ code: 127, out: '', said: '' }));
    const tools = browserTools(ROOT, missing);
    const read = tools.find((one) => one.name === 'browser_read');
    const result = await read?.execute('call-1', {}, undefined, undefined, undefined as never);
    const said = result?.content[0];
    expect(said?.type === 'text' ? said.text : '').toBe(BROWSER_WORDS.noProgram);
  });

  it('fetches a browser once rather than setting homework, and says it did', async () => {
    const tries: string[][] = [];
    let first = true;
    const host: BrowserHost = (tool, args) => {
      tries.push([tool, ...args]);
      if (args.includes('--version')) return Promise.resolve(ran({ out: '0.35.0' }));
      if (args.includes('install')) return Promise.resolve(ran({ out: 'done' }));
      if (args.includes('open') && first) {
        first = false;
        return Promise.resolve(
          ran({ code: 1, out: '{"success":false,"error":"Chrome not found — run agent-browser install"}' }),
        );
      }
      return Promise.resolve(ran({ out: '{"success":true,"data":{"snapshot":"heading \\"Hi\\""}}' }));
    };
    const tools = browserTools(ROOT, host);
    const open = tools.find((one) => one.name === 'browser_open');
    const result = await open?.execute(
      'call-1',
      { url: 'https://example.com' },
      undefined,
      undefined,
      undefined as never,
    );
    const said = result?.content[0];
    expect(tries.some((one) => one.includes('install'))).toBe(true);
    expect(said?.type === 'text' ? said.text : '').toContain(BROWSER_WORDS.fetched);
  });

  it('says all of it in plain words', () => {
    for (const said of Object.values(BROWSER_WORDS)) {
      if (typeof said !== 'string') continue;
      expect(said).not.toMatch(/\b(CDP|DOM|selector|daemon|stdout|headless|Chromium)\b/);
    }
  });
});

describe('what counts as a page to open', () => {
  it('is the web, and only the web', () => {
    const good = [
      'https://figma.com',
      'http://localhost:3000',
      'example.com/a',
      'HTTPS://X.COM',
      // A name and a port reads like a scheme and is neither.
      'localhost:3000',
      'localhost:3000/app',
    ];
    for (const one of good) expect(onTheWeb(one), one).toBe(true);
    const bad = [
      'file:///etc/passwd',
      'data:text/html,<b>hi',
      'javascript:alert(1)',
      'mailto:someone@example.com',
      'ftp://x',
      // A place on this computer, however it is spelled.
      '/etc/passwd',
      '../secret',
      '~/.ssh/id_rsa',
      'C:\\Users',
      '',
    ];
    for (const one of bad) expect(onTheWeb(one), one).toBe(false);
  });

  it('will not open one inside a run of steps either', async () => {
    const { host, asked } = recorder();
    const steps = browserTools(ROOT, host).find((one) => one.name === 'browser_steps');
    const result = await steps?.execute(
      'call-1',
      { steps: [{ do: 'read' }, { do: 'open', url: '/etc/passwd' }] },
      undefined,
      undefined,
      undefined as never,
    );
    const said = result?.content[0];
    expect(said?.type === 'text' ? said.text : '').toBe(BROWSER_WORDS.notTheWeb);
    expect(asked.some((one) => one.includes('batch'))).toBe(false);
  });

  it('says so rather than opening it', async () => {
    const { host, asked } = recorder();
    const open = browserTools(ROOT, host).find((one) => one.name === 'browser_open');
    const result = await open?.execute(
      'call-1',
      { url: 'file:///etc/passwd' },
      undefined,
      undefined,
      undefined as never,
    );
    const said = result?.content[0];
    expect(said?.type === 'text' ? said.text : '').toBe(BROWSER_WORDS.notTheWeb);
    expect(asked.some((one) => one.includes('open'))).toBe(false);
  });
});

describe('the Guard has an opinion about every one of them', () => {
  it('leaves no tool for it to guess about', () => {
    for (const tool of browserTools(ROOT, recorder().host)) {
      expect(kindOf(call(tool.name, { url: 'https://example.com', target: '@e1', text: 'x' }))).not.toBe(
        'deny',
      );
      // Nothing here may fall through to the unknown-tool question by accident:
      // every name is either allowed outright or has a question written for it.
      const verdict = evaluate(call(tool.name, { url: 'https://example.com', target: '@e1' }), ctx);
      if (verdict.kind === 'confirm') {
        expect(verdict.question).not.toContain('do not fully recognise');
      }
    }
  });

  it('lets it look without asking', () => {
    for (const name of ['browser_read', 'browser_picture', 'browser_trouble', 'browser_scroll', 'browser_close']) {
      expect(kindOf(call(name))).toBe('allow');
      expect(changesAnything(call(name), ctx)).toBe(false);
    }
  });

  it('asks before pointing it at a site, and names the site', () => {
    const verdict = evaluate(call('browser_open', { url: 'https://figma.com/file/abc' }), ctx);
    expect(verdict.kind).toBe('confirm');
    expect(verdict.kind === 'confirm' ? verdict.question : '').toContain('figma.com');
  });

  it('asks before pressing and before typing', () => {
    expect(kindOf(call('browser_click', { target: '@e1' }))).toBe('confirm');
    expect(kindOf(call('browser_type', { target: '@e1', text: 'hello' }))).toBe('confirm');
  });

  /** The rung is about being asked, not about a key leaving the machine. */
  it('keeps refusing a key even when questions are off altogether', () => {
    const key = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const wide: GuardFacts = { projectRoot: ROOT, howFar: 'doing', stopAsking: true };
    expect(evaluate(call('browser_type', { target: '@e1', text: key }), wide).kind).toBe('deny');
    expect(evaluate(call('browser_open', { url: `https://x.com/?k=${key}` }), wide).kind).toBe('deny');
    expect(
      evaluate(call('desktop_do', { steps: [{ do: 'type', text: key }] }), wide).kind,
    ).toBe('deny');
    // Everything that is only about scope still gets on with it on that rung.
    expect(evaluate(call('browser_click', { target: '@e1' }), wide).kind).toBe('allow');
  });

  it('refuses a key aimed at, as well as one typed', () => {
    const key = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(kindOf(call('browser_type', { target: key, text: 'hello' }))).toBe('deny');
  });

  it('refuses to type a key into a page', () => {
    const verdict = evaluate(
      call('browser_type', { target: '@e1', text: 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }),
      ctx,
    );
    expect(verdict.kind).toBe('deny');
  });

  it('refuses to open anything that is not a page on the web', () => {
    for (const bad of ['file:///etc/passwd', 'data:text/html,<b>hi', 'javascript:alert(1)']) {
      expect(kindOf(call('browser_open', { url: bad })), bad).toBe('deny');
      expect(kindOf(call('browser_steps', { steps: [{ do: 'open', url: bad }] })), bad).toBe('deny');
    }
  });

  it('judges a run of steps as the strictest step in it', () => {
    expect(kindOf(call('browser_steps', { steps: [{ do: 'read' }, { do: 'scroll' }] }))).toBe('allow');
    expect(
      kindOf(call('browser_steps', { steps: [{ do: 'read' }, { do: 'click', target: '@e1' }] })),
    ).toBe('confirm');
    expect(
      evaluate(
        call('browser_steps', {
          steps: [{ do: 'type', target: '@e1', text: 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
        }),
        ctx,
      ).kind,
    ).toBe('deny');
  });
});
