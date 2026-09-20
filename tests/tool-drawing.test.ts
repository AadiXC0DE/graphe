// @vitest-environment jsdom
/** A tool an add-on draws itself, headless, and what the window does with it.
 *
 * Pi lets a tool bring `renderCall` / `renderResult`, and those return a pi-tui
 * `Component` whose whole contract is `render(width: number): string[]`. There
 * is no terminal here, so what this file settles is the seam: the add-on's own
 * drawing is called at eighty columns, the colour a terminal add-on writes is
 * taken out, and a renderer that falls over leaves the caller with nothing
 * rather than an error — the step happened, whatever the drawing did.
 *
 * The last part is the one that matters to a person: the lines the add-on wrote
 * are the lines on screen, drawn through `Drawn` inside a conversation row.
 * Asserting the function returned an array would pass with nothing wired to it.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';

import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  DRAW_WIDTH,
  drawnCall,
  drawnResult,
  plainLines,
  type DrawContext,
  type Renderable,
} from '../src/agent/pi/tool-drawing';
import Turnstile from '../src/components/Turnstile';
import type { Turn } from '../src/lib/thread';

const at = (which: string): string =>
  fileURLToPath(new URL(`./fixtures/extensions/${which}/index.mjs`, import.meta.url));

/** The tools one fixture registers, by name, as the host's own loader would
 *  hand them over. A dynamic import because the fixture is a file. */
async function toolsOf(which: string): Promise<Map<string, Renderable & { name: string }>> {
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(at(which)).href)) as {
    default: (api: { registerTool: (tool: Renderable & { name: string }) => void }) => void;
  };
  const tools = new Map<string, Renderable & { name: string }>();
  loaded.default({ registerTool: (tool) => tools.set(tool.name, tool) });
  return tools;
}

const CALL: DrawContext = {
  args: { subjects: 3 },
  toolCallId: 'call-1',
  isError: false,
  expanded: false,
  isPartial: false,
};

/** The escape character is the thing under test here: what crosses the
 *  boundary must have none in it, so the regex has to name one. */
// eslint-disable-next-line no-control-regex
const ESCAPE = /\u001b/;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/* -------------------------------------------------------------------------- */
/* The seam                                                                    */
/* -------------------------------------------------------------------------- */

describe('what an add-on drew for its tool', () => {
  it('is called at the width this window picks, and lays itself out against it', async () => {
    const draws = await toolsOf('draws');
    const definition = draws.get('draw_the_report');
    expect(definition).toBeDefined();

    const lines = drawnCall(definition!, CALL);
    expect(DRAW_WIDTH).toBe(80);
    expect(lines).not.toBeNull();
    expect(lines![0]!.startsWith('┌')).toBe(true);
    expect(lines!.join('\n')).toContain('subjects: 3');

    // The add-on laid this out against the width it was handed — a shorter one
    // draws a narrower panel rather than one made up somewhere else.
    const narrow = drawnCall(definition!, CALL, 40) ?? [];
    expect(narrow).toHaveLength(lines!.length);
    expect(narrow[0]).toHaveLength(40);
    expect(narrow[0]).not.toBe(lines![0]);
  });

  it('draws the result out of what the tool handed back', async () => {
    const draws = await toolsOf('draws');
    const lines = drawnResult(draws.get('draw_the_report')!, CALL, {
      content: [{ type: 'text', text: '3 subjects drawn' }],
      details: {},
    });

    expect(lines).not.toBeNull();
    expect(lines!.join('\n')).toContain('Report');
    expect(lines!.join('\n')).toContain('3 subjects drawn');
  });

  it('takes the colour out, because a window draws text and not escapes', async () => {
    const draws = await toolsOf('draws');
    const definition = draws.get('draw_the_report')!;

    const call = drawnCall(definition, CALL) ?? [];
    const result = drawnResult(definition, CALL, {
      content: [{ type: 'text', text: '3 subjects drawn' }],
      details: {},
    });

    expect(call.some((one) => ESCAPE.test(one))).toBe(false);
    expect(result?.some((one) => ESCAPE.test(one))).toBe(false);
    // The words the codes were wrapped around are still there.
    expect(result?.join('\n')).toContain('drawn');
  });

  it('drops a line that was nothing but colour rather than leaving a blank row', () => {
    expect(plainLines(['\u001b[32mgreen\u001b[0m', '\u001b[0m', '   ', 'kept'])).toEqual([
      'green',
      'kept',
    ]);
  });

  it('draws a component that has nothing but a render', () => {
    const bare: Renderable = {
      renderResult: () => ({ render: (width: number) => [`at ${String(width)}`] }),
    };
    expect(drawnResult(bare, CALL, { content: [], details: {} })).toEqual(['at 80']);
    expect(drawnResult(bare, CALL, { content: [], details: {} }, 40)).toEqual(['at 40']);
  });

  it('answers nothing for a renderer that throws, so the caller draws the ordinary card', async () => {
    const draws = await toolsOf('draws');
    const definition = draws.get('breaks_when_drawn');
    expect(definition).toBeDefined();

    // Never a throw: Pi's own TUI catches the same failure and falls back, and
    // an add-on's drawing bug is not a reason to lose the step.
    expect(() => drawnResult(definition!, CALL, { content: [], details: {} })).not.toThrow();
    expect(drawnResult(definition!, CALL, { content: [], details: {} })).toBeNull();
  });

  it('answers nothing for the shapes a renderer can get wrong', () => {
    const nothing: Renderable = {};
    expect(drawnCall(nothing, CALL)).toBeNull();
    expect(drawnResult(nothing, CALL, { content: [], details: {} })).toBeNull();

    // Not a component at all.
    expect(drawnResult({ renderResult: () => 'text' }, CALL, { content: [], details: {} })).toBeNull();
    expect(drawnResult({ renderResult: () => null }, CALL, { content: [], details: {} })).toBeNull();
    // A component whose own render throws, and one that returns what it likes.
    const throws: Renderable = {
      renderResult: () => ({
        render: () => {
          throw new Error('no layout for you');
        },
      }),
    };
    expect(drawnResult(throws, CALL, { content: [], details: {} })).toBeNull();
    const wrong: Renderable = { renderResult: () => ({ render: () => 'a string' }) };
    expect(drawnResult(wrong, CALL, { content: [], details: {} })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The window                                                                  */
/* -------------------------------------------------------------------------- */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const NOTHING = (): void => undefined;

function draw(turn: Turn): void {
  const element = createElement(Turnstile, {
    turn,
    onRespond: NOTHING,
    onAnswerAsked: NOTHING,
    onDismiss: NOTHING,
    onAnswerEstimate: NOTHING,
    onAnswerPlan: NOTHING,
    onAskForAPlanAgain: NOTHING,
    onFixReview: NOTHING,
    onPostReview: async () => true,
    showMe: false,
    onForkHere: NOTHING,
  }) as ReactElement;
  if (host === null) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => {
    root?.render(element);
  });
}

describe('a step an add-on drew', () => {
  it('reaches the row as the lines the add-on wrote', async () => {
    const draws = await toolsOf('draws');
    const definition = draws.get('draw_the_report')!;
    const lines = drawnResult(definition, CALL, {
      content: [{ type: 'text', text: '3 subjects drawn' }],
      details: {},
    });
    expect(lines).not.toBeNull();

    draw({
      kind: 'did',
      id: 'call-1',
      callId: 'call-1',
      state: 'done',
      label: 'Draw the report',
      drawn: lines!,
    });

    const sheet = host?.querySelector('.drawn__sheet');
    expect(sheet?.textContent).toBe(lines!.join('\n'));
    // Whitespace is the drawing: a re-flowed panel is a paragraph, which is why
    // the lines go in a `<pre>` rather than into the row's own text.
    expect(sheet?.tagName).toBe('PRE');
    expect(sheet?.textContent).not.toMatch(ESCAPE);
    expect(host?.querySelector('.drawn__said')?.textContent).toContain(
      'Drawn as this add-on draws it in a terminal',
    );
  });

  it('is not drawn at all when the add-on drew nothing', async () => {
    draw({
      kind: 'did',
      id: 'call-1',
      callId: 'call-1',
      state: 'done',
      label: 'Read a file',
      detail: '3 lines',
    });
    expect(host?.querySelector('.drawn')).toBeNull();
  });
});
