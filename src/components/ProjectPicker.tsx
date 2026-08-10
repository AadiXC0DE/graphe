import type { RecentProject } from '../lib/ipc';
import { formatMoney } from '../cost/money';
import { ago } from '../lib/when';
import './ProjectPicker.css';

type Props = {
  projects: readonly RecentProject[];
  /** Work in this one. Never called for a project that has gone missing. */
  onOpen: (project: RecentProject) => void;
  /** Take it off the list. The folder itself is never touched. */
  onForget: (project: RecentProject) => void;
  /** Go and find a folder that is not on the list. */
  onBrowse: () => void;
  /** The one currently open, so the switcher can say which that is. */
  openPath?: string | null;
  /** Set when this is a switcher hanging under the project's name rather than
   *  the first thing somebody sees. It says less, and it says it smaller. */
  compact?: boolean;
};

/**
 * Where were we.
 *
 * BACKLOG A4: the folder used to be asked for on every launch and forgotten on
 * quit, which is the smallest possible way to tell somebody their work does not
 * matter enough to keep track of.
 *
 * It is a list and one link, and it is deliberately quiet. This is the first
 * screen of the session and the rule for first screens (notes/strategy/UI-DESIGN.md)
 * is one sentence and one control, not an illustration — so no cards, no
 * thumbnails, no grid. Names and when you were last there, which is what somebody
 * is actually scanning for.
 *
 * ## A folder that is not there any more
 *
 * It stays on the list, said plainly, with the only useful thing to do next
 * offered beside it. It is not hidden — a project vanishing from the list
 * silently is indistinguishable from us losing it — and it is not an error card,
 * because nothing has gone wrong with the app. A moved folder is a Tuesday.
 */
export default function ProjectPicker({
  projects,
  onOpen,
  onForget,
  onBrowse,
  openPath,
  compact,
}: Props) {
  /* Nothing remembered is a different screen, not the same screen with an empty
     list in the middle of it. "Where were we?" over nothing is the app asking a
     question it already knows the answer to, and an empty <ul> above a button is
     a layout with a hole in it. */
  const firstRun = projects.length === 0;

  return (
    <section className={`picker ${compact ? 'picker--compact' : ''}`}>
      {compact ? null : (
        <div className="picker__head">
          <h1 className="picker__title">
            {firstRun ? 'Which folder should I work in?' : 'Where were we?'}
          </h1>
          <p className="picker__sub">
            {firstRun
              ? 'Pick the folder your project lives in. I only ever touch what is inside it.'
              : 'Pick up where you left off, or start somewhere new.'}
          </p>
        </div>
      )}

      <ul className="picker__list">
        {projects.map((project) => (
          <li
            key={project.path}
            className={`pickerrow ${project.missing ? 'pickerrow--missing' : ''}`}
          >
            <button
              type="button"
              className="pickerrow__open"
              onClick={() => (project.missing ? onForget(project) : onOpen(project))}
              aria-current={project.path === openPath ? 'true' : undefined}
              aria-describedby={project.missing ? `${project.path}-gone` : undefined}
            >
              <span className="pickerrow__name">{project.name}</span>
              <span className="pickerrow__meta" id={`${project.path}-gone`}>
                {project.missing ? (
                  <>I cannot find this folder any more</>
                ) : (
                  <>
                    {ago(project.lastOpenedAt)}
                    {project.lastSpend === null ? null : (
                      <>
                        <span className="pickerrow__dot" aria-hidden="true">
                          ·
                        </span>
                        {formatMoney(project.lastSpend)} last time
                      </>
                    )}
                  </>
                )}
              </span>
            </button>

            {project.missing ? (
              <button
                type="button"
                className="pickerrow__forget"
                onClick={() => onForget(project)}
                aria-label={`Take ${project.name} off the list`}
              >
                Take it off
              </button>
            ) : project.path === openPath ? (
              <span className="pickerrow__badge">Open</span>
            ) : null}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={`picker__browse ${firstRun && !compact ? 'picker__browse--only' : ''}`}
        onClick={onBrowse}
      >
        Open a folder…
        <kbd className="picker__key" aria-hidden="true">
          ⌘O
        </kbd>
      </button>
    </section>
  );
}
