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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import Composer, { draftKey } from '../src/components/Composer';
import {
  changeThread,
  conversationIn,
  noDesks,
  openDesk,
  putBackTheBox,
  showThread,
} from '../src/lib/projects';

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
  // A test that fails part way through leaves the clock faked, and the next
  // one waits on the box's own debounce — put real time back whatever happened.
  vi.useRealTimers();
  for (const one of open.splice(0)) {
    act(() => {
      one.root.unmount();
    });
    one.host.remove();
  }
});

type Props = Parameters<typeof Composer>[0];

function draw(props: Partial<Props> = {}): { host: HTMLElement; root: Root; close: () => void } {
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
    root,
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

/** The same box, moved to another conversation or another project: the window
 *  swaps the two props rather than mounting a second composer. */
function moveTo(held: { host: HTMLElement; root: Root }, props: Partial<Props>): void {
  act(() => {
    held.root.render(createElement(Composer, { onSend: () => undefined, ...props }));
  });
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

describe('whose sentence the box is holding', () => {
  /** The callback the window binds to a conversation: one per chat, so a
   *  sentence that is handed back after a switch can be seen to have gone to
   *  the chat it was written in rather than to the one now on screen. */
  function saidIn(written: string[], owner: string): (text: string) => void {
    return (text) => written.push(`${owner}:${text}`);
  }

  /** The two halves of the arrangement, wired the way the window wires them:
   *  the sentence lives on the conversation, the box reports what is in it, and
   *  what the conversation holds comes back in as the `draft` prop.
   *
   * `paint` is the window re-rendering with the conversation's copy — done here
   *  by hand, where a test needs it, rather than from inside the report: the box
   *  reports on the way out too, when there is no window left to draw. */
  function conversationHolding(props: Partial<Props> = HERE) {
    const project = props.project ?? HERE.project;
    const conversation = props.conversation ?? HERE.conversation;
    const owner = { project, address: conversation };
    // The conversation named, so the writes below land on the one in front and
    // the box is drawn for it — the way the window opens a chat.
    let desks = showThread(
      openDesk(noDesks, { path: project, name: 'paper-street' }),
      project,
      conversation,
      { turns: [] },
    );
    desks = changeThread(desks, owner, (one) => ({ ...one, draft: props.draft ?? '' }));
    const view = draw({});
    const said = (): string =>
      conversationIn(desks.byPath[project]!, conversation).draft ?? '';
    const paint = (): void => {
      moveTo(view, {
        onSend: () => undefined,
        ...props,
        draft: said(),
        onDraftChange: (text) => {
          desks = changeThread(desks, owner, (one) => ({ ...one, draft: text }));
        },
      });
    };
    paint();
    return {
      view,
      field: () => boxIn(view.host),
      said,
      paint,
      /** What the shell refusing the message does to the box. */
      refused: (sent: string): void => {
        desks = putBackTheBox(desks, owner, sent);
        paint();
      },
    };
  }

  /** The box writes what was typed down a beat after the typing stops. A fake
   *  clock, so the beat is the box's debounce rather than the machine's load. */
  async function paused(): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
  }

  it('goes back to the conversation it was written in, not the one arrived at', () => {
    const written: string[] = [];
    const here = draw({ ...HERE, onDraftChange: saidIn(written, 'a') });
    type(boxIn(here.host), 'about the header');

    moveTo(here, { ...HERE, conversation: 'b', onDraftChange: saidIn(written, 'b') });

    expect(written).toEqual(['a:about the header']);
  });

  it('is emptied in the conversation that sent it, and only there', () => {
    const written: string[] = [];
    const sent: string[] = [];
    const here = draw({
      ...HERE,
      onSend: (text: string) => sent.push(text),
      onDraftChange: saidIn(written, 'a'),
    });
    const field = boxIn(here.host);
    type(field, 'make it tighter');
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(sent).toEqual(['make it tighter']);
    expect(written).toEqual(['a:']);
  });

  /* A send is a round trip: the shell can take seconds to refuse it, and the
     next sentence is often started meanwhile. The conversation has to be
     holding that sentence by the time the refusal comes back, or the sentence
     it puts back is put back over the top of it. */
  it('is handed to the conversation as somebody types, not only on the way out', async () => {
    vi.useFakeTimers();
    const held = conversationHolding();
    type(held.field(), 'and the footer');
    await paused();
    expect(held.said()).toBe('and the footer');
  });

  it('keeps what was typed during a slow send in front of the sentence that came back', async () => {
    vi.useFakeTimers();
    const held = conversationHolding();
    const field = held.field();
    type(field, 'make the hero tighter');
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(held.said()).toBe('');

    type(field, 'and the footer');
    await paused();
    expect(held.said()).toBe('and the footer');

    held.refused('make the hero tighter');
    expect(boxIn(held.view.host).value).toBe('and the footer\n\nmake the hero tighter');
  });

  /* The conversation reports back what was just typed, and a box that re-seeds
     itself from its own report takes the cursor with it — so somebody writing
     in the middle of a sentence is moved to the end of it. */
  it('leaves the cursor where it is when the conversation reports the sentence back', async () => {
    vi.useFakeTimers();
    const held = conversationHolding();
    const field = held.field();
    type(field, 'and the footer');
    field.setSelectionRange(4, 4);
    await paused();

    expect(held.said()).toBe('and the footer');
    // The window draws again with the conversation's copy of it, as it does
    // when the write lands.
    held.paint();
    expect(field.selectionStart).toBe(4);
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
