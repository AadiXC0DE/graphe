import { useEffect, useRef, useState } from 'react';
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
export default function Tabs({ tabs, at, onOpen, onClose, onNew }: Props) {
  const [listing, setListing] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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
          <span>New conversation</span>
        </button>
      </div>
    );
  }

  // A tab strip is spatial memory. Never bring the selected tab to the front:
  // that turns a click into a moving target and makes the row impossible to
  // learn. The current tab is marked in place instead.
  const shown = tabs.slice(0, 3);
  /* A tab strip should finish where its tabs finish. This is deliberately a
     comfortable working width rather than a percentage of the entire header;
     when there are more conversations, the overflow control takes over. */
  const compactWidth = shown.length * 192 + 30 + (tabs.length > shown.length ? 32 : 0);

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
              title={`${tab.title} — ${tab.project}`}
            >
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

      <button type="button" className="tabs__add" onClick={onNew} aria-label={SAYS.add} title={SAYS.add}>
        <svg viewBox="0 0 12 12" width="11" height="11" fill="none" aria-hidden="true">
          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

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
