// @vitest-environment jsdom
/** Continue, Fork and Archive, from the row they belong to.
 *
 * The shelf is the only place these exist: the tab strip reaches what is open
 * and this reaches what was said, which is where somebody looking for the
 * conversation they had last week already is. What these check is the contract
 * the window leans on — the row that was pressed is the row named, a fork is
 * refused while the conversation it would copy is still working, an archived
 * row leaves the list and comes back, and the note a continue answers with
 * lands in the composer as a draft rather than being sent.
 */

import { act, createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Composer from '../src/components/Composer';
import Sidebar, { ACTS_WORDS } from '../src/components/Sidebar';
import { continuationWords, handoffMessage } from '../src/work/continuing';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const NOTHING = (): void => undefined;
const NOW = Date.parse('2026-09-14T12:00:00Z');

/** A conversation as the shell hands it over. */
type Row = {
  id: string;
  path: string;
  title: string;
  at: number;
  messages: number;
  archived?: boolean;
};

const PRICING: Row = {
  id: 'a',
  path: '/sessions/a.jsonl',
  title: 'the pricing page',
  at: NOW - 60_000,
  messages: 4,
};
const HERO: Row = {
  id: 'b',
  path: '/sessions/b.jsonl',
  title: 'the hero, tighter',
  at: NOW - 120_000,
  messages: 6,
};

/** What the row actions were asked, in the order they were asked. */
let asked: string[] = [];

/**
 * The shelf wired the way the window wires it: the list the shell answers with
 * carries the flag, and the flag is what draws the row. Nothing here remembers
 * what was archived on its own, because the window does not either.
 */
function Shelf({ opening, working = [] }: { opening: readonly Row[]; working?: readonly string[] }): ReactElement {
  const [conversations, setConversations] = useState<readonly Row[]>(opening);
  return createElement(Sidebar, {
    projects: [],
    openPath: '/p',
    onOpen: NOTHING,
    onBrowse: NOTHING,
    pinned: [],
    conversations,
    openConversation: opening[0]?.path ?? null,
    onOpenConversation: NOTHING,
    onNewConversation: NOTHING,
    onContinueConversation: (path: string) => asked.push(`continue ${path}`),
    onForkConversation: (path: string) => asked.push(`fork ${path}`),
    onArchiveConversation: (path: string, on: boolean) => {
      asked.push(`${on ? 'archive' : 'unarchive'} ${path}`);
      setConversations((was) =>
        was.map((one) => (one.path === path ? { ...one, archived: on } : one)),
      );
    },
    working,
    onDeleteConversation: NOTHING,
    open: true,
    onToggle: NOTHING,
    now: NOW,
  });
}

function drawn(opening: readonly Row[], working: readonly string[] = []): HTMLDivElement {
  asked = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(createElement(Shelf, { opening, working }));
  });
  return host;
}

function press(node: Element | null): void {
  if (node === null) throw new Error('nothing to press');
  act(() => {
    (node as HTMLElement).click();
  });
}

/** The conversations under their days, which is what "the list" means. */
function onTheList(where: HTMLElement): readonly string[] {
  return [...where.querySelectorAll('.shelf__day .shelf__convo .shelf__row')].map(
    (one) => one.textContent ?? '',
  );
}

/** The ones behind the labelled row, with it open. */
function putAway(where: HTMLElement): readonly string[] {
  return [
    ...where.querySelectorAll('.shelf__archivedsays ~ .shelf__list .shelf__convo .shelf__row'),
  ].map((one) => one.textContent ?? '');
}

function rowFor(where: HTMLElement, title: string): HTMLButtonElement {
  const found = [...where.querySelectorAll<HTMLButtonElement>('.shelf__convo .shelf__row')].find(
    (one) => (one.textContent ?? '').includes(title),
  );
  if (found === undefined) throw new Error(`no row for “${title}”`);
  return found;
}

/** Open the row's own menu and hand back the band it drew. */
function openMenuOn(where: HTMLElement, title: string): HTMLElement {
  const menu = rowFor(where, title).parentElement?.querySelector('.shelf__rowacts') ?? null;
  press(menu);
  const band = where.querySelector<HTMLElement>('.shelf__acts');
  if (band === null) throw new Error('the row drew no menu');
  return band;
}

function inBand(band: HTMLElement, label: string): HTMLButtonElement {
  const found = [...band.querySelectorAll<HTMLButtonElement>('button')].find(
    (one) => (one.textContent ?? '') === label,
  );
  if (found === undefined) throw new Error(`no “${label}” in the row's menu`);
  return found;
}

describe('what one conversation can be asked to do', () => {
  it('is Continue, Fork and Archive on its own row', () => {
    const where = drawn([PRICING, HERO]);
    const band = openMenuOn(where, 'the hero, tighter');
    expect([...band.querySelectorAll('button')].map((one) => one.textContent)).toEqual([
      continuationWords.label,
      continuationWords.fork,
      continuationWords.archive,
    ]);
  });

  it('acts on the row it was pressed on, not on the one on screen', () => {
    const where = drawn([PRICING, HERO]);
    press(inBand(openMenuOn(where, 'the hero, tighter'), continuationWords.label));
    expect(asked).toEqual([`continue ${HERO.path}`]);
  });

  it('forks the row it was pressed on', () => {
    const where = drawn([PRICING, HERO]);
    press(inBand(openMenuOn(where, 'the hero, tighter'), continuationWords.fork));
    expect(asked).toEqual([`fork ${HERO.path}`]);
  });

  /* A fork taken mid-turn copies a conversation that had not finished
     happening, and the shell refuses it. The shelf knows which rows those are
     rather than offering a press that comes back a refusal. */
  it('refuses to fork a conversation that is still working, and says why', () => {
    const where = drawn([PRICING, HERO], [HERO.path]);
    const band = openMenuOn(where, 'the hero, tighter');
    expect(inBand(band, continuationWords.fork).disabled).toBe(true);
    expect(band.querySelector('.shelf__actswhy')?.textContent).toBe(ACTS_WORDS.forkWaits);
  });

  it('leaves Fork pressable on every other row', () => {
    const where = drawn([PRICING, HERO], [HERO.path]);
    const band = openMenuOn(where, 'the pricing page');
    expect(inBand(band, continuationWords.fork).disabled).toBe(false);
    expect(band.querySelector('.shelf__actswhy')).toBeNull();
  });
});

describe('archiving one of them', () => {
  it('takes the row out of the list without touching the rest', () => {
    const where = drawn([PRICING, HERO]);
    press(inBand(openMenuOn(where, 'the hero, tighter'), continuationWords.archive));

    expect(asked).toEqual([`archive ${HERO.path}`]);
    expect(onTheList(where).join()).toContain('the pricing page');
    expect(onTheList(where).join()).not.toContain('the hero');
  });

  /* Out of the list is not out of reach: the row is one press away, and the
     press puts it back. */
  it('keeps it behind one labelled row, and Unarchive brings it back', () => {
    const where = drawn([PRICING, HERO]);
    press(inBand(openMenuOn(where, 'the hero, tighter'), continuationWords.archive));
    expect(where.querySelector('.shelf__archivedcount')?.textContent).toBe('1');

    press(where.querySelector('.shelf__archivedsays'));
    expect(putAway(where).join()).toContain('the hero');

    press(where.querySelector('.shelf__unarchive'));
    expect(asked.at(-1)).toBe(`unarchive ${HERO.path}`);
    expect(onTheList(where).join()).toContain('the hero');
    expect(where.querySelector('.shelf__archivedsays')).toBeNull();
  });

  it('is nobody’s business until somebody archives one', () => {
    expect(drawn([PRICING, HERO]).querySelector('.shelf__archivedsays')).toBeNull();
  });
});

describe('the note a continue answers with', () => {
  const note = handoffMessage({
    from: 'the pricing page',
    objective: 'make the hero tighter',
    gotTo: 'Two pages use it.',
    files: ['src/Hero.tsx'],
    folder: '/p/paper-street',
    project: 'paper-street',
  });

  /* The handoff is the shell's words about work that happened. They land in the
     box with the caret in them, ready to be cut down or thrown away — and
     nothing is sent, because sending is the person's press. */
  it('lands in the box as a draft, with nothing sent', () => {
    const sent: string[] = [];
    host = document.createElement('div');
    host.className = 'app';
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        createElement(Composer, {
          onSend: (text: string) => sent.push(text),
          draft: note,
          project: '/p/paper-street',
          conversation: '/sessions/c.jsonl',
        }),
      );
    });

    const box = host.querySelector('textarea');
    expect(box?.value).toBe(note);
    expect(document.activeElement).toBe(box);
    expect(sent).toEqual([]);
  });
});
