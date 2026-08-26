import { useEffect, useMemo, useRef, useState } from 'react';
import type { GitSnapshot, SavedVersion } from '../lib/ipc';
import { layOut } from '../history/graph';
import { ago, clockTime } from '../lib/when';
import './HistoryView.css';
import './Sheet.css';

type Props = {
  versions: readonly SavedVersion[];
  /** What each version looked like, by id. */
  pictures?: Readonly<Record<string, string>>;
  git: GitSnapshot | null;
  busy?: boolean;
  onClose: () => void;
  onPutBack: (versionId: string) => void;
  /** Open a file where the person actually edits things. */
  onOpenFile: (path: string) => void;
  /** The projects inside this folder, when it holds several. Left off for the
   *  ordinary folder that is one project. */
  repos?: readonly { name: string; path: string }[];
  /** Whose history is being shown, and how to show another's. */
  repo?: string | null;
  onRepo?: (name: string) => void;
};

export const SAYS = {
  heading: 'History',
  close: 'Close',
  none: 'Nothing saved here yet.',
  more: (count: number): string => `Show ${String(count)} more`,
  whose: 'Whose history',
  onScreen: 'On screen',
  putBack: 'Restore this commit',
  by: { you: 'You', graphe: 'Graphe' },
  /** The head of the detail column. */
  about: 'This commit',
  came: 'Parents',
  cameNothing: 'Nothing. This is where the project starts.',
  wentBack: 'A restore of an earlier commit.',
  joined: 'Merge commit: two branches joined here.',
  names: 'Named',
  now: 'Not saved yet',
  nowNothing: 'Everything here is saved.',
} as const;

/** How many rows are drawn before the rest are offered. A project with years in
 *  it is a list nobody scrolls, and every row here is a real element. */
const AT_ONCE = 150;

/** One row's height, and the column pitch, in pixels. The lines are drawn in an
 *  SVG behind the rows, so both files have to agree — they are declared here and
 *  written into the stylesheet as custom properties. */
const ROW = 34;
const LANE = 15;

/** The colour a lane is drawn in. Two tones, alternating, so a line can be
 *  followed across a join without carrying a palette of its own. */
function laneTone(lane: number): string {
  return lane % 2 === 0 ? 'var(--border-strong)' : 'var(--accent)';
}

/** Where a lane's centre sits. */
function xOf(lane: number): number {
  return lane * LANE + LANE / 2;
}

function yOf(row: number): number {
  return row * ROW + ROW / 2;
}

/**
 * Where the project has been, drawn as lines.
 *
 * The rail beside the conversation answers "what did it look like then". This
 * answers the other question — how the work actually ran: what came after what,
 * where two goes at the same thing were tried side by side, and where they came
 * back together. Every row carries its short id, so anybody who wants to go and
 * do something with it in their own terminal can.
 */
export default function HistoryView({
  versions,
  pictures,
  git,
  busy,
  onClose,
  onPutBack,
  onOpenFile,
  repos,
  repo,
  onRepo,
}: Props) {
  const shut = useRef<HTMLButtonElement>(null);
  const [room, setRoom] = useState(AT_ONCE);
  const [picked, setPicked] = useState<string | null>(null);

  const drawn = useMemo(() => versions.slice(0, room), [versions, room]);
  const graph = useMemo(() => layOut(drawn), [drawn]);
  const rest = versions.length - drawn.length;

  const chosen =
    drawn.find((one) => one.id === picked) ?? drawn.find((one) => one.current) ?? drawn[0] ?? null;
  const place = graph.rows.find((one) => one.id === chosen?.id) ?? null;

  useEffect(() => {
    shut.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const width = graph.lanes * LANE;
  const height = graph.rows.length * ROW;
  const changed = git === null ? 0 : git.unstaged + git.staged + git.untracked;

  return (
    <section className="sheet" aria-label={SAYS.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{SAYS.heading}</h1>
          <p className="sheet__from">
            {versions.length === 1
              ? '1 commit'
              : `${String(versions.length)} commits`}
            {git?.branch === null || git === null ? '' : ` · ${git.branch}`}
          </p>
        </div>

        {/* A folder holding several projects has several histories, and the
            one on screen has to be both named and switchable from here. */}
        {repos === undefined || repos.length < 2 || onRepo === undefined ? (
          <div className="sheet__chips" />
        ) : (
          <div className="sheet__chips projects__strip" role="group" aria-label={SAYS.whose}>
            {repos.map((one) => (
              <button
                key={one.path}
                type="button"
                className={`projects__pick ${one.name === repo ? 'projects__pick--on' : ''}`}
                aria-current={one.name === repo ? 'true' : undefined}
                onClick={() => onRepo(one.name)}
              >
                {one.name}
              </button>
            ))}
          </div>
        )}

        <button ref={shut} type="button" className="sheet__close" onClick={onClose}>
          {SAYS.close}
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div className="sheet__body">
        <div className="graph">
          <div className="graph__lines" style={{ ['--row' as string]: `${String(ROW)}px` }}>
            {versions.length === 0 ? <p className="graph__none">{SAYS.none}</p> : null}

            <div className="graph__rows" style={{ paddingLeft: `${String(width + 12)}px` }}>
              {/* One drawing behind every row rather than a fragment per row:
                  a line runs from one row to another, so it belongs to neither. */}
              <svg
                className="graph__svg"
                width={width}
                height={height}
                viewBox={`0 0 ${String(width)} ${String(height)}`}
                aria-hidden="true"
              >
                {graph.edges.map((edge, at) => (
                  <path
                    key={at}
                    d={curve(edge)}
                    fill="none"
                    stroke={laneTone(edge.to.lane)}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    opacity={edge.offEnd ? 0.5 : 1}
                  />
                ))}
                {graph.rows.map((one) => (
                  <circle
                    key={one.id}
                    cx={xOf(one.lane)}
                    cy={yOf(one.row)}
                    r={one.joins ? 4.5 : 3.5}
                    fill={
                      drawn[one.row]?.current === true ? 'var(--accent)' : 'var(--bg-raised)'
                    }
                    stroke={laneTone(one.lane)}
                    strokeWidth="1.5"
                  />
                ))}
              </svg>

              <ul className="graph__list">
                {drawn.map((version) => (
                  <li key={version.id}>
                    <button
                      type="button"
                      className={`graph__row ${version.id === chosen?.id ? 'graph__row--here' : ''}`}
                      style={{ height: `${String(ROW)}px` }}
                      onClick={() => setPicked(version.id)}
                      aria-current={version.current ? 'true' : undefined}
                    >
                      <span className="graph__title">{version.title}</span>
                      {version.refs.map((name) => (
                        <span className="graph__ref" key={name}>
                          {name}
                        </span>
                      ))}
                      {version.current ? (
                        <span className="graph__badge">{SAYS.onScreen}</span>
                      ) : null}
                      <span className="graph__who">{SAYS.by[version.by]}</span>
                      <span className="graph__when">{ago(version.at)}</span>
                      <span className="graph__id">{version.shortId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {rest > 0 ? (
              <button
                type="button"
                className="graph__more"
                onClick={() => setRoom(room + AT_ONCE)}
              >
                {SAYS.more(Math.min(rest, AT_ONCE))}
              </button>
            ) : null}
          </div>

          {/* What one row is, whole. The list has room for a line each; this is
              where the rest of it goes. */}
          {chosen === null ? null : (
            <aside className="graph__about">
              <h2 className="sheet__blocktitle">{SAYS.about}</h2>

              {pictures?.[chosen.id] === undefined ? null : (
                <img className="graph__shot" src={pictures[chosen.id]} alt="" />
              )}

              <p className="graph__abouttitle">{chosen.title}</p>
              <p className="graph__aboutwhen">{`${ago(chosen.at)} · ${clockTime(new Date(chosen.at))}`}</p>

              <dl className="graph__facts">
                <dt>Who</dt>
                <dd>{SAYS.by[chosen.by]}</dd>
                <dt>Id</dt>
                <dd className="graph__mono">{chosen.shortId}</dd>
                {chosen.refs.length === 0 ? null : (
                  <>
                    <dt>{SAYS.names}</dt>
                    <dd className="graph__mono">{chosen.refs.join(', ')}</dd>
                  </>
                )}
                <dt>{SAYS.came}</dt>
                <dd className="graph__mono">
                  {chosen.parents.length === 0
                    ? SAYS.cameNothing
                    : chosen.parents
                        .map(
                          (id) =>
                            versions.find((one) => one.id === id)?.shortId ?? id.slice(0, 7),
                        )
                        .join(', ')}
                </dd>
              </dl>

              {place?.joins === true ? <p className="graph__note">{SAYS.joined}</p> : null}
              {chosen.wentBackTo === null ? null : (
                <p className="graph__note">{SAYS.wentBack}</p>
              )}

              {chosen.current ? null : (
                <button
                  type="button"
                  className="graph__do"
                  disabled={busy}
                  onClick={() => onPutBack(chosen.id)}
                >
                  {SAYS.putBack}
                </button>
              )}

              {/* What has moved since the newest moment, which is the one thing
                  about the present a list of the past cannot say. */}
              {chosen.current && git !== null ? (
                <div className="graph__now">
                  <h3 className="sheet__blocktitle">{SAYS.now}</h3>
                  {changed === 0 ? (
                    <p className="graph__note">{SAYS.nowNothing}</p>
                  ) : (
                    <ul className="graph__files">
                      {git.files.slice(0, 12).map((file) => (
                        <li key={file.path}>
                          <button
                            type="button"
                            className="graph__file"
                            onClick={() => onOpenFile(file.path)}
                            title={`Open ${file.path}`}
                          >
                            <span className="graph__filename">{file.path}</span>
                            {file.kind === 'new' ? (
                              <span className="graph__filenew">new</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </aside>
          )}
        </div>
      </div>
    </section>
  );
}

/** One line between two rows: straight down inside a column, and an S out of it
 *  where it changes column. A curve rather than a corner, because a corner at
 *  15px reads as a glitch. */
function curve(edge: { from: { row: number; lane: number }; to: { row: number; lane: number } }): string {
  const x1 = xOf(edge.from.lane);
  const y1 = yOf(edge.from.row);
  const x2 = xOf(edge.to.lane);
  const y2 = yOf(edge.to.row);
  if (x1 === x2) return `M ${String(x1)} ${String(y1)} L ${String(x2)} ${String(y2)}`;
  const bend = (y1 + y2) / 2;
  return `M ${String(x1)} ${String(y1)} C ${String(x1)} ${String(bend)}, ${String(x2)} ${String(bend)}, ${String(x2)} ${String(y2)}`;
}
