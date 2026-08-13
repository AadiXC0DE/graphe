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
};

export const SAYS = {
  heading: 'Pull requests',
  from: (full: string): string => `github.com/${full}`,
  refresh: 'Refresh',
  empty: 'Nothing here to review yet.',
  noRepo:
    'This folder is not a github repository, or github is not set up on your terminal.',
  noRepoDetail:
    'You need the github CLI (`gh`) installed and logged in — the same one your terminal uses — and the project needs a `github.com` remote.',
  issues: 'Issues',
  prs: 'Pull requests',
  prAction: 'Review this PR',
  openUrl: 'Open in github',
  by: (author: string): string => `by ${author}`,
  changed: 'Updated',
} as const;

/** Open a pull request, whole, and review it in the conversation. */
export function reviewPrompt(item: RepoItem, full: string): string {
  return `Review pull request #${item.number} in ${full} and post your findings.

“${item.title}”

This is the one thing you should do now: a careful, honest review of the whole PR. Assume there are bugs until you have read enough to believe otherwise.

Read what you need through your terminal, where the person’s github is already logged in:
- \`gh pr view ${item.number} -R ${full}\` — title, description, base branch, the issue(s) it links
- \`gh pr diff ${item.number} -R ${full}\` — every line the PR changes, held against its base branch
- \`gh issue view <n> -R ${full}\` — for each issue the PR says it closes (find them in the PR body)
- walk the checked-out code in this folder for the surrounding context, so a change makes sense against how the project is actually built

Review it like a senior engineer on the team, not a checklist:
- Does it actually solve the issue it claims to close?
- Correctness bugs and edge cases a test would miss; silent failures and swallowed errors
- Security problems, missing validation, unsafe data handling
- Regressions and dead code; anything that breaks what worked before
- Whether names, shapes and structure match the rest of the codebase
Be specific: name file paths and lines, and give a one-line reason for every point. Separate “must change” from “could be nicer”. If it is genuinely good to merge, say so plainly.

When you are done, post the review on the PR itself. Write it to a temporary file, then:
\`gh pr comment ${item.number} -R ${full} --body-file <file>\`

Start your comment with the heading “## Automated PR review” so it reads clearly as a machine review. If you truly cannot post (github is not reachable from your terminal), leave the full review here in the conversation instead so nothing is lost.`;
}

export default function ReviewsView({ repo, busy, onRefresh, onClose, onReview }: Props) {
  const shut = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<'prs' | 'issues'>('prs');
  const [open, setOpen] = useState<number | null>(null);

  // The only fetch, on the way in, so the screen is never blank the first time.
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

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
          <div className="sheet__chips" />
          <button ref={shut} type="button" className="sheet__refresh" onClick={onRefresh} disabled={busy}>
            {busy ? 'Fetching…' : SAYS.refresh}
          </button>
          <button type="button" className="sheet__close" onClick={onClose}>
            Close
            <kbd className="sheet__key">Esc</kbd>
          </button>
        </header>
        <div className="sheet__body">
          <div className="reviews reviews--empty">
            <h2 className="reviews__none">{SAYS.noRepo}</h2>
            <p className="reviews__detail">{SAYS.noRepoDetail}</p>
          </div>
        </div>
      </section>
    );
  }

  const items = tab === 'prs' ? repo.prs : repo.issues;
  const empty = items.length === 0;
  const chosen = items.find((one) => one.number === open) ?? null;

  return (
    <section className="sheet" aria-label={SAYS.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{SAYS.heading}</h1>
          <a className="sheet__from" href={repo.url} target="_blank" rel="noreferrer">
            {SAYS.from(repo.full)}
          </a>
        </div>

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

      <div className="sheet__body">
        <div className="reviews">
          <ul className="reviews__list">
            {empty ? <p className="reviews__none">{SAYS.empty}</p> : null}
            {items.map((item) => (
              <li key={`${item.kind}-${item.number}`}>
                <button
                  type="button"
                  className={`reviews__row ${item.number === open ? 'reviews__row--open' : ''}`}
                  onClick={() => setOpen(item.number === open ? null : item.number)}
                  aria-expanded={item.number === open}
                >
                  <span className="reviews__num">#{item.number}</span>
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

          {chosen === null ? (
            <aside className="reviews__about">
              <p className="reviews__hint">
                Pick one on the left to read what it is about.
              </p>
            </aside>
          ) : (
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
          )}
        </div>
      </div>
    </section>
  );
}
