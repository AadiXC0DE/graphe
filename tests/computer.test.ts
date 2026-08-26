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
  browserTools,
  fillArgs,
  isHandle,
  pressArgs,
  readAnswer,
  scrollArgs,
  sessionFor,
  setupFrom,
  stepCommands,
  trimmed,
  type BrowserHost,
} from '../src/agent/pi/computer';
import type { Ran } from '../src/share/run';

const ROOT = '/Users/mira/Projects/portfolio';
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
function recorder(answers: readonly string[] = []): { host: BrowserHost; asked: string[][] } {
  const asked: string[][] = [];
  let at = 0;
  const host: BrowserHost = (tool, args) => {
    asked.push([tool, ...args]);
    if (args.includes('--version')) return Promise.resolve(ran({ out: '0.35.0' }));
    const next = answers[at] ?? '{"success":true,"data":{"snapshot":"heading \\"Hello\\""}}';
    at += 1;
    return Promise.resolve(ran({ out: next }));
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

  it('holds the browser to the sites somebody named, and only then', () => {
    expect(browserArgs(['open'], setupFrom({}, ROOT))).not.toContain('--allowed-domains');
    const held = browserArgs(
      ['open'],
      setupFrom({ GRAPHE_BROWSER_HOSTS: 'figma.com, *.railway.app' }, ROOT),
    );
    expect(held).toContain('--allowed-domains');
    expect(held).toContain('figma.com,*.railway.app');
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
  it('offers exactly the nine, named for what they do', () => {
    expect(browserTools(ROOT, recorder().host).map((one) => one.name).sort()).toEqual([
      'browser_click',
      'browser_close',
      'browser_open',
      'browser_picture',
      'browser_read',
      'browser_scroll',
      'browser_steps',
      'browser_trouble',
      'browser_type',
    ]);
  });

  it('opens a page and comes back with what is on it', async () => {
    const { host, asked } = recorder([
      '{"success":true,"data":{"url":"https://example.com"}}',
      '{"success":true,"data":{"snapshot":"heading \\"Example\\""}}',
    ]);
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

  it('refuses to type a key into a page', () => {
    const verdict = evaluate(
      call('browser_type', { target: '@e1', text: 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }),
      ctx,
    );
    expect(verdict.kind).toBe('deny');
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
