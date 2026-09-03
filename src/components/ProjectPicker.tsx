import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RecentProject } from '../lib/ipc';
import { formatMoney } from '../cost/money';
import { ago } from '../lib/when';
import './ProjectPicker.css';

type Props = {
  projects: readonly RecentProject[];
  /** Work in this one. Never called for a project that has gone missing. */
  onOpen: (project: RecentProject) => void;
  /** Remove the list. The folder itself is never touched. */
  onForget: (project: RecentProject) => void;
  /** Go and find a folder that is not on the list. */
  onBrowse: () => void;
  /** The one currently open, so the switcher can say which that is. */
  openPath?: string | null;
  /** Set when this is a switcher hanging under the project's name rather than
   *  the first thing somebody sees. It says less, and it says it smaller. */
  compact?: boolean;
};

/** The recent ones, and no more. A list long enough to scroll is a list you
 *  read instead of recognising — the folder you want is almost always one of
 *  the last few, and everything else is one press of "Open another folder". */
export const MOST_SHOWN = 5;

export const SAYS = {
  returning: 'Where were we?',
  first: 'Open a project folder to start.',
  firstNote: 'Describe a change; Graphe works in your files and every step can be put back.',
  keys: '↑↓ to choose, Enter to open',
  gone: 'Not where it was',
  browse: 'Open another folder…',
  browseFirst: 'Open a project folder',
  privacy:
    'Prompts go to the model you chose, on your account. Keys and history stay on this computer.',
  spent: (money: string): string => `${money} last time`,
} as const;

/**
 * A hue per project, stable for the life of the name.
 *
 * Recognising a folder by its colour only works if the colour never moves, so
 * it is derived rather than assigned.
 */
export function hueOf(name: string): number {
  let hash = 0;
  for (let at = 0; at < name.length; at += 1) {
    hash = (hash * 31 + name.charCodeAt(at)) % 360000;
  }
  return hash % 360;
}

/** The second line of a row: where the folder is up to, and when. */
function metaOf(project: RecentProject): string {
  const when = ago(project.lastOpenedAt);
  return project.branch === null ? when : `${project.branch} · ${when}`;
}

/** Everything that is not the name, kept where a pointer can ask for it. */
function titleOf(project: RecentProject): string {
  if (project.lastSpend === null) return project.path;
  return `${project.path} · ${SAYS.spent(formatMoney(project.lastSpend))}`;
}

/**
 * Where were we.
 *
 * First screen of every sitting. A masked dot grid, the mark, and the list —
 * which is the whole job, so it is the only thing with weight on the page. The
 * colour tile is how a folder is recognised before the name is read.
 */
export default function ProjectPicker({
  projects,
  onOpen,
  onForget,
  onBrowse,
  openPath,
  compact,
}: Props) {
  const firstRun = projects.length === 0;
  const shown = projects.slice(0, MOST_SHOWN);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const [at, setAt] = useState(0);

  const press = useCallback(
    (project: RecentProject | undefined) => {
      if (project === undefined) return;
      if (project.missing) onForget(project);
      else onOpen(project);
    },
    [onForget, onOpen],
  );

  /* The first row is the one under the hand on arrival: this screen exists to
     be pressed, and one press should not have to start with a click. */
  useEffect(() => {
    if (compact === true || firstRun) return;
    rows.current[0]?.focus();
  }, [compact, firstRun]);

  /* Numbers and the browse key belong to the whole screen; in the switcher they
     would fight the window behind it. */
  useEffect(() => {
    if (compact === true) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        onBrowse();
        return;
      }
      const nth = Number(event.key);
      if (!Number.isInteger(nth) || nth < 1 || nth > MOST_SHOWN) return;
      const project = projects.slice(0, MOST_SHOWN)[nth - 1];
      if (project === undefined) return;
      event.preventDefault();
      press(project);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact, onBrowse, press, projects]);

  const move = (from: number, by: number): void => {
    const next = Math.min(shown.length - 1, Math.max(0, from + by));
    setAt(next);
    rows.current[next]?.focus();
  };

  return (
    <section
      className={`picker ${compact ? 'picker--compact' : ''} ${firstRun && !compact ? 'picker--first' : ''}`}
    >
      {compact ? null : (
        <header className="picker__brand">
          <div className="picker__mark" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="12" className="picker__markfill" />
              {/* Node + edge: a G that is also a small graph. */}
              <circle cx="14" cy="20" r="3.2" className="picker__markink" />
              <circle cx="26" cy="13" r="2.4" className="picker__markink" />
              <circle cx="26" cy="27" r="2.4" className="picker__markink" />
              <path
                d="M16.6 18.4 23.8 14.2M16.6 21.6 23.8 25.8"
                className="picker__markline"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M20.5 20h6.2"
                className="picker__markline"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <p className="picker__product">Graphe</p>
          <h1 className="picker__title">{firstRun ? SAYS.first : SAYS.returning}</h1>
          {firstRun ? <p className="picker__sub">{SAYS.firstNote}</p> : null}
        </header>
      )}

      {firstRun ? null : (
        <ul className="picker__list" aria-label="Recent projects">
          {shown.map((project, nth) => (
            <li
              key={project.path}
              className={`pickerrow ${project.missing ? 'pickerrow--missing' : ''} ${project.path === openPath ? 'pickerrow--open' : ''}`}
            >
              <button
                type="button"
                ref={(node) => {
                  rows.current[nth] = node;
                }}
                className="pickerrow__open"
                title={titleOf(project)}
                onClick={() => press(project)}
                onFocus={() => setAt(nth)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    move(nth, 1);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    move(nth, -1);
                  }
                }}
                tabIndex={compact === true || nth === at ? 0 : -1}
                aria-current={project.path === openPath ? 'true' : undefined}
                aria-describedby={project.missing ? `${project.path}-gone` : undefined}
              >
                <span
                  className="pickerrow__tile"
                  style={{ '--tile-hue': hueOf(project.name) } as CSSProperties}
                  aria-hidden="true"
                >
                  {project.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="pickerrow__copy">
                  <span className="pickerrow__name">{project.name}</span>
                  <span className="pickerrow__meta" id={`${project.path}-gone`}>
                    {project.missing ? SAYS.gone : metaOf(project)}
                  </span>
                </span>
              </button>

              {project.path === openPath && !project.missing ? (
                <span className="pickerrow__badge">Open</span>
              ) : (
                <button
                  type="button"
                  className="pickerrow__forget"
                  onClick={() => onForget(project)}
                  aria-label={`Take ${project.name} off the list`}
                  title="Take off the list"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {firstRun || compact ? null : <p className="picker__hint">{SAYS.keys}</p>}

      <button
        type="button"
        className={`picker__browse ${firstRun && !compact ? 'picker__browse--primary' : ''}`}
        onClick={onBrowse}
      >
        <span>{firstRun ? SAYS.browseFirst : SAYS.browse}</span>
        <kbd className="picker__key" aria-hidden="true">
          ⌘O
        </kbd>
      </button>

      {compact ? null : <p className="picker__foot">{SAYS.privacy}</p>}
    </section>
  );
}
