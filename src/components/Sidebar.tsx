import { useMemo, useState } from 'react';
import type { Conversation, RecentProject } from '../lib/ipc';
import { ago } from '../lib/when';
import type { Reference } from '../lib/projects';
import {
  byDay,
  cleanPageName,
  markOf,
  matching,
  needsDayLabels,
  needsSearch,
  partsInOrder,
  type Part,
  type ShelfPage,
} from '../lib/shelf';
import './Sidebar.css';

type Props = {
  projects: readonly RecentProject[];
  openPath: string | null;
  onOpen: (project: RecentProject) => void;
  onBrowse: () => void;
  /** The screens the open project has. Empty when its shape is not one we
   *  recognise, in which case the band does not appear. Anything extra a page
   *  carries — a picture, whether it is the one on screen, whether it moved,
   *  what is wrong with it — is drawn when it is there and skipped when it is
   *  not. */
  pages: readonly ShelfPage[];
  /** Open the live preview at one of them. */
  onOpenPage: (page: ShelfPage) => void;
  /** Ask for a screen that does not exist yet, by the name it should have. */
  onAddPage?: (name: string) => void;
  /** What the agent has been given to work from, this sitting. */
  pinned: readonly Reference[];
  /** The pieces this project is built from. The band stays away until there
   *  are some. */
  parts?: readonly Part[];
  onOpenPart?: (part: Part) => void;
  /** The conversations this project has had, newest first. */
  conversations: readonly Conversation[];
  /** Which one is on screen, by its own path. */
  openConversation: string | null;
  onOpenConversation: (path: string) => void;
  onNewConversation: () => void;
  /** Whether the shelf is expanded or reduced to its mark. ⌘B does the same
   *  thing as pressing the mark, and the two are one control. */
  open: boolean;
  onToggle: () => void;
  /** The clock, so a test of the day headings means something. */
  now?: number;
};

/**
 * The shelf: what this project is, down the left.
 *
 * Its heading is the folder you are in, and everything under it is about that
 * folder — the screens it has, what the agent was given to work from — with the
 * way to another project as one quiet row rather than a list of everywhere this
 * machine has ever been.
 *
 * It collapses to a strip holding only the mark, so a small window can give the
 * conversation everything. No animation either way: toggling a sidebar is a
 * thing people do constantly.
 */
export default function Sidebar({
  projects,
  openPath,
  onOpen,
  onBrowse,
  pages,
  onOpenPage,
  onAddPage,
  pinned,
  parts,
  onOpenPart,
  conversations,
  openConversation,
  onOpenConversation,
  onNewConversation,
  open,
  onToggle,
  now,
}: Props) {
  const [term, setTerm] = useState('');
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');

  const searchable = needsSearch(conversations.length);
  const found = useMemo(
    () => (searchable ? matching(conversations, term) : conversations),
    [conversations, searchable, term],
  );
  const days = useMemo(() => byDay(found, now ?? Date.now()), [found, now]);
  const labelled = needsDayLabels(days);

  const pieces = useMemo(() => partsInOrder(parts ?? []), [parts]);

  function askForPage() {
    const name = cleanPageName(newName);
    if (name !== null) onAddPage?.(name);
    setNewName('');
    setNaming(false);
  }

  return (
    <aside className={`shelf ${open ? '' : 'shelf--closed'}`} aria-label="Projects">
      {open ? (
        <>
          <div className="shelf__top">
            <span className="shelf__caption" id="shelf-projects">
              {projects.find((one) => one.path === openPath)?.name ?? 'Projects'}
            </span>
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
          {/* Which project, and the way to another one. A list of every folder
              this machine remembers is not what somebody already working in one
              needs down the side of their work — it is one row and a menu. */}
          <ul className="shelf__list">
            {projects
              .filter((one) => one.path !== openPath)
              .slice(0, 3)
              .map((project) => (
                <li key={project.path}>
                  <button
                    type="button"
                    className="shelf__row"
                    onClick={() => onOpen(project)}
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
              about it. */}
          <section className="shelf__band">
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
                      <li key={one.id}>
                        <button
                          type="button"
                          className={`shelf__row ${one.path === openConversation ? 'shelf__row--here' : ''}`}
                          onClick={() => onOpenConversation(one.path)}
                        >
                          <span className="shelf__rowname">{one.title}</span>
                          <span className="shelf__rowsub">{ago(one.at)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>

          {pages.length === 0 && onAddPage === undefined ? null : (
            <section className="shelf__band">
              <div className="shelf__bandtop">
                <h2 className="shelf__caption">Pages</h2>
                {onAddPage === undefined ? null : (
                  <button
                    type="button"
                    className="shelf__new"
                    onClick={() => setNaming(true)}
                    title="Add a page to this project"
                    aria-label="Add a page"
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
                )}
              </div>
              {naming ? (
                <form
                  className="shelf__naming"
                  onSubmit={(event) => {
                    event.preventDefault();
                    askForPage();
                  }}
                >
                  <input
                    className="shelf__find"
                    autoFocus
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    onBlur={askForPage}
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return;
                      setNewName('');
                      setNaming(false);
                    }}
                    placeholder="What should it be called?"
                    aria-label="What the new page should be called"
                  />
                </form>
              ) : null}
              {pages.length === 0 ? (
                <p className="shelf__none">No pages here yet.</p>
              ) : (
                <ul className="shelf__list">
                  {pages.map((page) => {
                    const mark = markOf(page);
                    return (
                      <li key={page.route}>
                        <button
                          type="button"
                          className={`shelf__row shelf__page ${mark.showing ? 'shelf__row--here' : ''}`}
                          onClick={() => onOpenPage(page)}
                          title={
                            mark.says === null
                              ? `Open ${page.route} in your browser`
                              : `Open ${page.route} in your browser — ${mark.says.toLowerCase()}`
                          }
                        >
                          {page.picture === undefined ? (
                            <span className="shelf__shot shelf__shot--none" aria-hidden="true" />
                          ) : (
                            <img className="shelf__shot" src={page.picture} alt="" />
                          )}
                          <span className="shelf__pagewords">
                            <span className="shelf__rowname">{page.name}</span>
                            <span className="shelf__rowsub">{page.route}</span>
                          </span>
                          <span className="shelf__marks">
                            {mark.problems === 0 ? null : (
                              <span className="shelf__count">{mark.problems}</span>
                            )}
                            {mark.showing ? (
                              <span className="shelf__dot shelf__dot--live" aria-hidden="true" />
                            ) : mark.changed ? (
                              <span className="shelf__dot shelf__dot--moved" aria-hidden="true" />
                            ) : null}
                          </span>
                          {mark.says === null ? null : (
                            <span className="shelf__says">{mark.says}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {/* The pieces the project is made of, in the words somebody would use
              asking for a change to one. */}
          {pieces.length === 0 ? null : (
            <section className="shelf__band">
              <h2 className="shelf__caption">Made of</h2>
              <ul className="shelf__list shelf__parts">
                {pieces.map((part) => (
                  <li key={part.id}>
                    <button
                      type="button"
                      className="shelf__row shelf__part"
                      onClick={() => onOpenPart?.(part)}
                      disabled={onOpenPart === undefined}
                      title={part.file ?? part.name}
                    >
                      <span className="shelf__rowname">{part.name}</span>
                      {part.uses === undefined || part.uses <= 0 ? null : (
                        <span className="shelf__uses">{part.uses}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

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
        </>
      ) : (
        <div className="shelf__thin">
          <button
            type="button"
            className="shelf__mark"
            onClick={onToggle}
            aria-label="Expand the sidebar"
            aria-expanded={open}
          >
            <span className="shelf__markdot" aria-hidden="true" />
          </button>
        </div>
      )}
    </aside>
  );
}