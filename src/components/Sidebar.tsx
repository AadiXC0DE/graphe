import { cloneElement, Fragment, useEffect, useMemo, useState, type ReactElement } from 'react';
import { bridge } from '../lib/bridge';
import type { Conversation, NewerVersion, RecentProject } from '../lib/ipc';
import { ago } from '../lib/when';
import type { Reference } from '../lib/projects';
import { byDay, foldOlder, matching, needsDayLabels, needsSearch } from '../lib/shelf';
import { keepAsking, offersOwnCopy, OWN_COPY_WORDS } from '../lib/owncopy';
import './Sidebar.css';

type Props = {
  projects: readonly RecentProject[];
  openPath: string | null;
  onOpen: (project: RecentProject) => void;
  onBrowse: () => void;
  /** What the agent has been given to work from, this sitting. */
  pinned: readonly Reference[];
  /** The conversations this project has had, newest first. */
  conversations: readonly Conversation[];
  /** Which one is on screen, by its own path. */
  openConversation: string | null;
  onOpenConversation: (path: string) => void;
  onNewConversation: () => void;
  /** Throw one away. Optional so a shelf that cannot yet is still whole. */
  onDeleteConversation?: (path: string) => void;
  /** Whether the conversation on screen is working on its own copy of the
   *  project. Only the shell knows, and only about that one. */
  ownCopy?: boolean;
  /** The two ways out of a copy. Both act on the conversation on screen. */
  onBringWorkBack?: (path: string) => void;
  onThrowWorkAway?: (path: string) => void;
  /** Open the quieter controls — skills, spend, the rest. */
  onSettings?: () => void;
  /** Whether the shelf is expanded or reduced to its mark. ⌘B does the same
   *  thing as pressing the mark, and the two are one control. */
  open: boolean;
  onToggle: () => void;
  /** The three things the strip can still reach when it is folded. Each one is
   *  left out of the strip when it has nowhere to go. */
  onAsk?: () => void;
  onDesign?: () => void;
  /** Work in flight, as the graph it already is. */
  onCanvas?: () => void;
  onHistory?: () => void;
  /** The github pull requests and issues of the project in front. */
  onReviews?: () => void;
  /** Finished work waiting to be looked at, and how many pieces of it. */
  onReviewQueue?: () => void;
  reviewsWaiting?: number;
  /** Skills stay close to the work, but open as a library rather than another
      permanent section competing with conversations. */
  onSkills?: () => void;
  /** Where more can be added. Down here as well as under the project's name,
   *  because nobody finds it in a menu they never open. */
  onAddMore?: () => void;
  /** The project files are optional furniture. When their panel is folded, the
   *  way back belongs in this dock rather than as a second, stranded rail. */
  onFiles?: () => void;
  /** The clock, so a test of the day headings means something. */
  now?: number;
};

type Place = {
  id: string;
  name: string;
  tip: string;
  on: (() => void) | undefined;
  icon: React.ReactNode;
  count?: number;
};

/** The places the shelf can go, in the one order both states draw. Two
 *  hand-written lists had drifted into two orders, and the strip had no way to
 *  reach finished work at all. */
function placesOf(p: Props): readonly Place[] {
  return [
    { id: 'ask', name: 'Find anything', tip: 'Find anything (⌘K)', on: p.onAsk, icon: <FindIcon /> },
    { id: 'design', name: 'Design', tip: 'Design (⌘D)', on: p.onDesign, icon: <DesignIcon /> },
    { id: 'canvas', name: 'Canvas', tip: 'Canvas', on: p.onCanvas, icon: <CanvasIcon /> },
    { id: 'history', name: 'History', tip: 'History', on: p.onHistory, icon: <HistoryIcon /> },
    {
      id: 'review',
      name: 'Review',
      tip: 'Finished work waiting for review',
      on: p.onReviewQueue,
      icon: <ReviewIcon />,
      count: p.reviewsWaiting,
    },
    { id: 'reviews', name: 'Pull requests', tip: 'Pull requests and issues', on: p.onReviews, icon: <PullIcon /> },
    { id: 'skills', name: 'Skills', tip: 'Skills', on: p.onSkills, icon: <SkillsIcon /> },
    { id: 'files', name: 'Project files', tip: 'Project files (⌘⇧F)', on: p.onFiles, icon: <FilesIcon /> },
    { id: 'more', name: 'Add more', tip: 'Add more to Graphe', on: p.onAddMore, icon: <AddIcon /> },
    { id: 'settings', name: 'Settings', tip: 'Settings', on: p.onSettings, icon: <SettingsIcon /> },
  ].filter((one) => one.on !== undefined) as Place[];
}

/**
 * The shelf: which project, and everything said in it.
 *
 * Chat is how the work happens, so the shelf is the conversations and the way
 * to another folder, and nothing else. Anything about the project itself — what
 * it is made of, what it looks like, where it has been — lives in the panel on
 * the right, which is where somebody goes to look rather than to navigate.
 *
 * It collapses to a strip, so a small window can give the conversation
 * everything. Folded it keeps the mark and the few things worth reaching
 * without unfolding first. No animation either way: toggling a sidebar is a
 * thing people do constantly.
 */
export default function Sidebar(props: Props) {
  const {
  projects,
  openPath,
  onOpen,
  onBrowse,
  pinned,
  conversations,
  openConversation,
  onOpenConversation,
  onNewConversation,
  onDeleteConversation,
  ownCopy = false,
  onBringWorkBack,
  onThrowWorkAway,
  open,
  onToggle,
  now,
  } = props;
  const places = useMemo(() => placesOf(props), [props]);
  const [term, setTerm] = useState('');
  /** Which row has an "are you sure" standing over it, by its own path. */
  const [asking, setAsking] = useState<string | null>(null);
  const asked = keepAsking(asking, openConversation);

  const searchable = needsSearch(conversations.length);
  const found = useMemo(
    () => (searchable ? matching(conversations, term) : conversations),
    [conversations, searchable, term],
  );
  const days = useMemo(() => {
    const at = now ?? Date.now();
    // Past a month nobody is looking for Tuesday, so the dates stop and the
    // search field takes over.
    return foldOlder(byDay(found, at), at);
  }, [found, now]);
  const labelled = needsDayLabels(days);

  return (
    <aside className={`shelf ${open ? '' : 'shelf--closed'}`} aria-label="Projects">
      {open ? (
        <>
          <div className="shelf__top">
            <span className="shelf__caption" id="shelf-projects">Projects</span>
            <button
              type="button"
              className="shelf__collapse"
              onClick={onToggle}
              aria-label="Hide sidebar"
              title="Hide sidebar ⌘B"
            >
              <SidebarIcon size={14} />
            </button>
          </div>
          {/* Projects are the primary navigation. Keep the current one in the
              same list as the rest, visibly selected, so the screen answers
              both “where am I?” and “where else can I go?” at a glance. */}
          <ul className="shelf__list">
            {projects
              .map((project) => (
                <li key={project.path}>
                  <button
                    type="button"
                    className={`shelf__row ${project.path === openPath ? 'shelf__row--project-here' : ''}`}
                    onClick={() => {
                      if (project.path !== openPath) onOpen(project);
                    }}
                    aria-current={project.path === openPath ? 'page' : undefined}
                    title={project.missing ? 'This folder is not where it was' : project.path}
                  >
                    <span
                      className={`shelf__rowname ${project.missing ? 'shelf__rowname--gone' : ''}`}
                    >
                      {project.name}
                    </span>
                  </button>
                </li>
              ))}
            <li>
              <button type="button" className="shelf__row shelf__row--quiet" onClick={onBrowse}>
                <span className="shelf__rowname">Open another folder…</span>
              </button>
            </li>
          </ul>

          {/* Everything said in this folder, newest first. The rail's whole job
              is this project, and this is the biggest thing there is to say
              about it. Only this band scrolls — the projects, the work to use
              and the foot stay put — so a long history never rides the whole
              shelf off the bottom of the window. */}
          <section className="shelf__band shelf__band--scroll">
            <div className="shelf__bandtop">
              <h2 className="shelf__caption">Conversations</h2>
              <button
                type="button"
                className="shelf__new"
                onClick={onNewConversation}
                title="Start a new conversation in this project"
                aria-label="Start a new conversation"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M8 3.5v9M3.5 8h9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            {/* The field waits until a column of names is too long to read at
                a glance; before that it is one more thing in the way. */}
            {searchable ? (
              <input
                className="shelf__find"
                type="search"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Find a conversation"
                aria-label="Find a conversation"
              />
            ) : null}
            {conversations.length === 0 ? (
              <p className="shelf__none">Nothing said here yet.</p>
            ) : found.length === 0 ? (
              <p className="shelf__none">Nothing here matches that.</p>
            ) : (
              days.map((day) => (
                <div className="shelf__day" key={day.key}>
                  {labelled ? <h3 className="shelf__daylabel">{day.label}</h3> : null}
                  <ul className="shelf__list">
                    {day.items.map((one) => (
                      <Fragment key={one.id}>
                        <li className="shelf__convo">
                          <button
                            type="button"
                            className={`shelf__row ${one.path === openConversation ? 'shelf__row--here' : ''}`}
                            onClick={() => {
                              setAsking(null);
                              onOpenConversation(one.path);
                            }}
                          >
                            <span className="shelf__rowname">{one.title}</span>
                            <span className="shelf__rowsub">{ago(one.at)}</span>
                          </button>
                          {onDeleteConversation === undefined ? null : (
                            <button
                              type="button"
                              className="shelf__forget"
                              title="Delete conversation"
                              aria-label={`Throw away “${one.title}”`}
                              onClick={(event) => {
                                event.stopPropagation();
                                onDeleteConversation(one.path);
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <path
                                  d="M3 3l6 6M9 3l-6 6"
                                  stroke="currentColor"
                                  strokeWidth="1.4"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                          )}
                        </li>
                        {/* Under the row rather than another mark on it: a copy
                            of your project that nothing on screen mentions is how
                            an afternoon's work gets left behind. */}
                        {offersOwnCopy(one.path, openConversation, ownCopy) &&
                        onBringWorkBack !== undefined &&
                        onThrowWorkAway !== undefined ? (
                          <li className="shelf__owncopy">
                            <p className="shelf__owncopysays">{OWN_COPY_WORDS.says}</p>
                            {asked === one.path ? (
                              <>
                                <p className="shelf__owncopysure">{OWN_COPY_WORDS.sure}</p>
                                <div className="shelf__owncopyrow">
                                  {/* Keeping it first, so it is also first for
                                      the keyboard, and it carries the weight. */}
                                  <button
                                    type="button"
                                    className="shelf__owncopydo shelf__owncopydo--keep"
                                    onClick={() => setAsking(null)}
                                  >
                                    {OWN_COPY_WORDS.no}
                                  </button>
                                  <button
                                    type="button"
                                    className="shelf__owncopydo"
                                    onClick={() => {
                                      setAsking(null);
                                      onThrowWorkAway(one.path);
                                    }}
                                  >
                                    {OWN_COPY_WORDS.yes}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="shelf__owncopyrow">
                                <button
                                  type="button"
                                  className="shelf__owncopydo"
                                  title={OWN_COPY_WORDS.bringHint}
                                  onClick={() => onBringWorkBack(one.path)}
                                >
                                  {OWN_COPY_WORDS.bring}
                                </button>
                                <button
                                  type="button"
                                  className="shelf__owncopydo"
                                  title={OWN_COPY_WORDS.awayHint}
                                  onClick={() => setAsking(one.path)}
                                >
                                  {OWN_COPY_WORDS.away}
                                </button>
                              </div>
                            )}
                          </li>
                        ) : null}
                      </Fragment>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>

          {pinned.length === 0 ? null : (
            <section className="shelf__band">
              <h2 className="shelf__caption">Working from</h2>
              <ul className="shelf__list">
                {pinned.map((one) => (
                  <li key={one.id} className="shelf__pin">
                    {one.kind === 'image' && one.preview !== undefined ? (
                      <img className="shelf__thumb" src={one.preview} alt="" />
                    ) : (
                      <span className="shelf__thumb shelf__thumb--none" aria-hidden="true" />
                    )}
                    <span className="shelf__rowname">{one.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* The last row and never a band: it sits under the work rather than
              beside it, and stays put while the conversations scroll. */}
          {places.length === 0 ? null : (
            <div className="shelf__foot">
              <NewerBuild />
              {places.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  className={`shelf__row shelf__row--quiet shelf__more ${one.id === 'settings' ? 'shelf__more--last' : ''}`}
                  onClick={one.on}
                  title={one.tip}
                >
                  <span className="shelf__moremark" aria-hidden="true">{one.icon}</span>
                  <span className="shelf__rowname">{one.name}</span>
                  {one.count === undefined || one.count === 0 ? null : (
                    <span className="shelf__count">{String(one.count)}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="shelf__thin">
          <button
            type="button"
            className="shelf__mark"
            onClick={onToggle}
            aria-label="Show sidebar"
            aria-expanded={open}
            data-tip="Show sidebar ⌘B"
          >
            <SidebarIcon />
          </button>
          <span className="shelf__thinline" aria-hidden="true" />
          <button
            type="button"
            className="shelf__act"
            onClick={onNewConversation}
            aria-label="Start a new conversation"
            data-tip="New conversation"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 3.5v9M3.5 8h9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {places.map((one) => (
            <button
              key={one.id}
              type="button"
              className={`shelf__act ${one.id === 'settings' ? 'shelf__act--last' : ''}`}
              onClick={one.on}
              aria-label={one.name}
              data-tip={one.tip}
            >
              {cloneElement(one.icon as ReactElement<IconProps>, { size: 16 })}
              {one.count === undefined || one.count === 0 ? null : (
                <span className="shelf__actcount" aria-hidden="true">{String(one.count)}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

/**
 * A build newer than this one, said once and quietly.
 *
 * It used to arrive as a line in whichever conversation happened to be open,
 * and with no project open it went nowhere at all. This is a row: what is out,
 * what changed, and the one command to get it, ready to copy.
 */
function NewerBuild() {
  const [out, setOut] = useState<NewerVersion | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => bridge.onNewerVersion(setOut), []);
  if (out === null) return null;
  return (
    <div className="shelf__newer">
      <span className="shelf__newername">{out.version} is out</span>
      <a
        className="shelf__newerlink"
        href={`https://github.com/AadiXC0DE/graphe/releases/tag/v${out.version}`}
        target="_blank"
        rel="noreferrer"
      >
        What changed
      </a>
      <button
        type="button"
        className="shelf__newerlink"
        onClick={() => {
          void navigator.clipboard.writeText(out.upgrade).then(() => setCopied(true));
        }}
      >
        {copied ? 'Copied' : `Copy ${out.upgrade}`}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The marks. One each, so the two sidebar states draw the same list.
   --------------------------------------------------------------------------- */

type IconProps = { size?: number };

function FindIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.25 10.25 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DesignIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.25c2 2.2 3.75 4.25 3.75 6.25a3.75 3.75 0 1 1-7.5 0c0-2 1.75-4.05 3.75-6.25Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CanvasIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
  );
}

function HistoryIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="5" cy="3.75" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="12.25" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="12.25" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 5.25v5.5M5 7.75h3.5A2.5 2.5 0 0 1 11 10.25v.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ReviewIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8.2 6 11.2l7-7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PullIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5 2.5h6a1.5 1.5 0 0 1 1.5 1.5v8.5H5a1.5 1.5 0 0 0-1.5 1.5V4A1.5 1.5 0 0 1 5 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M5 6h5M5 8.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function FilesIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h3l1.2 1.5h6.3v5.5H2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function AddIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5.75v4.5M5.75 8h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon({ size = 14 }: IconProps) {
  /* Two sliders, not a burst: eight rays cannot resolve at this size. */
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4.75h11M2.5 11.25h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6" cy="4.75" r="1.85" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10.5" cy="11.25" r="1.85" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** The one mark that is a letter. A component like the rest, so the strip can
 *  ask every mark for 16px without knowing which is which. */
function SkillsIcon({ size = 14 }: IconProps) {
  return (
    <span aria-hidden="true" style={{ fontSize: `${String(size)}px`, lineHeight: 1 }}>
      @
    </span>
  );
}

/** The sidebar glyph every mac app uses, so both states share one control. */
function SidebarIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 2.75v10.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
