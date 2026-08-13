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
 * First screen of every sitting. The brand is the signature — a mark that reads
 * as both a letter and a graph node — and the list is the job. No tour, no cards
 * of features for people who already know the product; three quiet promises only
 * on a first run, when there is nothing else to show.
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

  return (
    <section className={`picker ${compact ? 'picker--compact' : ''} ${firstRun && !compact ? 'picker--first' : ''}`}>
      {compact ? null : (
        <header className="picker__brand">
          <div className="picker__mark" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
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
          <h1 className="picker__title">
            {firstRun ? 'Design in the real project.' : 'Where were we?'}
          </h1>
          <p className="picker__sub">
            {firstRun
              ? 'Describe the change. I work in your files, show you before and after, and every step can be put back.'
              : 'Pick up where you left off, or open another folder.'}
          </p>
        </header>
      )}

      {firstRun && !compact ? (
        <ul className="picker__promises" aria-label="What Graphe does">
          <li>
            <span className="picker__promisekicker">Talk</span>
            <strong>Not configure</strong>
            <span>Plain sentences. Real files. No setup maze.</span>
          </li>
          <li>
            <span className="picker__promisekicker">See</span>
            <strong>As you go</strong>
            <span>Before-and-after pictures, not a wall of diff.</span>
          </li>
          <li>
            <span className="picker__promisekicker">Keep</span>
            <strong>Always reversible</strong>
            <span>Every change is a moment you can return to.</span>
          </li>
        </ul>
      ) : null}

      {firstRun ? null : (
        <ul className="picker__list" aria-label="Recent projects">
          {projects.map((project) => (
            <li
              key={project.path}
              className={`pickerrow ${project.missing ? 'pickerrow--missing' : ''} ${project.path === openPath ? 'pickerrow--open' : ''}`}
            >
              <button
                type="button"
                className="pickerrow__open"
                onClick={() => (project.missing ? onForget(project) : onOpen(project))}
                aria-current={project.path === openPath ? 'true' : undefined}
                aria-describedby={project.missing ? `${project.path}-gone` : undefined}
              >
                <span className="pickerrow__glyph" aria-hidden="true">
                  {project.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="pickerrow__copy">
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

      <button
        type="button"
        className={`picker__browse ${firstRun && !compact ? 'picker__browse--primary' : ''}`}
        onClick={onBrowse}
      >
        <span>{firstRun ? 'Open a project folder' : 'Open another folder…'}</span>
        <kbd className="picker__key" aria-hidden="true">
          ⌘O
        </kbd>
      </button>

      {compact ? null : (
        <p className="picker__foot">
          Your code stays on this computer. Accounts you connect are yours.
        </p>
      )}
    </section>
  );
}
