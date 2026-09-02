// @vitest-environment jsdom
/** A sentence somebody was half way through writing.
 *
 * The box used to be seeded from a prop and nothing else, so a reload, a crash
 * or a switch to the other conversation open in the same project took whatever
 * was in it. What is kept is kept per project and per conversation — one key
 * for both would hand somebody the sentence they were writing somewhere else —
 * and every read and write is behind a try, because a window with site data
 * turned off must leave the composer working rather than break it.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import Composer, { draftKey } from '../src/components/Composer';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const open: { host: HTMLElement; root: Root }[] = [];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const one of open.splice(0)) {
    act(() => {
      one.root.unmount();
    });
    one.host.remove();
  }
});

type Props = Parameters<typeof Composer>[0];

function draw(props: Partial<Props> = {}): { host: HTMLElement; close: () => void } {
  const host = document.createElement('div');
  host.className = 'app';
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(Composer, { onSend: () => undefined, ...props }));
  });
  const held = { host, root };
  open.push(held);
  return {
    host,
    close: () => {
      const at = open.indexOf(held);
      if (at !== -1) open.splice(at, 1);
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function boxIn(host: HTMLElement): HTMLTextAreaElement {
  const field = host.querySelector('textarea');
  if (field === null) throw new Error('the composer drew no box');
  return field;
}

/** Typing, the way React hears it. */
function type(field: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('no value setter on a textarea');
  act(() => {
    setter.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const HERE = { project: '/p/paper-street', conversation: 'a' };

describe('where a draft is kept', () => {
  it('is named for the project and the conversation, not for one of them', () => {
    expect(draftKey('/p/paper-street', 'a')).not.toBe(draftKey('/p/paper-street', 'b'));
    expect(draftKey('/p/paper-street', 'a')).not.toBe(draftKey('/p/other', 'a'));
    expect(draftKey('/p/paper-street', 'a')).toContain('/p/paper-street');
  });

  it('is one key for a project with no conversation named yet', () => {
    expect(draftKey('/p/paper-street')).toBe(draftKey('/p/paper-street', null));
  });
});

describe('a half-written message', () => {
  it('is written down as somebody types', async () => {
    const { host } = draw(HERE);
    type(boxIn(host), 'make the hero tighter');

    await act(async () => {
      await new Promise((wake) => setTimeout(wake, 600));
    });
    expect(localStorage.getItem(draftKey(HERE.project, HERE.conversation))).toBe(
      'make the hero tighter',
    );
  });

  it('is there again when the window comes back', () => {
    const first = draw(HERE);
    type(boxIn(first.host), 'the pricing page needs');
    first.close();

    const again = draw(HERE);
    expect(boxIn(again.host).value).toBe('the pricing page needs');
  });

  it('goes with the conversation it was written in', () => {
    const first = draw(HERE);
    type(boxIn(first.host), 'about the header');
    first.close();

    const other = draw({ project: HERE.project, conversation: 'b' });
    expect(boxIn(other.host).value).toBe('');
  });

  it('comes back when the same conversation is opened again', () => {
    const first = draw(HERE);
    type(boxIn(first.host), 'about the header');
    first.close();

    const other = draw({ project: HERE.project, conversation: 'b' });
    type(boxIn(other.host), 'about the footer');
    other.close();

    expect(boxIn(draw(HERE).host).value).toBe('about the header');
  });

  it('is cleared once the box is empty again, rather than left behind', async () => {
    const { host } = draw(HERE);
    type(boxIn(host), 'never mind');
    type(boxIn(host), '');

    await act(async () => {
      await new Promise((wake) => setTimeout(wake, 600));
    });
    expect(localStorage.getItem(draftKey(HERE.project, HERE.conversation))).toBeNull();
  });

  it('is not kept at all where no project was named', () => {
    const { host } = draw({});
    type(boxIn(host), 'somewhere with no folder open');
    expect(localStorage.length).toBe(0);
  });

  /** An example put into the box from the first screen is an explicit press,
   *  and it wins over whatever was left there. */
  it('gives way to a sentence handed in from outside', () => {
    localStorage.setItem(draftKey(HERE.project, HERE.conversation), 'older words');
    const { host } = draw({ ...HERE, draft: 'Make my landing page feel calmer' });
    expect(boxIn(host).value).toBe('Make my landing page feel calmer');
  });
});

describe('a window that refuses to keep anything', () => {
  it('leaves the composer working rather than breaking it', () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('site data is blocked here');
      },
    });
    try {
      const { host } = draw(HERE);
      const field = boxIn(host);
      type(field, 'still typing');
      expect(field.value).toBe('still typing');
    } finally {
      if (real === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, 'localStorage', real);
    }
  });
});
