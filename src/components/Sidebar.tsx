import type { Conversation, Page, RecentProject } from '../lib/ipc';
import { ago } from '../lib/when';
import type { Reference } from '../lib/projects';
import './Sidebar.css';

type Props = {
  projects: readonly RecentProject[];
  openPath: string | null;
  onOpen: (project: RecentProject) => void;
  onBrowse: () => void;
  /** The screens the open project has. Empty when its shape is not one we
   *  recognise, in which case the band does not appear. */
  pages: readonly Page[];
  /** Open the live preview at one of them. */
  onOpenPage: (page: Page) => void;
  /** What the agent has been given to work from, this sitting. */
  pinned: readonly Reference[];
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
  pinned,
  conversations,
  openConversation,
  onOpenConversation,
  onNewConversation,
  open,
  onToggle,
}: Props) {
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
            {conversations.length === 0 ? (
              <p className="shelf__none">Nothing said here yet.</p>
            ) : (
              <ul className="shelf__list">
                {conversations.map((one) => (
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
            )}
          </section>

          {pages.length === 0 ? null : (
            <section className="shelf__band">
              <h2 className="shelf__caption">Pages</h2>
              <ul className="shelf__list">
                {pages.map((page) => (
                  <li key={page.route}>
                    <button
                      type="button"
                      className="shelf__row"
                      onClick={() => onOpenPage(page)}
                      title={`Open ${page.route} in your browser`}
                    >
                      <span className="shelf__rowname">{page.name}</span>
                      <span className="shelf__rowsub">{page.route}</span>
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