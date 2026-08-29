// @vitest-environment jsdom
/** The copy control on one turn, and where it sits.
 *
 * It used to live on the label line above the words, which put it a whole
 * screen away from the bottom of a long reply — you read the answer, then went
 * looking upwards for the button that copies it. It belongs under the words,
 * close enough to read as the foot of that message rather than as something
 * floating between two of them.
 *
 * Three things here have all been wrong on screen at some point: the control
 * appearing above the text, the turn changing height as the cursor crossed it,
 * and a control a mouse could reach and a keyboard could not.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Message from '../src/components/Message';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout, and the fold that cuts a long reply watches for it.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function draw(props: Parameters<typeof Message>[0]): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  act(() => {
    createRoot(host).render(createElement(Message, props));
  });
  return host;
}

const CSS = readFileSync(join(process.cwd(), 'src/components/Message.css'), 'utf8');

describe('where the copy control sits', () => {
  it('comes after the words, not above them', () => {
    const host = draw({ from: 'you', children: 'Should this be a worker or a queue?', copy: 'x' });
    const body = host.querySelector('.message__body');
    const copy = host.querySelector('.message__copy');

    if (body === null || copy === null) throw new Error('the turn drew neither its words nor its control');
    expect(body.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelector('.message__who button')).toBeNull();
  });

  it('reads as the foot of this message rather than the space before the next', () => {
    // 4px under the words against the thread's own 16px between turns.
    expect(CSS).toContain('top: var(--space-1);');
    // And the room is the 4px drop plus the control, so the turn ends where the
    // control does rather than hanging over what comes after it.
    expect(CSS).toMatch(/\.message__foot \{[^}]*height: var\(--space-5\);/);
  });

  it('is not there while the reply is still arriving', () => {
    const host = draw({ from: 'graphe', children: 'Half a th', streaming: true, copy: 'Half a th' });
    expect(host.querySelector('.message__copy')).toBeNull();
  });

  it('keeps its room open anyway, so the turn does not hop when the reply lands', () => {
    const streaming = draw({ from: 'graphe', children: 'Half a th', streaming: true, copy: 'Half a th' });
    const finished = draw({ from: 'graphe', children: 'Half a thought.', copy: 'Half a thought.' });

    expect(streaming.querySelector('.message__foot')).not.toBeNull();
    expect(finished.querySelector('.message__foot')).not.toBeNull();
  });

  it('draws nothing at all when there is nothing to copy', () => {
    const host = draw({ from: 'graphe', children: 'Hi' });
    expect(host.querySelector('.message__foot')).toBeNull();
  });
});

describe('how it appears', () => {
  it('hides only where there is a pointer to bring it back', () => {
    const hidden = /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.message__copy \{\s*opacity: 0;/;
    expect(CSS).toMatch(hidden);
  });

  it('comes back for a keyboard as well as a cursor', () => {
    expect(CSS).toContain('.message:focus-within .message__copy');
    expect(CSS).toContain('.message__copy:focus-visible');
  });

  it('stays out long enough to be read once it says Copied', () => {
    expect(CSS).toContain('.message__copy.message__copy--held');
  });

  it('takes its hit area downwards, away from the last line of the message', () => {
    // Reaching upwards would put an invisible target over words people drag
    // across to select.
    expect(CSS).toMatch(/\.message__copy::after \{[^}]*inset: -4px -6px -12px;/);
  });

  it('presses, and stops pressing when motion is turned down', () => {
    expect(CSS).toContain('transform: scale(0.97)');
    expect(CSS).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.message__copy:active \{\s*transform: none;/);
  });
});

/* It used to be the word "Copy", stacked directly above the thread's own "Copy
   the conversation" — two labels reading as a pair of buttons doing one job. */
describe('an icon rather than the word', () => {
  const control = (): HTMLElement => {
    const host = draw({ from: 'graphe', children: 'A queue.', copy: 'A queue.' });
    const copy = host.querySelector('.message__copy');
    if (copy === null) throw new Error('the turn drew no copy control');
    return copy as HTMLElement;
  };

  it('draws a mark and no label', () => {
    const copy = control();
    expect(copy.querySelector('svg')).not.toBeNull();
    expect(copy.textContent).toBe('');
  });

  it('still says what it is, to a screen reader and under the cursor', () => {
    const copy = control();
    expect(copy.getAttribute('aria-label')).toBe('Copy this message');
    expect(copy.getAttribute('title')).toBe('Copy this message');
  });

  /** Distinct from "Copy the conversation" underneath it: two controls that
   *  both read "Copy" is the thing being fixed. */
  it('names this message, not the whole thread', () => {
    expect(control().getAttribute('aria-label')).not.toMatch(/conversation/i);
  });

  it('keeps one square whatever it is saying', () => {
    expect(CSS).toMatch(/\.message__copy \{[^}]*width: 20px;/);
    expect(CSS).toMatch(/\.message__copy \{[^}]*height: 20px;/);
  });

  /** The confirmation rides beside the icon out of flow, so landing a copy
   *  cannot widen the control or shove the turn under it. */
  it('says Copied without taking any room', () => {
    expect(CSS).toMatch(/\.message__copysaid \{[^}]*position: absolute;/);
    expect(CSS).toMatch(/\.message__copysaid \{[^}]*left: 100%;/);
  });
});

describe('once it lands', () => {
  const wrote: string[] = [];
  beforeAll(() => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          wrote.push(text);
          return Promise.resolve();
        },
      },
    });
  });

  it('swaps the mark, says Copied beside it, and holds itself out', async () => {
    const host = draw({ from: 'graphe', children: 'A queue.', copy: 'A queue.' });
    const copy = host.querySelector('.message__copy') as HTMLElement;

    await act(async () => {
      copy.click();
    });

    expect(wrote).toEqual(['A queue.']);
    expect(copy.className).toContain('message__copy--held');
    expect(copy.getAttribute('aria-label')).toBe('Copied');
    expect(host.querySelector('.message__copysaid')?.textContent).toBe('Copied');
  });
});
