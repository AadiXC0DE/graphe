import { useEffect, useMemo, useRef, useState } from 'react';

import { parseDiff } from '../diff/hunks';
import type { FileChange } from '../diff/hunks';
import type { HowItLands, ReviewEntry } from '../lib/ipc';
import { ago } from '../lib/when';
import {
  filesToTake,
  landingWords,
  heldBack,
  landsAsOneCommit,
  reviewWords,
  saysEntry,
  waiting,
  type FileVerdict,
  type Verdict,
} from '../work/reviewqueue';
import DiffView from './DiffView';
import Switch from './Switch';
import './ReviewQueue.css';
import './Sheet.css';

type Props = {
  entries: readonly ReviewEntry[];
  /** The entry being read, and its change. Null while it is being fetched. */
  chosen: string | null;
  diff: string | null;
  busy: boolean;
  onChoose: (id: string) => void;
  onFile: (id: string, path: string, choice: FileVerdict | null) => void;
  onDecide: (id: string, verdict: Verdict) => void;
  onLand: (id: string, landing: HowItLands) => void;
  onOpenPr: (id: string, summary: string) => void;
  onMirror: (id: string, on: boolean) => void;
  onRefresh: () => void;
  onClose: () => void;
  /** Ask the conversation about one piece, from inside the diff. */
  onExplain?: (file: string, line: number) => void;
  onFix?: (file: string, line: number) => void;
};

export const SAYS = {
  heading: reviewWords.heading,
  nothing: reviewWords.nothing,
  nothingDetail: reviewWords.nothingDetail,
  close: 'Close',
  refresh: 'Refresh',
  reading: 'Reading the change',
  /** The three-way decision on one file, said the way the model says it. */
  follow: 'Accept',
  followWhy: 'Do whatever the whole review says.',
  takeFile: reviewWords.takeFile,
  keepFile: reviewWords.keepFile,
  files: 'Files',
  onBranch: (branch: string): string => `On ${branch}`,
  decide: 'What to do with this',
  /** The count on the way in. */
  badge: reviewWords.badge,
} as const;

/**
 * The pull request's description, built from the entry itself.
 *
 * The conversation's own title first, then what it actually touched, because a
 * pull request whose body is one line of title is a pull request the reviewer
 * has to open the diff to understand.
 */
export function prBody(entry: ReviewEntry): string {
  const kept = new Set(filesToTake(entry, 'take it'));
  const rows = entry.files
    .filter((one) => kept.has(one.path))
    .map((one) => `- ${one.path} ${reviewWords.tally(one.added, one.removed)}`);
  return [entry.title, '', 'Files changed:', ...rows].join('\n');
}

/** The hunks the diff should draw as dropped: every piece of a file somebody
 *  has kept their own version of. */
export function droppedFor(
  files: readonly FileChange[],
  entry: ReviewEntry | null,
): ReadonlySet<string> {
  const off = new Set<string>();
  const choices = entry?.choices ?? {};
  for (const file of files) {
    if (choices[file.path] !== 'keep mine') continue;
    for (const hunk of file.hunks) off.add(hunk.id);
  }
  return off;
}

/** What one file is set to, as three states rather than two: a file nobody has
 *  singled out follows the whole review, which is not the same as taking it. */
function verdictOf(entry: ReviewEntry, path: string): FileVerdict | null {
  return entry.choices?.[path] ?? null;
}

function Tally({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="reviewq__tally">
      <span className="reviewq__added">+{added}</span>
      <span className="reviewq__removed">−{removed}</span>
    </span>
  );
}

export default function ReviewQueue({
  entries,
  chosen,
  diff,
  busy,
  onChoose,
  onFile,
  onDecide,
  onLand,
  onOpenPr,
  onMirror,
  onRefresh,
  onClose,
  onExplain,
  onFix,
}: Props) {
  const shut = useRef<HTMLButtonElement>(null);
  const [precise, setPrecise] = useState(false);
  /** Which of the four this entry is being given. Take it, because that is what
   *  somebody opened the screen to do. */
  const [chose, setChose] = useState<Verdict>('take it');
  const [menuOpen, setMenuOpen] = useState(false);
  const [how, setHow] = useState<'squash' | 'every-version'>('squash');
  const [message, setMessage] = useState('');
  const [at, setAt] = useState<string | null>(null);

  const entry = entries.find((one) => one.id === chosen) ?? entries[0] ?? null;
  const files = useMemo(() => (diff === null ? [] : parseDiff(diff)), [diff]);
  const dropped = useMemo(() => droppedFor(files, entry), [files, entry]);

  useEffect(() => {
    shut.current?.focus();
  }, []);

  // A different entry is a different landing.
  useEffect(() => {
    setPrecise(false);
    setHow('squash');
    setMessage('');
    setAt(null);
  }, [entry?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const left = waiting(entries);
  const partial = entry !== null && landsAsOneCommit(entry);
  const taking = entry === null ? [] : filesToTake(entry, 'take it');

  const head = (
    <header className="sheet__top">
      <div className="sheet__titles">
        <h1 className="sheet__title">{SAYS.heading}</h1>
        <p className="reviewq__count">
          {entries.length === 0 ? SAYS.nothing : SAYS.badge(left)}
        </p>
      </div>
      <div className="sheet__chips" />
      <button type="button" className="sheet__refresh" onClick={onRefresh} disabled={busy}>
        {SAYS.refresh}
      </button>
      <button ref={shut} type="button" className="sheet__close" onClick={onClose}>
        {SAYS.close}
        <kbd className="sheet__key">Esc</kbd>
      </button>
    </header>
  );

  if (entry === null) {
    return (
      <section className="sheet reviewq" aria-label={SAYS.heading}>
        {head}
        <div className="sheet__body scroll--auto">
          <div className="reviewq__blank">
            <h2 className="reviewq__blanktitle">{SAYS.nothing}</h2>
            <p className="reviewq__blankdetail">{SAYS.nothingDetail}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="sheet reviewq" aria-label={SAYS.heading}>
      {head}

      <div className="sheet__body reviewq__body scroll--auto">
        <ul className="reviewq__list">
          {entries.map((one) => (
            <li key={one.id}>
              <button
                type="button"
                className={`reviewq__row ${one.id === entry.id ? 'reviewq__row--open' : ''}`}
                aria-current={one.id === entry.id ? 'true' : undefined}
                onClick={() => onChoose(one.id)}
              >
                <span className={`reviewq__dot ${one.read ? '' : 'reviewq__dot--new'}`} aria-hidden="true" />
                <span className="reviewq__text">
                  <span className="reviewq__rowtitle">{one.title}</span>
                  <span className="reviewq__rowsub">
                    {saysEntry(one)} · {ago(one.at)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="reviewq__work">
          <div className="reviewq__band">
            <div className="reviewq__about">
              <h2 className="reviewq__title">{entry.title}</h2>
              <p className="reviewq__sub">
                {saysEntry(entry)}
                {entry.branch === '' ? '' : ` · ${SAYS.onBranch(entry.branch)}`}
              </p>
            </div>

            {/* The old behaviour, one row in a menu. It was a switch and a
                sentence standing over the decision, which is not where a
                once-a-project choice belongs. */}
            <div className="reviewq__menuat">
              <button
                type="button"
                className="reviewq__menubtn"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((was) => !was)}
                title={reviewWords.menu}
              >
                <span aria-hidden="true">···</span>
              </button>
              {menuOpen ? (
                <div className="reviewq__menu" role="menu">
                  <label className="reviewq__mirror">
                    <Switch
                      on={entry.mirror}
                      onChange={(on) => {
                        onMirror(entry.id, on);
                        setMenuOpen(false);
                      }}
                      label={reviewWords.mirror}
                      disabled={busy}
                    />
                    <span className="reviewq__mirrortext">
                      <span className="reviewq__mirrorname">{reviewWords.mirror}</span>
                      <span className="reviewq__mirrorwhy">{reviewWords.mirrorWhy}</span>
                    </span>
                  </label>
                </div>
              ) : null}
            </div>
          </div>

          {/* One decision, then one press named by it. Seven verbs in a row,
              two of them meaning nearly the same thing, is a row nobody reads
              twice. */}
          <div className="reviewq__does">
            <div className="reviewq__verdicts" role="radiogroup" aria-label={SAYS.decide}>
              {([
                ['take it', reviewWords.take],
                ['keep mine', reviewWords.mine],
                ['ask again', reviewWords.again],
                ['drop it', reviewWords.drop],
              ] as const).map(([verdict, name]) => (
                <button
                  key={verdict}
                  type="button"
                  role="radio"
                  aria-checked={chose === verdict}
                  className={`reviewq__verdict ${chose === verdict ? 'reviewq__verdict--on' : ''}`}
                  disabled={busy}
                  onClick={() => setChose(verdict)}
                >
                  {name}
                </button>
              ))}
            </div>

            <span className="reviewq__spacer" />

            <div className="reviewq__land">
              <button
                type="button"
                className="reviewq__do"
                disabled={busy || (chose === 'take it' && taking.length === 0)}
                onClick={() => {
                  if (chose !== 'take it') {
                    onDecide(entry.id, chose);
                    return;
                  }
                  onLand(entry.id, {
                    how: partial ? 'squash' : how,
                    ...(message.trim() === '' ? {} : { message: message.trim() }),
                  });
                }}
              >
                {busy ? reviewWords.landing : reviewWords.does[chose]}
              </button>
              {/* The precise controls live behind the same button, not in a
                  settings screen: one commit is the default and the other way
                  is a press away. */}
              {chose === 'take it' ? (
                <button
                  type="button"
                  className="reviewq__more"
                  aria-expanded={precise}
                  aria-label={reviewWords.landingHow}
                  onClick={() => setPrecise((was) => !was)}
                >
                  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
                    <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : null}
            </div>

            {chose === 'take it' ? (
              <button
                type="button"
                className="reviewq__second"
                disabled={busy || entry.branch === ''}
                onClick={() => onOpenPr(entry.id, prBody(entry))}
              >
                {busy ? reviewWords.opening : reviewWords.openPr}
              </button>
            ) : null}
          </div>

          {chose === 'drop it' ? <p className="reviewq__note">{reviewWords.dropWhy}</p> : null}

          {precise ? (
            <div className="reviewq__precise">
              <p className="reviewq__prefix">{reviewWords.landingHow}</p>
              <div className="reviewq__ways" role="group" aria-label={reviewWords.landingHow}>
                {([
                  ['squash', landingWords.squash],
                  ['every-version', landingWords.every],
                ] as const).map(([way, name]) => (
                  <button
                    key={way}
                    type="button"
                    className={`reviewq__way ${how === way && !partial ? 'reviewq__way--on' : ''}`}
                    aria-pressed={how === way && !partial}
                    disabled={partial && way === 'every-version'}
                    onClick={() => setHow(way)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <label className="reviewq__messagelabel">
                <span className="reviewq__prefix">Commit message</span>
                <input
                  className="reviewq__message"
                  type="text"
                  value={message}
                  placeholder={entry.branch === '' ? entry.title : landingWords.message(entry.branch)}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
              <p className="reviewq__note">{partial ? reviewWords.heldBackNote : landingWords.note}</p>
            </div>
          ) : null}

          <div className="reviewq__files">
            <p className="reviewq__prefix">
              {SAYS.files} · {reviewWords.files(entry.files.length)}
              {heldBack(entry) === 0 ? '' : ` · ${String(heldBack(entry))} kept as yours`}
            </p>
            <ul className="reviewq__filelist">
              {entry.files.map((file) => {
                const said = verdictOf(entry, file.path);
                return (
                  <li key={file.path} className="reviewq__file">
                    <span className="reviewq__path" title={file.path}>{file.path}</span>
                    <Tally added={file.added} removed={file.removed} />
                    <span className="reviewq__pick" role="group" aria-label={file.path}>
                      {([
                        [null, SAYS.follow],
                        ['take theirs', SAYS.takeFile],
                        ['keep mine', SAYS.keepFile],
                      ] as const).map(([choice, name]) => (
                        <button
                          key={name}
                          type="button"
                          className={`reviewq__pickone ${said === choice ? 'reviewq__pickone--on' : ''}`}
                          aria-pressed={said === choice}
                          disabled={busy}
                          onClick={() => onFile(entry.id, file.path, choice)}
                        >
                          {name}
                        </button>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="reviewq__diff">
            {diff === null ? (
              <p className="reviewq__waiting">{SAYS.reading}</p>
            ) : (
              <DiffView
                files={files}
                dropped={dropped}
                at={at}
                onAt={setAt}
                busy={busy}
                onKeepFile={(file, keep) =>
                  onFile(entry.id, file.path, keep ? 'take theirs' : 'keep mine')
                }
                {...(onExplain === undefined ? {} : { onExplain })}
                {...(onFix === undefined ? {} : { onFix })}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
