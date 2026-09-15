import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import './Tabs.css';

/** What a tab is doing, when it is doing anything. Idle carries no mark at all:
 *  a row where every tab wears a badge is a row where none of them mean
 *  anything. */
export type TabState = 'working' | 'asking' | 'finished' | 'idle';

/** One open conversation. A tab is a conversation, not a project — that is the
 *  unit of work people switch between, and it is the only shape in which "two
 *  agents in one codebase" can be said at all. */
export type Tab = {
  id: string;
  /** What this conversation is called. */
  title: string;
  /** The project it is in, in the words the person calls their folder. */
  project: string;
  /** The project's folder, which is what groups tabs and picks the underline. */
  projectPath: string;
  state: TabState;
};

type Props = {
  tabs: readonly Tab[];
  /** Which one is in front, by id. */
  at: string | null;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  /** Start another conversation in the project in front. */
  onNew: () => void;
  /** Put a tab somewhere else in the row. Left out where the row cannot be
   *  rearranged, and then nothing in it is draggable. */
  onReorder?: (id: string, to: number) => void;
};

export const SAYS = {
  label: 'What you have open',
  add: 'New conversation',
  close: (title: string) => `Close ${title}`,
  more: 'Everything open',
  states: {
    working: 'still working',
    asking: 'waiting for you',
    finished: 'finished',
    idle: '',
  },
} as const;

/**
 * A compact conversation switcher. The project sits beside it as a separate
 * fact, so a tab does not waste its scarce width repeating the folder name.
 * They are the open conversations in the project in front, kept in their
 * opening order; the project list belongs in the sidebar.
 *
 * **The state mark is the point.** Switching away from something that is still
 * working and having the tab tell you when it needs you is the whole reason
 * tabs exist here, and it is what a side panel of background agents gets wrong.
 */
export default function Tabs({ tabs, at, onOpen, onClose, onNew, onReorder }: Props) {
  const [listing, setListing] = useState(false);
  /** The tab under the hand, and where it would land. Held here rather than on
   *  the event, because a drop needs both and only one of them is in it. */
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  /** Which tab the keyboard is on. Roving tabindex: exactly one tab is a tab
   *  stop, so Tab leaves the strip instead of walking every close button. */
  const [focused, setFocused] = useState<string | null>(null);
  /** The neighbour that takes focus after a close, or `add` when the row empties. */
  const [returnTo, setReturnTo] = useState<string | 'add' | null>(null);
  /** Whether the strip has scrolled tabs out of sight. Measured, not counted:
   *  how many fit depends on the width the header gives it. */
  const [clipped, setClipped] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const add = useRef<HTMLButtonElement>(null);
  const empty = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!listing) return;
    const away = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setListing(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setListing(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [listing]);

  /* Keep the tab in front where it can be seen, without ever moving the row:
     scrolling is not rearrangement, and nothing here takes focus. */
  useEffect(() => {
    if (at === null) return;
    const node = buttons.current.get(at);
    if (node === undefined) return;
    // A layout-less test environment has no scrollIntoView to call.
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [at, tabs]);

  useEffect(() => {
    const node = strip.current;
    if (node === null) return;
    const measure = (): void => setClipped(node.scrollWidth > node.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watching = new ResizeObserver(measure);
    watching.observe(node);
    return () => watching.disconnect();
  }, [tabs]);

  useEffect(() => {
    if (returnTo === null) return;
    setReturnTo(null);
    const node =
      returnTo === 'add' ? (add.current ?? empty.current) : buttons.current.get(returnTo);
    node?.focus();
  }, [returnTo, tabs]);

  if (tabs.length === 0) {
    return (
      <div className="tabs tabs--empty" ref={root}>
        <button type="button" className="tabs__empty" ref={empty} onClick={onNew}>
          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" aria-hidden="true">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span>{SAYS.add}</span>
        </button>
      </div>
    );
  }

  // A tab strip is spatial memory. Never bring the selected tab to the front:
  // that turns a click into a moving target and makes the row impossible to
  // learn. The current tab is marked in place instead, and kept in view by
  // scrolling rather than by moving.
  /* Every tab is drawn. The strip is as wide as the tabs in it, capped so a
     long row scrolls inside the header instead of pushing the project menu off
     the end. Each tab is capped at 168px (Tabs.css), so counting that leaves no
     hole between the last tab and the add button. */
  const WIDEST = 520;
  const width = Math.min(tabs.length * 168 + Math.max(0, tabs.length - 1) * 2 + 30, WIDEST);

  /* Two conversations can carry one title, and then the folder is the only
     thing that tells them apart. It belongs in the accessible name too, not
     only in the tooltip, or the row is two identical buttons to a screen
     reader. */
  const doubled = new Set(
    tabs.map((tab) => tab.title).filter((title, index, all) => all.indexOf(title) !== index),
  );
  const called = (tab: Tab): string =>
    doubled.has(tab.title) ? `${tab.title} (${tab.project})` : tab.title;

  /* Exactly one tab is a tab stop, so Tab leaves the strip rather than walking
     every mark in it. The arrows are how the rest are reached. */
  const stop =
    focused !== null && tabs.some((tab) => tab.id === focused)
      ? focused
      : at !== null && tabs.some((tab) => tab.id === at)
        ? at
        : (tabs[0]?.id ?? null);

  const keyed = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const held = (event.target as HTMLElement).closest('[role="tab"]');
    const from =
      held === null
        ? tabs.findIndex((tab) => tab.id === at)
        : tabs.findIndex((tab) => buttons.current.get(tab.id) === held);
    /* Dragging is a mouse gesture. The same rearrangement has to be reachable
       from the keyboard, or the order is not really the person's to decide. */
    if (
      onReorder !== undefined &&
      event.altKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      const here = tabs[from];
      if (here === undefined) return;
      event.preventDefault();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      const to = Math.max(0, Math.min(tabs.length - 1, from + step));
      onReorder(here.id, to);
      return;
    }
    const go = (index: number): void => {
      const next = tabs[((index % tabs.length) + tabs.length) % tabs.length];
      if (next === undefined) return;
      onOpen(next.id);
      buttons.current.get(next.id)?.focus();
    };
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(from + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(from - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      go(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      go(tabs.length - 1);
    }
  };

  return (
    <div className="tabs" ref={root} style={{ width: `${String(width)}px` }}>
      <div
        className="tabs__strip"
        role="tablist"
        aria-label={SAYS.label}
        ref={strip}
        onKeyDown={keyed}
      >
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={[
              'tabs__tab',
              tab.id === at ? 'tabs__tab--here' : '',
              dragging === tab.id ? 'tabs__tab--lifted' : '',
              over === index && dragging !== null && dragging !== tab.id ? 'tabs__tab--landing' : '',
            ]
              .filter((one) => one !== '')
              .join(' ')}
            draggable={onReorder !== undefined}
            onDragStart={(event) => {
              if (onReorder === undefined) return;
              setDragging(tab.id);
              event.dataTransfer.effectAllowed = 'move';
              // Some browsers refuse a drag with nothing on it.
              event.dataTransfer.setData('text/plain', tab.id);
            }}
            onDragOver={(event) => {
              if (onReorder === undefined || dragging === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setOver(index);
            }}
            onDrop={(event) => {
              if (onReorder === undefined || dragging === null) return;
              event.preventDefault();
              onReorder(dragging, index);
              setDragging(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === at}
              aria-label={called(tab)}
              tabIndex={tab.id === stop ? 0 : -1}
              ref={(node) => {
                if (node === null) buttons.current.delete(tab.id);
                else buttons.current.set(tab.id, node);
              }}
              onFocus={() => setFocused(tab.id)}
              className="tabs__open"
              onClick={() => onOpen(tab.id)}
              onAuxClick={(event) => {
                // Middle click closes, the way every tab strip has for twenty
                // years. Nobody is taught this and everybody who knows it uses it.
                if (event.button === 1) onClose(tab.id);
              }}
              title={`${tab.title} (${tab.project})`}
            >
              <Mark state={tab.state} />
              <span className="tabs__text">
                <span className="tabs__title">{tab.title}</span>
              </span>
            </button>

            <button
              type="button"
              className="tabs__close"
              tabIndex={tab.id === stop ? 0 : -1}
              onClick={() => {
                /* Focus lands on the tab the row closes into, or on the button
                   that starts a new conversation when the row empties. */
                const where = tabs.findIndex((one) => one.id === tab.id);
                const rest = tabs.filter((one) => one.id !== tab.id);
                const next = rest[where] ?? rest[where - 1];
                setFocused((was) => (was === tab.id ? null : was));
                setReturnTo(next?.id ?? 'add');
                onClose(tab.id);
              }}
              aria-label={SAYS.close(called(tab))}
            >
              <svg viewBox="0 0 12 12" width="9" height="9" fill="none" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* One press, one thing. A canvas is opened from the shelf, where the
          rest of the project's rooms are. */}
      <button
        type="button"
        className="tabs__add"
        ref={add}
        onClick={onNew}
        aria-label={SAYS.add}
        title={SAYS.add}
      >
        <svg viewBox="0 0 12 12" width="11" height="11" fill="none" aria-hidden="true">
          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      {/* The strip scrolls; this lists everything, marks and all, for the ones
          that have scrolled out of sight. */}
      {clipped ? (
        <div className="tabs__overflow">
          <button
            type="button"
            className="tabs__more"
            onClick={() => setListing((was) => !was)}
            aria-expanded={listing}
            aria-haspopup="menu"
            aria-label={SAYS.more}
          >
            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
              <path
                d="M2.5 4.5L6 8l3.5-3.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {listing ? (
            <div className="tabs__list scroll--auto" role="menu" aria-label={SAYS.more}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="menuitem"
                  className={`tabs__row ${tab.id === at ? 'tabs__row--here' : ''}`}
                  onClick={() => {
                    onOpen(tab.id);
                    setListing(false);
                  }}
                >
                  <Mark state={tab.state} />
                  <span className="tabs__text">
                    <span className="tabs__title">{tab.title}</span>
                    <span className="tabs__project">{tab.project}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The state, as a shape. Nothing here depends on telling one colour from
 *  another, and idle draws nothing at all. */
function Mark({ state }: { state: TabState }) {
  if (state === 'idle') return null;
  const said = SAYS.states[state];
  if (state === 'working') {
    return <span className="tabs__mark tabs__mark--working" role="img" aria-label={said} />;
  }
  if (state === 'asking') {
    /* The loudest thing on the screen, because it is the only state that cannot
       move on without a person. */
    return (
      <span className="tabs__mark tabs__mark--asking" role="img" aria-label={said}>
        <svg viewBox="0 0 12 12" width="9" height="9" fill="none">
          <path
            d="M4 4.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <circle cx="6" cy="9.4" r="0.75" fill="currentColor" />
        </svg>
      </span>
    );
  }
  return (
    <span className="tabs__mark" role="img" aria-label={said}>
      <svg viewBox="0 0 12 12" width="9" height="9" fill="none">
        <path
          d="M2 6l3 3 5-5.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
