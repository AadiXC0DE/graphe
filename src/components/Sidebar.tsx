import { Fragment, useMemo, useState } from 'react';
import type { Conversation, RecentProject } from '../lib/ipc';
import { ago } from '../lib/when';
import type { Reference } from '../lib/projects';
import { byDay, matching, needsDayLabels, needsSearch } from '../lib/shelf';
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
export default function Sidebar({
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
  onSettings,
  open,
  onToggle,
  onAsk,
  onDesign,
  onCanvas,
  onHistory,
  onReviews,
  onSkills,
  onAddMore,
  onFiles,
  now,
}: Props) {
  const [term, setTerm] = useState('');
  /** Which row has an "are you sure" standing over it, by its own path. */
  const [asking, setAsking] = useState<string | null>(null);
  const asked = keepAsking(asking, openConversation);

  const searchable = needsSearch(conversations.length);
  const found = useMemo(
    () => (searchable ? matching(conversations, term) : conversations),
    [conversations, searchable, term],
  );
  const days = useMemo(() => byDay(found, now ?? Date.now()), [found, now]);
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
              aria-label="Collapse the sidebar"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M9.5 4 5.5 8l4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
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
                              title="Throw this conversation away"
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
          {onAsk === undefined && onDesign === undefined && onCanvas === undefined && onHistory === undefined &&
            onReviews === undefined && onAddMore === undefined && onSkills === undefined && onSettings === undefined ? null : (
            <div className="shelf__foot">
              {onAsk === undefined ? null : (
                <button
                  type="button"
                  className="shelf__row shelf__row--quiet shelf__more"
                  onClick={onAsk}
                  title="Find anything (⌘K)"
                >
                  <span className="shelf__moremark" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
                      <path d="m10.25 10.25 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="shelf__rowname">Find anything</span>
                </button>
              )}
              {onDesign === undefined ? null : (
                <button
                  type="button"
                  className="shelf__row shelf__row--quiet shelf__more"
                  onClick={onDesign}
                  title="Colour, type and spacing (⌘D)"
                >
                  <span className="shelf__moremark" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M8 2.25c2 2.2 3.75 4.25 3.75 6.25a3.75 3.75 0 1 1-7.5 0c0-2 1.75-4.05 3.75-6.25Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="shelf__rowname">Design</span>
                </button>
              )}
              {onCanvas === undefined ? null : (
                <button
                  type="button"
                  className="shelf__row shelf__row--quiet shelf__more"
                  onClick={onCanvas}
                  title="Every step, and what waits for what"
                >
                  <span className="shelf__moremark" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
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
                  <span className="shelf__rowname">Canvas</span>
                </button>
              )}
              {onHistory === undefined ? null : (
                <button
                  type="button"
                  className="shelf__row shelf__row--quiet shelf__more"
                  onClick={onHistory}
                  title="Every moment, and what came after what"
                >
                  <span className="shelf__moremark" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
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
                  </span>
                  <span className="shelf__rowname">History</span>
                </button>
              )}
              {onReviews === undefined ? null : (
                <button
                  type="button"
                  className="shelf__row shelf__row--quiet shelf__more"
                  onClick={onReviews}
                  title="The pull requests and issues of this project"
                >
                  <span className="shelf__moremark" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M5 2.5h6a1.5 1.5 0 0 1 1.5 1.5v8.5H5a1.5 1.5 0 0 0-1.5 1.5V4A1.5 1.5 0 0 1 5 2.5Z"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                      <path d="M5 6h5M5 8.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="shelf__rowname">Pull requests</span>
                </button>
              )}
              {onSettings === undefined ? null : (
                <button
                  type="button"
                  className="shelf__row shelf__row--quiet shelf__more"
                  onClick={onSettings}
                  title="Skills, spend, and the rest"
                >
                  <span className="shelf__moremark" aria-hidden="true">
                    {/* Two sliders, not a burst. Eight 1.4px rays at 1.4px
                        wide cannot resolve at this size — it read as a smudge
                        beside marks that read cleanly. */}
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M2.5 4.75h11M2.5 11.25h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      <circle cx="6" cy="4.75" r="1.85" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4" />
                      <circle cx="10.5" cy="11.25" r="1.85" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4" />
                    </svg>
                  </span>
                  <span className="shelf__rowname">Settings</span>
                </button>
              )}
              {onSkills === undefined ? null : (
                <button type="button" className="shelf__row shelf__row--quiet shelf__more" onClick={onSkills} title="Browse skills and use one with @">
                  <span className="shelf__moremark" aria-hidden="true">@</span>
                  <span className="shelf__rowname">Skills</span>
                </button>
              )}
              {onAddMore === undefined ? null : <button
                type="button"
                className="shelf__row shelf__row--quiet shelf__more"
                onClick={onAddMore}
                title="Give Graphe new things it can do for you"
              >
                <span className="shelf__moremark" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect
                      x="2.5"
                      y="2.5"
                      width="11"
                      height="11"
                      rx="3.25"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M8 5.75v4.5M5.75 8h4.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <span className="shelf__rowname">Add more to Graphe</span>
              </button>}
              {onFiles === undefined ? null : (
                <button
                  type="button"
                  className="shelf__row shelf__row--quiet shelf__more"
                  onClick={onFiles}
                  title="Open project files"
                >
                  <span className="shelf__moremark" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M2.5 4.5h3l1.2 1.5h6.3v5.5H2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="shelf__rowname">Project files</span>
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="shelf__thin">
          <button
            type="button"
            className="shelf__mark"
            onClick={onToggle}
            aria-label="Expand the sidebar"
            aria-expanded={open}
            data-tip="Show the sidebar"
          >
            <span className="shelf__markdot" aria-hidden="true" />
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
          {onAsk === undefined ? null : (
            <button
              type="button"
              className="shelf__act"
              onClick={onAsk}
              aria-label="Find anything"
              data-tip="Find anything (⌘K)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle
                  cx="7"
                  cy="7"
                  r="4.25"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="m10.25 10.25 3 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          {onDesign === undefined ? null : (
            <button
              type="button"
              className="shelf__act"
              onClick={onDesign}
              aria-label="How this project looks"
              data-tip="Design (⌘D)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 2.25c2 2.2 3.75 4.25 3.75 6.25a3.75 3.75 0 1 1-7.5 0c0-2 1.75-4.05 3.75-6.25Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          {onSkills === undefined ? null : (
            <button type="button" className="shelf__act shelf__act--skills" onClick={onSkills} aria-label="Browse skills" data-tip="Skills">
              @
            </button>
          )}
          {onCanvas === undefined ? null : (
            <button
              type="button"
              className="shelf__act"
              onClick={onCanvas}
              aria-label="Open the canvas"
              data-tip="Canvas"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
            </button>
          )}
          {onHistory === undefined ? null : (
            <button
              type="button"
              className="shelf__act"
              onClick={onHistory}
              aria-label="Where this project has been"
              data-tip="History"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
            </button>
          )}
          {onReviews === undefined ? null : (
            <button
              type="button"
              className="shelf__act"
              onClick={onReviews}
              aria-label="Open pull requests"
              data-tip="Pull requests"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M5 2.5h6a1.5 1.5 0 0 1 1.5 1.5v8.5H5a1.5 1.5 0 0 0-1.5 1.5V4A1.5 1.5 0 0 1 5 2.5Z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
                <path d="M5 6h5M5 8.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {onAddMore === undefined ? null : (
            <button
              type="button"
              className="shelf__act"
              onClick={onAddMore}
              aria-label="Add more to Graphe"
              data-tip="Add more to Graphe"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect
                  x="2.5"
                  y="2.5"
                  width="11"
                  height="11"
                  rx="3.25"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M8 5.75v4.5M5.75 8h4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          {onFiles === undefined ? null : (
            <button
              type="button"
              className="shelf__act"
              onClick={onFiles}
              aria-label="Open project files"
              data-tip="Project files"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2.5 4.5h3l1.2 1.5h6.3v5.5H2.5z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {onSettings === undefined ? null : (
            <button
              type="button"
              className="shelf__act shelf__act--settings"
              onClick={onSettings}
              aria-label="Open settings"
              data-tip="Settings"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2.5 4.75h11M2.5 11.25h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <circle cx="6" cy="4.75" r="1.85" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="10.5" cy="11.25" r="1.85" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
