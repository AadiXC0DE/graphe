// @vitest-environment jsdom
/** The card a thrown render lands on.
 *
 * Before this, one bad render turned the window white — no words, no way back,
 * nothing to send anybody. These render a component that really throws and
 * check what a person is left looking at: one sentence, the message, and a
 * button that puts something useful on the clipboard.
 */

import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ErrorBoundary, { boundaryReport, boundaryWords } from '../src/components/ErrorBoundary';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let copied: string | null = null;

beforeEach(() => {
  copied = null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        copied = text;
        return Promise.resolve();
      },
    },
  });
  // React shouts about the caught error, twice. The test is the record here.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  vi.restoreAllMocks();
});

function Boom({ saying }: { saying: string }): ReactNode {
  throw new Error(saying);
}

function Fine(): ReactNode {
  return createElement('p', { className: 'fine' }, 'the conversation');
}

function draw(props: {
  what: string;
  children: ReactNode;
  onCaught?: (e: Error, info: string) => void;
}): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  act(() => {
    createRoot(host).render(createElement(ErrorBoundary, props));
  });
  return host;
}

function press(host: HTMLElement, selector: string): void {
  const button = host.querySelector(selector);
  if (button === null) throw new Error(`nothing to press at ${selector}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('when nothing is wrong', () => {
  it('is not there at all', () => {
    const host = draw({ what: 'the conversation', children: createElement(Fine) });
    expect(host.querySelector('.fine')).not.toBeNull();
    expect(host.querySelector('.boundary')).toBeNull();
  });
});

describe('when a render throws', () => {
  it('shows one card instead of a blank window', () => {
    const host = draw({
      what: 'the conversation',
      children: createElement(Boom, { saying: 'cannot read length of undefined' }),
    });

    const card = host.querySelector('.boundary');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('role')).toBe('alert');
    expect(host.textContent).toContain(boundaryWords.what('the conversation'));
    expect(host.textContent).toContain('cannot read length of undefined');
  });

  it('names the part that fell over, so two of these are told apart', () => {
    const host = draw({
      what: 'the design view',
      children: createElement(Boom, { saying: 'no tokens' }),
    });
    expect(host.textContent).toContain('the design view');
  });

  it('tells whoever is listening, with somewhere to look', () => {
    const caught: { message: string; stack: string }[] = [];
    draw({
      what: 'the board',
      children: createElement(Boom, { saying: 'nothing to draw' }),
      onCaught: (e, info) => caught.push({ message: e.message, stack: info }),
    });

    expect(caught).toHaveLength(1);
    expect(caught[0]?.message).toBe('nothing to draw');
    expect(caught[0]?.stack).toContain('Boom');
  });

  it('says something even when the failure said nothing', () => {
    const host = draw({ what: 'the board', children: createElement(Boom, { saying: '' }) });
    expect(host.textContent).toContain(boundaryWords.noMessage);
  });

  it('copies something worth sending, and says it did', () => {
    const host = draw({
      what: 'the conversation',
      children: createElement(Boom, { saying: 'cannot read length of undefined' }),
    });

    press(host, '.boundary__copy');

    expect(copied).not.toBeNull();
    expect(copied).toContain('the conversation');
    expect(copied).toContain('cannot read length of undefined');
    expect(host.textContent).toContain(boundaryWords.copied);
  });
});

describe('what gets copied', () => {
  const at = Date.UTC(2026, 8, 2, 10, 0, 0);

  it('says where, what and when', () => {
    const said = boundaryReport('the conversation', 'cannot read length', '\n    at Thread', at);
    expect(said).toContain('where: the conversation');
    expect(said).toContain('what: cannot read length');
    expect(said).toContain('2026-09-02T10:00:00.000Z');
    expect(said).toContain('Thread');
  });

  it('leaves out the part it has nothing for', () => {
    const said = boundaryReport('the board', 'nothing to draw', '', at);
    expect(said).not.toContain('in:');
    expect(said.split('\n').every((line) => line.trim() !== '')).toBe(true);
  });
});
