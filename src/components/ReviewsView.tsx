import { useEffect, useRef, useState } from 'react';
import type { RepoItem, RepoLook } from '../lib/ipc';
import { ago } from '../lib/when';
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
  /** The projects inside this folder, when it holds several. */
  repos?: readonly { name: string; path: string }[];
  /** Whose pull requests are being shown, and how to show another's. */
  which?: string | null;
  onWhich?: (name: string) => void;
};

export const SAYS = {
  heading: 'Pull requests',
  whose: 'Whose pull requests',
  from: (full: string): string => `github.com/${full}`,
  refresh: 'Refresh',
  empty: 'No pull requests here yet.',
  emptyDetail:
    'When someone opens one in this project it will show up here to read and review.',
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
  prAction: 'Review this PR',
  openUrl: 'Open in github',
  by: (author: string): string => `by ${author}`,
  changed: 'Updated',
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

export default function ReviewsView({ repo, busy, onRefresh, onClose, onReview, repos, which, onWhich }: Props) {
  const shut = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<'prs' | 'issues'>('prs');
  const [open, setOpen] = useState<number | null>(null);
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

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

  const items = tab === 'prs' ? repo.prs : repo.issues;
  /* Nothing picked yet, so the first one stands in — a list and an empty
     detail pane next to each other is a screen that has taught the hand there
     is nothing to read here, when there clearly is. */
  const chosen = items.find((one) => one.number === open) ?? items[0] ?? null;
  const picked = chosen?.number ?? null;

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

        <div className="sheet__chips">
          {(['prs', 'issues'] as const).map((part) => (
            <button
              key={part}
              type="button"
              className={`sheet__chip ${tab === part ? 'sheet__chip--here' : ''}`}
              onClick={() => setTab(part)}
            >
              {part === 'prs' ? SAYS.prs : SAYS.issues}
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
              {tab === 'prs' ? <svg viewBox="0 0 32 32" className="reviews__blankicon" width="34" height="34" fill="none" aria-hidden="true"><path d="M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM10 19a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm3 0h9a5 5 0 0 0 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M13 19v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg> : <svg viewBox="0 0 32 32" className="reviews__blankicon" width="34" height="34" fill="none" aria-hidden="true"><circle cx="9" cy="16" r="3" stroke="currentColor" strokeWidth="2"/><path d="M6 16h7m0 0h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>}
              {repo.trouble === null ? (
                <>
                  <h2 className="reviews__blanktitle">{tab === 'prs' ? SAYS.empty : SAYS.noIssues}</h2>
                  <p className="reviews__blankdetail">
                    {tab === 'prs' ? SAYS.emptyDetail : SAYS.noIssuesDetail}
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
                  onClick={() => setOpen(item.number === open ? null : item.number)}
                  aria-expanded={item.number === open}
                >
                  <span className={`reviews__num reviews__num--${item.state}`}>#{item.number}</span>
                  <span className="reviews__text">
                    <span className="reviews__title">{item.title}</span>
                    <span className="reviews__sub">
                      {SAYS.by(item.author)}
                      {item.updatedAt === '' ? '' : ` · ${SAYS.changed} ${ago(new Date(item.updatedAt).getTime())}`}
                    </span>
                  </span>
                  <span className={`reviews__state reviews__state--${item.state}`}>{item.state}</span>
                </button>
              </li>
            ))}
          </ul>

            <aside className="reviews__about">
              <h2 className="sheet__blocktitle">
                {chosen.kind === 'pr' ? SAYS.prs : SAYS.issues} #{chosen.number}
              </h2>
              <p className="reviews__abouttitle">{chosen.title}</p>
              <p className="reviews__aboutwhen">
                {SAYS.by(chosen.author)}
                {chosen.updatedAt === ''
                  ? ''
                  : ` · ${SAYS.changed} ${ago(new Date(chosen.updatedAt).getTime())}`}
              </p>

              {(chosen.kind === 'pr') ? (
                <button
                  type="button"
                  className="reviews__do"
                  onClick={() => onReview(chosen)}
                >
                  {SAYS.prAction}
                </button>
              ) : null}

              {chosen.description === null ? (
                <p className="reviews__detail">No description written.</p>
              ) : (
                <p className="reviews__detail">{chosen.description}</p>
              )}

              {chosen.url === '' ? null : (
                <a className="reviews__link" href={chosen.url} target="_blank" rel="noreferrer">
                  {SAYS.openUrl}
                </a>
              )}
            </aside>
          </div>
        )}
      </div>
    </section>
  );
}
