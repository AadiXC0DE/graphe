import { useEffect, useRef, useState } from 'react';
import './Tabs.css';

/** What a tab is doing, when it is doing anything. Idle carries no mark at all:
 *  a row where every tab wears a badge is a row where none of them mean
 *  anything. */
export type TabState = 'working' | 'asking' | 'finished' | 'idle';

/** One open conversation. A tab is a conversation, not a project — that is the
 *  unit of work people switch between, and it is the only shape in which "two
 *  agents in one codebase" can be said at all. */
/** A tab is a conversation or a canvas. Both are units of work somebody
 *  switches between, which is the only thing a tab has ever meant here. */
export type TabKind = 'chat' | 'canvas';

export type Tab = {
  id: string;
  /** What this conversation is called. */
  title: string;
  kind: TabKind;
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
  /** Draw another flow in it. */
  onNewCanvas: () => void;
};

export const SAYS = {
  label: 'What you have open',
  add: 'Something new',
  newChat: 'New conversation',
  newCanvas: 'New canvas',
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
export default function Tabs({ tabs, at, onOpen, onClose, onNew, onNewCanvas }: Props) {
  const [listing, setListing] = useState(false);
  const [adding, setAdding] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!adding) return;
    const away = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setAdding(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setAdding(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [adding]);

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

  if (tabs.length === 0) {
    return (
      <div className="tabs tabs--empty" ref={root}>
        <button type="button" className="tabs__empty" onClick={onNew}>
          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" aria-hidden="true">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span>{SAYS.newChat}</span>
        </button>
      </div>
    );
  }

  // A tab strip is spatial memory. Never bring the selected tab to the front:
  // that turns a click into a moving target and makes the row impossible to
  // learn. The current tab is marked in place instead.
  const shown = tabs.slice(0, 3);
  /* A tab strip should finish where its tabs finish. Each tab is capped at
     168px (Tabs.css) and the strip reserves only that — counting any wider
     leaves a visible hole between the last tab and the add button. The
     overflow control, when there are more conversations, sits at the end. */
  const compactWidth = shown.length * 168 + 30 + (tabs.length > shown.length ? 32 : 0);

  return (
    <div className="tabs" ref={root} style={{ width: `${String(compactWidth)}px` }}>
      <div className="tabs__strip" role="tablist" aria-label={SAYS.label}>
        {shown.map((tab) => (
          <div
            key={tab.id}
            className={`tabs__tab ${tab.id === at ? 'tabs__tab--here' : ''}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === at}
              className="tabs__open"
              onClick={() => onOpen(tab.id)}
              onAuxClick={(event) => {
                // Middle click closes, the way every tab strip has for twenty
                // years. Nobody is taught this and everybody who knows it uses it.
                if (event.button === 1) onClose(tab.id);
              }}
              title={`${tab.title} (${tab.project})`}
            >
              {tab.kind === 'canvas' ? <Kind kind="canvas" /> : null}
              <Mark state={tab.state} />
              <span className="tabs__text">
                <span className="tabs__title">{tab.title}</span>
              </span>
            </button>

            <button
              type="button"
              className="tabs__close"
              onClick={() => onClose(tab.id)}
              aria-label={SAYS.close(tab.title)}
            >
              <svg viewBox="0 0 12 12" width="9" height="9" fill="none" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="tabs__new">
        <button
          type="button"
          className="tabs__add"
          onClick={() => setAdding((was) => !was)}
          aria-haspopup="menu"
          aria-expanded={adding}
          aria-label={SAYS.add}
          title={SAYS.add}
        >
          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" aria-hidden="true">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        {adding ? (
          <div className="tabs__menu" role="menu" aria-label={SAYS.add}>
            <button
              type="button"
              role="menuitem"
              className="tabs__pick"
              onClick={() => {
                setAdding(false);
                onNew();
              }}
            >
              <Kind kind="chat" slot />
              {SAYS.newChat}
            </button>
            <button
              type="button"
              role="menuitem"
              className="tabs__pick"
              onClick={() => {
                setAdding(false);
                onNewCanvas();
              }}
            >
              <Kind kind="canvas" slot />
              {SAYS.newCanvas}
            </button>
          </div>
        ) : null}
      </div>

      {/* The strip scrolls; this lists everything, marks and all, for the ones
          that have scrolled out of sight. */}
      {tabs.length > shown.length ? (
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
            <div className="tabs__list" role="menu" aria-label={SAYS.more}>
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
                  {tab.kind === 'canvas' ? <Kind kind="canvas" /> : null}
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

/** Which kind of tab it is. A conversation draws nothing — it is the ordinary
 *  one, and a row where every tab wears a mark is a row where none of them
 *  mean anything. */
function Kind({ kind, slot }: { kind: TabKind; slot?: boolean }) {
  // In a menu the mark keeps its place whether or not there is one to draw, so
  // the words line up. In the strip an empty box is 14px a tab cannot spare.
  if (kind === 'chat') return slot === true ? <span className="tabs__kind" aria-hidden="true" /> : null;
  return (
    <span className="tabs__kind" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none">
        <rect x="1.5" y="5.5" width="4.5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="10" y="1.75" width="4.5" height="4.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="10" y="9.75" width="4.5" height="4.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M6 8h2a1.5 1.5 0 0 0 1.5-1.5V6.25M6 8h2a1.5 1.5 0 0 1 1.5 1.5v0.25"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
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
