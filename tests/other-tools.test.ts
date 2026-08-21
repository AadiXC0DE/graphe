// @vitest-environment jsdom
/** The Other tools screen: what it offers, and what a press really saves.
 *
 * With nothing connected this screen used to draw a dashed box and two
 * sentences, while a different screen quietly held the four tools we vouch for.
 * Somebody who opened this one because they wanted Figma found nothing to
 * press and a paragraph about a protocol.
 *
 * So these render the real component. The claim being tested is not that the
 * markup contains a word — it is that the offer is on this screen, that a press
 * saves the start line we checked, and that a tool already connected stops
 * being offered.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Connected, { SAYS } from '../src/components/Connected';
import { REACHABLE } from '../src/agent/pi/reach';
import type { Connected as Tool, ConnectedState } from '../src/lib/ipc';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

const NOTHING: ConnectedState = {
  tools: [],
  file: '/somewhere/.pi/mcp.json',
  trouble: null,
  skipped: [],
};

type Drawn = { host: HTMLElement; saved: Tool[][]; press: (label: string) => Promise<void> };

/** The panel as it really draws, with the saves it really asks for. */
async function draw(state: ConnectedState): Promise<Drawn> {
  const saved: Tool[][] = [];
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(Connected, {
        open: true,
        state,
        onClose: () => undefined,
        onCheck: () => Promise.resolve({ state: 'unknown' as const }),
        onSave: (tools: readonly Tool[]) => {
          saved.push([...tools]);
          return Promise.resolve();
        },
      }),
    );
  });
  return {
    host,
    saved,
    press: async (label: string) => {
      const button = buttons(host).find((one) => one.textContent === label);
      expect(button, `no button reading “${label}”`).toBeDefined();
      await act(async () => button?.click());
    },
  };
}

function buttons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')];
}

function pressesReading(host: HTMLElement, label: string): number {
  return buttons(host).filter((one) => one.textContent === label).length;
}

describe('a project with nothing connected', () => {
  /** The empty screen is the offer. Four things we have checked, one press
   *  each, rather than a rectangle saying there is nothing here. */
  it('offers every tool we vouch for', async () => {
    const { host } = await draw(NOTHING);
    expect(pressesReading(host, SAYS.connect)).toBe(REACHABLE.length);
    for (const one of REACHABLE) {
      expect(host.textContent, one.id).toContain(one.name);
      expect(host.textContent, one.id).toContain(one.what);
    }
  });

  /** Not a sentence about emptiness in place of something to do: the words are
   *  quiet and the presses are the point. */
  it('still says plainly that nothing is connected', async () => {
    const { host } = await draw(NOTHING);
    expect(host.textContent).toContain(SAYS.none);
    expect(pressesReading(host, SAYS.check)).toBe(0);
  });

  /** The line that goes in the file is the one we checked, not one this screen
   *  made up from the name. */
  it('saves the start line we vouch for when one is pressed', async () => {
    const { saved, press } = await draw(NOTHING);
    await press(SAYS.connect);
    expect(saved).toEqual([
      [{ name: 'figma', command: '', args: [], address: 'http://127.0.0.1:3845/mcp' }],
    ]);
  });

  /** Somebody with one of their own is one press from the two boxes. */
  it('keeps a way in for a tool we have never heard of', async () => {
    const { host, press } = await draw(NOTHING);
    expect(pressesReading(host, SAYS.add)).toBe(1);
    await press(SAYS.add);
    expect(host.querySelectorAll('input')).toHaveLength(2);
    expect(host.textContent).toContain(SAYS.commandHint);
  });
});

describe('a project with tools already connected', () => {
  const two: ConnectedState = {
    ...NOTHING,
    tools: [
      { name: 'code-read', command: 'npx', args: ['-y', 'ts-language-mcp'] },
      { name: 'my-database', command: 'npx', args: ['-y', 'some-db-mcp'] },
    ],
  };

  /** Offering something that is already there is how a list stops meaning
   *  anything. */
  it('stops offering the ones it already has', async () => {
    const { host } = await draw(two);
    expect(pressesReading(host, SAYS.connect)).toBe(REACHABLE.length - 1);
    expect(pressesReading(host, SAYS.check)).toBe(2);
    expect(pressesReading(host, SAYS.remove)).toBe(2);
  });

  /** One of ours written down under its id reads as the name somebody picked
   *  it by, and says what it lets them do — the same sentence the shelf uses. */
  it('calls one of ours by the name it was chosen under', async () => {
    const ours = REACHABLE.find((one) => one.id === 'code-read');
    expect(ours).toBeDefined();
    const { host } = await draw(two);
    expect(host.textContent).toContain(ours?.name);
    expect(host.textContent).toContain(ours?.what);
    // Somebody else's tool has no sentence of ours to borrow, and keeps its
    // own name.
    expect(host.textContent).toContain('my-database');
  });

  /** Every row already carries the one press that takes it back off, whoever
   *  put it there — the agent included. */
  it('lets any of them be disconnected from here', async () => {
    const { saved, press } = await draw(two);
    await press(SAYS.remove);
    expect(saved).toEqual([[two.tools[1]]]);
  });
});

describe('a list that will not read', () => {
  /** Nothing may be offered or connected over a file nobody can read: the file
   *  is the only copy of everything this screen never sees. */
  it('offers nothing at all', async () => {
    const { host } = await draw({
      ...NOTHING,
      trouble: 'the file is there but not valid JSON.',
    });
    expect(host.textContent).toContain(SAYS.cannotChange);
    expect(pressesReading(host, SAYS.connect)).toBe(0);
    expect(pressesReading(host, SAYS.add)).toBe(0);
    expect(host.textContent).not.toContain(SAYS.none);
  });
});

describe('what this screen says for itself', () => {
  /** One of the two places allowed to name the real thing. Somebody who has
   *  been told to "add an MCP server" has to land here, and the sentence about
   *  what it is for has to come before the sentence about what it is. */
  it('says what it is for first, and names the real thing second', () => {
    expect(SAYS.what).not.toMatch(/MCP/);
    expect(SAYS.how).toMatch(/MCP/);
    expect(SAYS.what.length).toBeGreaterThan(60);
  });
});

describe('how the screen moves', () => {
  // Read off the project root: under jsdom `import.meta.url` is not a file
  // URL, and the whole point of this block is the file on disk.
  const rules = readFileSync(join(process.cwd(), 'src/components/Connected.css'), 'utf8');

  /** Transform and opacity only, and a press that gives under the finger. */
  it('animates nothing a compositor cannot animate', () => {
    expect(rules).not.toMatch(/transition:\s*all/);
    expect(rules).toMatch(/scale\(0\.97\)/);
    expect(rules).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  /** Nothing lifted out of the flow: a card floating over a band is the one
   *  bug this whole surface has already had. */
  it('lifts nothing out of the column', () => {
    expect(rules).not.toMatch(/position:\s*(absolute|fixed)/);
  });
});
