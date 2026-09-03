import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PullCheck, PullComment, RepoItem, RepoLook, Result } from '../lib/ipc';
import { parseDiff } from '../diff/hunks';
import {
  checkLine,
  chipsFor,
  firstFilter,
  issuePrompt,
  listFor,
  markOf,
  moveBy,
  rowSub,
  type Filter,
  type Mark,
} from '../work/pulls';
import { ago } from '../lib/when';
import DiffView from './DiffView';
import Markdown from './Markdown';
import './ReviewsView.css';
import './Sheet.css';

type Props = {
  /** The fetched view of the project's repository. Null until the shell
   *  answers, and null again when there is no github repo behind this folder. */
  repo: RepoLook | null;
  /** True while a fetch is in flight. */
  busy: boolean;
  onRefresh: () => void;
  onClose: () => void;
  /** Open one pull request's review in the conversation. */
  onReview: (item: RepoItem) => void;
  /** Start a conversation on an issue, with the issue as its first message. */
  onWork?: (item: RepoItem, first: string) => void;
  /** The projects inside this folder, when it holds several. */
  repos?: readonly { name: string; path: string }[];
  /** Whose pull requests are being shown, and how to show another's. */
  which?: string | null;
  onWhich?: (name: string) => void;
  /** The reads this screen makes of one pull request. Absent in a browser tab,
   *  where the Files tab and the checks line simply do not appear. */
  prDiff?: (number: number) => Promise<Result<string>>;
  prChecks?: (number: number) => Promise<Result<readonly PullCheck[]>>;
  prCheckout?: (number: number) => Promise<Result<string>>;
  prComments?: (number: number) => Promise<Result<readonly PullComment[]>>;
  prComment?: (
    number: number,
    body: string,
    path: string,
    line: number,
  ) => Promise<Result<readonly PullComment[]>>;
};

export const SAYS = {
  heading: 'Pull requests',
  whose: 'Whose pull requests',
  from: (full: string): string => `github.com/${full}`,
  refresh: 'Refresh',
  empty: 'No pull requests here yet.',
  emptyDetail:
    'Open pull requests show up here.',
  noIssues: 'No issues have been opened.',
  noIssuesDetail:
    'When someone raises one in this project it will show up here.',
  /** Said when github could not be asked. Never "there are none": a list that
   *  could not be read is not an empty list, and telling somebody they have no
   *  pull requests when they have several is worse than saying nothing. */
  couldNotAsk: 'I could not read this from github just now.',
  tryAgain: 'Try again',
  /** While the first fetch is in flight. Nothing is claimed absent until we
   *  have looked — "no repository" and "not asked yet" are different answers
   *  and used to share a screen. */
  looking: 'Reading pull requests and issues…',
  noRepo:
    'This folder is not a github repository, or github is not set up on your terminal.',
  noRepoDetail:
    'You need the github CLI (`gh`) installed and logged in, the same one your terminal uses, and the project needs a `github.com` remote.',
  issues: 'Issues',
  prs: 'Pull requests',
  prAction: 'Review with Graphe',
  openUrl: 'Open on GitHub',
  by: (author: string): string => `by ${author}`,
  changed: 'Updated',
  /** The detail's two tabs. */
  description: 'Description',
  files: 'Files',
  noDescription: 'No description written.',
  /** The issue action, and the row of things behind the dots. */
  work: 'Work on this',
  more: 'More',
  checkout: 'Check out this branch',
  copyLink: 'Copy link',
  copied: 'Link copied',
  /** Marks on a row, for whoever is reading with a screen reader. */
  mark: {
    open: 'Open',
    merged: 'Merged',
    closed: 'Closed',
    draft: 'Draft',
    issue: 'Issue',
  } as Record<Mark, string>,
  hasComments: 'Has review comments',
  readingDiff: 'Reading the diff…',
  noDiff: 'This pull request changes nothing.',
} as const;

/**
 * Where the review is to read this pull request's files from.
 *
 * The bug this exists to make impossible: the folder is a line of work like any
 * other, and it is very often not the one the pull request is asking about. Told
 * to "walk the checked-out code", a review reads whatever is open and reports it
 * as the pull request — every finding true of the folder and wrong about the
 * change. So the folder is never assumed to be the pull request; it is checked,
 * and when it is not, the files are read from the pull request's own commit.
 */
export function whereToRead(item: RepoItem, here: Here): string {
  const short = (sha: string): string => sha.slice(0, 7);
  if (item.headSha === null) {
    return `- this folder may be on a different line of work than the pull request. Before you read any file here, check \`git rev-parse HEAD\` against \`gh pr view ${String(item.number)} --json headRefOid\`. If they differ, read every file with \`git show <the pull request's commit>:<path>\` instead of from the folder.`;
  }
  if (here !== null && here.sha === item.headSha) {
    return `- this folder is this pull request's code, at ${short(item.headSha)}. Read it freely for the surrounding context.`;
  }
  const where =
    here === null
      ? 'somewhere this app could not read'
      : `${here.branch ?? 'detached HEAD'}, at ${short(here.sha)}`;
  return `- **this folder is not this pull request's code.** It is on ${where}; the pull request is ${item.headRef ?? 'its own branch'} at ${short(item.headSha)}. Do not read files from the folder. Every line you quoted would be from a different branch, and every finding would be about code this pull request does not contain. Bring its files in first with \`git fetch origin pull/${String(item.number)}/head\`, then read any one of them with \`git show ${item.headSha}:<path>\`.`;
}

/** What the folder is on, as the shell reported it. */
type Here = { branch: string | null; sha: string } | null;

/** Open a pull request, whole, and review it in the conversation. */
export function reviewPrompt(item: RepoItem, full: string, here: Here = null): string {
  return `Review pull request #${item.number} in ${full} and post your findings.

“${item.title}”

This is the one thing you should do now: a careful, honest review of the whole PR. Assume there are bugs until you have read enough to believe otherwise.

Read what you need through your terminal, where the person’s github is already logged in:
- \`gh pr view ${item.number} -R ${full}\`: title, description, base branch, the issue(s) it links
- \`gh pr diff ${item.number} -R ${full}\`: every line the PR changes, held against its base branch
- \`gh issue view <n> -R ${full}\`: for each issue the PR says it closes (find them in the PR body)
${whereToRead(item, here)}

Review it like a senior engineer on the team, not a checklist:
- Does it actually solve the issue it claims to close?
- Correctness bugs and edge cases a test would miss; silent failures and swallowed errors
- Security problems, missing validation, unsafe data handling
- Regressions and dead code; anything that breaks what worked before
- Whether names, shapes and structure match the rest of the codebase
Be specific: name file paths and lines, and give a one-line reason for every point. Separate “must change” from “could be nicer”. If it is genuinely good to merge, say so plainly.

Finish with a short plain summary followed by a fenced review block: a JSON object with the verdict ("ships", "needs-work" or "do-not-land"), one summary sentence, \`"pull": ${item.number}\`, and the findings, each with priority (0 blocks shipping, 1 should be fixed first, 2 can wait, 3 a note), file, line, issue, impact and confidence (0-100). The findings then appear as a card with a button that posts them on the pull request, so do not post them yourself.`;
}

/** The state mark. Shape as well as colour, so it still reads at a glance for
 *  somebody who does not see the difference between green and purple. */
function StateMark({ mark }: { mark: Mark }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const;
  const stroke = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' } as const;
  if (mark === 'issue') {
    return (
      <svg {...common} className="reviews__mark reviews__mark--issue">
        <circle cx="8" cy="8" r="5.25" {...stroke} />
        <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      </svg>
    );
  }
  if (mark === 'merged') {
    return (
      <svg {...common} className="reviews__mark reviews__mark--merged">
        <circle cx="4.5" cy="3.5" r="2" {...stroke} />
        <circle cx="4.5" cy="12.5" r="2" {...stroke} />
        <circle cx="11.5" cy="8" r="2" {...stroke} />
        <path d="M4.5 5.5v5" {...stroke} />
        <path d="M6.5 5.5a3.5 3.5 0 0 0 3 2.5" {...stroke} />
      </svg>
    );
  }
  if (mark === 'closed') {
    return (
      <svg {...common} className="reviews__mark reviews__mark--closed">
        <circle cx="4.5" cy="3.5" r="2" {...stroke} />
        <circle cx="4.5" cy="12.5" r="2" {...stroke} />
        <path d="M4.5 5.5v5" {...stroke} />
        <path d="M9 4.5h5" {...stroke} />
      </svg>
    );
  }
  const dotted = mark === 'draft' ? { strokeDasharray: '1.5 2' } : {};
  return (
    <svg {...common} className={`reviews__mark reviews__mark--${mark}`}>
      <circle cx="4.5" cy="3.5" r="2" {...stroke} {...dotted} />
      <circle cx="4.5" cy="12.5" r="2" {...stroke} {...dotted} />
      <circle cx="11.5" cy="3.5" r="2" {...stroke} {...dotted} />
      <path d="M4.5 5.5v5" {...stroke} {...dotted} />
      <path d="M11.5 5.5c0 3-3 2.5-5 5" {...stroke} {...dotted} />
    </svg>
  );
}

/** One remote read, kept per pull request until the next Refresh. */
type Cache<T> = ReadonlyMap<number, T>;

export default function ReviewsView({
  repo,
  busy,
  onRefresh,
  onClose,
  onReview,
  onWork,
  repos,
  which,
  onWhich,
  prDiff,
  prChecks,
  prCheckout,
  prComments,
  prComment,
}: Props) {
  const shut = useRef<HTMLButtonElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [tab, setTab] = useState<'description' | 'files'>('description');
  const [menuOpen, setMenuOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Cache<string>>(new Map());
  const [checks, setChecks] = useState<Cache<readonly PullCheck[]>>(new Map());
  const [comments, setComments] = useState<Cache<readonly PullComment[]>>(new Map());
  const [reading, setReading] = useState(false);
  // A null repo means one of two things, and only one of them is "there is no
  // repository here". True once a fetch has come back and we actually know.
  const [looked, setLooked] = useState(false);
  const asked = useRef(false);

  // The only fetch, on the way in, so the screen is never blank the first time.
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  useEffect(() => {
    if (busy) asked.current = true;
    else if (asked.current) setLooked(true);
  }, [busy]);

  useEffect(() => {
    shut.current?.focus();
  }, []);

  // Everything read per pull request is only true of the reading it came with.
  useEffect(() => {
    setDiffs(new Map());
    setChecks(new Map());
    setComments(new Map());
  }, [repo]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const everything = useMemo(
    () => (repo === null ? [] : [...repo.prs, ...repo.issues]),
    [repo],
  );
  const here: Filter = filter ?? firstFilter(everything);
  const items = useMemo(() => listFor(everything, here), [everything, here]);
  const chips = useMemo(() => chipsFor(everything), [everything]);

  /* Nothing picked yet, so the first one stands in — a list and an empty
     detail pane next to each other is a screen that has taught the hand there
     is nothing to read here, when there clearly is. */
  const chosen = items.find((one) => one.number === open) ?? items[0] ?? null;
  const picked = chosen?.number ?? null;
  const at = chosen === null ? -1 : items.indexOf(chosen);

  const move = useCallback(
    (step: number) => {
      const next = items[moveBy(items.length, at, step)];
      if (next === undefined) return;
      setOpen(next.number);
      setTab('description');
    },
    [items, at],
  );

  // j/k and the arrows walk the list, and Enter carries the hand across to the
  // press. The diff has j/k of its own, so the list lets go while it is out.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const on = event.target as HTMLElement | null;
      if (on?.closest('input, textarea, [contenteditable="true"], .reviews__diff') != null) return;
      if (tab === 'files' && (event.key === 'j' || event.key === 'k')) return;
      if (event.key === 'Enter') {
        if (primary.current === null) return;
        event.preventDefault();
        primary.current.focus();
      } else if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, tab]);

  // The checks and the existing comments belong to the pull request in front.
  useEffect(() => {
    if (chosen === null || chosen.kind !== 'pr') return;
    const number = chosen.number;
    if (prChecks !== undefined && !checks.has(number)) {
      void prChecks(number).then((answer) => {
        if (answer.ok) setChecks((was) => new Map(was).set(number, answer.value));
      });
    }
    if (prComments !== undefined && !comments.has(number)) {
      void prComments(number).then((answer) => {
        if (answer.ok) setComments((was) => new Map(was).set(number, answer.value));
      });
    }
  }, [chosen, prChecks, prComments, checks, comments]);

  // The diff is a whole PR of text; it is read the first time somebody asks for
  // Files, and then kept until Refresh.
  useEffect(() => {
    if (tab !== 'files' || chosen === null || chosen.kind !== 'pr') return;
    if (prDiff === undefined || diffs.has(chosen.number)) return;
    const number = chosen.number;
    setReading(true);
    void prDiff(number)
      .then((answer) => {
        if (answer.ok) setDiffs((was) => new Map(was).set(number, answer.value));
        else setSaid(answer.trouble.because);
      })
      .finally(() => setReading(false));
  }, [tab, chosen, prDiff, diffs]);

  const files = useMemo(() => {
    const text = chosen === null ? undefined : diffs.get(chosen.number);
    return text === undefined ? [] : parseDiff(text);
  }, [chosen, diffs]);

  const onLineComment = useCallback(
    async (file: string, line: number, text: string) => {
      if (prComment === undefined || chosen === null) return;
      const number = chosen.number;
      const answer = await prComment(number, text, file, line);
      if (answer.ok) setComments((was) => new Map(was).set(number, answer.value));
      else setSaid(answer.trouble.because);
    },
    [prComment, chosen],
  );

  const copyLink = useCallback((url: string) => {
    void navigator.clipboard?.writeText(url).then(
      () => setSaid(SAYS.copied),
      () => setSaid(null),
    );
    setMenuOpen(false);
  }, []);

  const checkOut = useCallback(
    (number: number) => {
      setMenuOpen(false);
      if (prCheckout === undefined) return;
      void prCheckout(number).then((answer) => {
        setSaid(answer.ok ? answer.value : answer.trouble.because);
      });
    },
    [prCheckout],
  );

  if (repo === null) {
    return (
      <section className="sheet" aria-label={SAYS.heading}>
        <header className="sheet__top">
          <div className="sheet__titles">
            <h1 className="sheet__title">{SAYS.heading}</h1>
          </div>
        {repos === undefined || repos.length < 2 || onWhich === undefined ? (
          <div className="sheet__chips" />
        ) : (
          <div className="sheet__chips projects__strip" role="group" aria-label={SAYS.whose}>
            {repos.map((one) => (
              <button
                key={one.path}
                type="button"
                className={`projects__pick ${one.name === which ? 'projects__pick--on' : ''}`}
                aria-current={one.name === which ? 'true' : undefined}
                onClick={() => onWhich(one.name)}
              >
                {one.name}
              </button>
            ))}
          </div>
        )}
          <button ref={shut} type="button" className="sheet__refresh" onClick={onRefresh} disabled={busy}>
            {busy ? 'Fetching…' : SAYS.refresh}
          </button>
          <button type="button" className="sheet__close" onClick={onClose}>
            Close
            <kbd className="sheet__key">Esc</kbd>
          </button>
        </header>
        <div className="sheet__body scroll--auto">
          {looked && !busy ? (
            <div className="reviews reviews--empty">
              <h2 className="reviews__none">{SAYS.noRepo}</h2>
              <p className="reviews__detail">{SAYS.noRepoDetail}</p>
            </div>
          ) : (
            <div className="reviews reviews--empty">
              <div className="reviews__waiting" role="status">
                <span className="reviews__spinner" aria-hidden="true" />
                <p className="reviews__waitingsay">{SAYS.looking}</p>
                <ul className="reviews__ghosts" aria-hidden="true">
                  <li className="reviews__ghost" />
                  <li className="reviews__ghost" />
                  <li className="reviews__ghost" />
                </ul>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  const line = chosen === null ? null : checkLine(checks.get(chosen.number) ?? []);
  const onPull = chosen !== null && chosen.kind === 'pr';

  return (
    <section className="sheet" aria-label={SAYS.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{SAYS.heading}</h1>
          <a className="sheet__from" href={repo.url} target="_blank" rel="noreferrer">
            {SAYS.from(repo.full)}
          </a>
        </div>

        {repos === undefined || repos.length < 2 || onWhich === undefined ? null : (
          <div className="projects__strip" role="group" aria-label={SAYS.whose}>
            {repos.map((one) => (
              <button
                key={one.path}
                type="button"
                className={`projects__pick ${one.name === which ? 'projects__pick--on' : ''}`}
                aria-current={one.name === which ? 'true' : undefined}
                onClick={() => onWhich(one.name)}
              >
                {one.name}
              </button>
            ))}
          </div>
        )}

        <div className="sheet__chips" role="group" aria-label={SAYS.heading}>
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`sheet__chip ${chip.id === here ? 'sheet__chip--here' : ''}`}
              aria-pressed={chip.id === here}
              onClick={() => {
                setFilter(chip.id);
                setOpen(null);
                setTab('description');
              }}
            >
              {chip.says}
              {chip.count === 0 ? null : <span className="sheet__chipcount">{chip.count}</span>}
            </button>
          ))}
        </div>

        <button type="button" className="sheet__refresh" onClick={onRefresh} disabled={busy}>
          {busy ? 'Fetching…' : SAYS.refresh}
        </button>

        <button ref={shut} type="button" className="sheet__close" onClick={onClose}>
          Close
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div className="sheet__body scroll--auto">
        {chosen === null ? (
          <div className="reviews reviews--empty">
            <div className="reviews__blank">
              <StateMark mark={here === 'issues' ? 'issue' : 'open'} />
              {repo.trouble === null ? (
                <>
                  <h2 className="reviews__blanktitle">
                    {here === 'issues' ? SAYS.noIssues : SAYS.empty}
                  </h2>
                  <p className="reviews__blankdetail">
                    {here === 'issues' ? SAYS.noIssuesDetail : SAYS.emptyDetail}
                  </p>
                </>
              ) : (
                <>
                  <h2 className="reviews__blanktitle">{SAYS.couldNotAsk}</h2>
                  <p className="reviews__blankdetail">{repo.trouble}</p>
                  <button
                    type="button"
                    className="reviews__retry"
                    onClick={onRefresh}
                    disabled={busy}
                  >
                    {SAYS.tryAgain}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
        <div className="reviews">
          <ul className="reviews__list">
            {items.map((item) => (
              <li key={`${item.kind}-${item.number}`}>
                <button
                  type="button"
                  className={`reviews__row ${item.number === picked ? 'reviews__row--open' : ''}`}
                  onClick={() => {
                    setOpen(item.number);
                    setTab('description');
                  }}
                  aria-current={item.number === picked ? 'true' : undefined}
                >
                  <span className="reviews__markbox" title={SAYS.mark[markOf(item)]}>
                    <StateMark mark={markOf(item)} />
                  </span>
                  <span className="reviews__text">
                    <span className="reviews__titleline">
                      <span className="reviews__num">#{item.number}</span>
                      <span className="reviews__title">{item.title}</span>
                      {(comments.get(item.number) ?? []).length === 0 ? null : (
                        <span className="reviews__spoke" title={SAYS.hasComments} aria-label={SAYS.hasComments}>
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v5A1.5 1.5 0 0 1 12.5 11H7l-3 2.5V11h-.5A1.5 1.5 0 0 1 2 9.5v-5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                          </svg>
                        </span>
                      )}
                    </span>
                    <span className="reviews__sub">
                      {rowSub(
                        item.author,
                        item.updatedAt === '' ? '' : ago(new Date(item.updatedAt).getTime()),
                        item.kind === 'pr' && diffs.has(item.number)
                          ? parseDiff(diffs.get(item.number) ?? '').length
                          : null,
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

            <div className="reviews__about">
              <h2 className="reviews__abouttitle">{chosen.title}</h2>

              <p className="reviews__aboutwhen">
                <span className="reviews__num">#{chosen.number}</span>
                {' '}
                {rowSub(
                  SAYS.by(chosen.author),
                  chosen.updatedAt === '' ? '' : `${SAYS.changed} ${ago(new Date(chosen.updatedAt).getTime())}`,
                  null,
                )}
              </p>

              {onPull && chosen.headRef !== null ? (
                <p className="reviews__branches">
                  <span className="reviews__branch">{chosen.headRef}</span>
                  <span className="reviews__into" aria-hidden="true">→</span>
                  <span className="reviews__branch">{chosen.baseRef ?? 'main'}</span>
                </p>
              ) : null}

              {line === null ? null : (
                <p className={`reviews__checks ${line.good ? '' : 'reviews__checks--bad'}`}>
                  <span aria-hidden="true">{line.good ? '✓' : '✗'}</span> {line.says}
                  {line.link === null ? null : (
                    <a className="reviews__link" href={line.link} target="_blank" rel="noreferrer">
                      {SAYS.openUrl}
                    </a>
                  )}
                </p>
              )}

              <div className="reviews__presses">
                {onPull ? (
                  <button ref={primary} type="button" className="reviews__do" onClick={() => onReview(chosen)}>
                    {SAYS.prAction}
                  </button>
                ) : onWork === undefined ? null : (
                  <button
                    ref={primary}
                    type="button"
                    className="reviews__do"
                    onClick={() => onWork(chosen, issuePrompt(chosen, repo.full))}
                  >
                    {SAYS.work}
                  </button>
                )}

                {chosen.url === '' ? null : (
                  <a className="reviews__press" href={chosen.url} target="_blank" rel="noreferrer">
                    {SAYS.openUrl}
                  </a>
                )}

                <div className="reviews__menu">
                  <button
                    type="button"
                    className="reviews__press reviews__press--dots"
                    aria-label={SAYS.more}
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((was) => !was)}
                  >
                    …
                  </button>
                  {!menuOpen ? null : (
                    <div className="reviews__menulist" role="menu">
                      {onPull && prCheckout !== undefined ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="reviews__menurow"
                          onClick={() => checkOut(chosen.number)}
                        >
                          {SAYS.checkout}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        role="menuitem"
                        className="reviews__menurow"
                        onClick={() => copyLink(chosen.url)}
                      >
                        {SAYS.copyLink}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {said === null ? null : (
                <p className="reviews__said" role="status">{said}</p>
              )}

              <div className="reviews__tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'description'}
                  className={`reviews__tab ${tab === 'description' ? 'reviews__tab--here' : ''}`}
                  onClick={() => setTab('description')}
                >
                  {SAYS.description}
                </button>
                {onPull && prDiff !== undefined ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'files'}
                    className={`reviews__tab ${tab === 'files' ? 'reviews__tab--here' : ''}`}
                    onClick={() => setTab('files')}
                  >
                    {SAYS.files}
                  </button>
                ) : null}
              </div>

              {tab === 'description' ? (
                <div className="reviews__read">
                  {chosen.description === null ? (
                    <p className="reviews__detail">{SAYS.noDescription}</p>
                  ) : (
                    <Markdown text={chosen.description} />
                  )}
                </div>
              ) : (
                <div className="reviews__diff">
                  {files.length > 0 ? (
                    <DiffView
                      files={files}
                      comments={comments.get(chosen.number) ?? []}
                      {...(prComment === undefined ? {} : { onComment: onLineComment })}
                    />
                  ) : (
                    <p className="reviews__detail">{reading ? SAYS.readingDiff : SAYS.noDiff}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
