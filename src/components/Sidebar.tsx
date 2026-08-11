import ProjectPicker from './ProjectPicker';
import type { RecentProject } from '../lib/ipc';
import './Sidebar.css';

type Props = {
  projects: readonly RecentProject[];
  openPath: string | null;
  onOpen: (project: RecentProject) => void;
  onForget: (project: RecentProject) => void;
  onBrowse: () => void;
  /** Whether the shelf is expanded or reduced to its mark. ⌘B does the same
   *  thing as pressing the mark, and the two are one control. */
  open: boolean;
  onToggle: () => void;
};

/**
 * The shelf: the permanent projects list on the left.
 *
 * The interface earns its complexity (notes/strategy/UI-DESIGN.md), and the
 * one thing this region has to say is "which project, and get to another one" —
 * so it appears only once a folder is actually open, and it hosts exactly the
 * list that statement needs. Everything else about *this project* — the way
 * out, the switch that shows the machinery — stays under the project's name in
 * the top bar, exactly where it has always been: a person who wants the wheel
 * is a person who already knows where the wheel lives.
 *
 * It collapses to a strip holding only the mark, so a small window can give the
 * conversation everything. No animation either way: toggling a sidebar is a
 * thing people do constantly, and the frequency rule in UI-DESIGN.md bans
 * motion on the things people see a hundred times a day.
 *
 * The list itself is the project picker wearing its compact form — the same
 * rows, the same "Open" badge, the same treatment of a folder that is not
 * there any more — stripped of its heading, which the caption above supplies.
 */
export default function Sidebar({
  projects,
  openPath,
  onOpen,
  onForget,
  onBrowse,
  open,
  onToggle,
}: Props) {
  return (
    <aside className={`shelf ${open ? '' : 'shelf--closed'}`} aria-label="Projects">
      {open ? (
        <>
          <div className="shelf__top">
            <span className="shelf__caption" id="shelf-projects">
              Projects
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
          <ProjectPicker
            projects={projects}
            onOpen={onOpen}
            onForget={onForget}
            onBrowse={onBrowse}
            openPath={openPath}
            compact
          />
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