import { useEffect, useMemo, useRef, useState } from 'react';
import Clipped, { howMuch } from './Clipped';
import HelperMark from './HelperMark';
import Markdown from './Markdown';
import type { Helper } from '../lib/projects';
import { useCopying } from '../lib/copying';
import { ago, agoInSentence } from '../lib/when';
import './HelpersView.css';
import './Sheet.css';

type Props = {
  helpers: readonly Helper[];
  /** Which one to open on. Null opens on the newest. */
  at: string | null;
  onClose: () => void;
};

export const SAYS = {
  heading: 'Helpers',
  close: 'Close',
  none: 'Nothing has been sent off in this conversation.',
  noneDetail: 'When a turn sends work off to a helper, it appears here with what it was asked and what it came back with.',
  count: (n: number) => (n === 1 ? '1 helper' : `${String(n)} helpers`),
  states: { running: 'Working', done: 'Finished', failed: 'Stopped' },
  asked: 'What it was asked',
  said: 'What it said',
  nothingSaid: 'Nothing yet.',
  nothingSaidWorking: 'Still working. What it says will appear here.',
  started: (when: string) => `Started ${when}`,
  copyAsked: 'Copy the ask',
  copySaid: 'Copy the answer',
  showAll: 'Show all of it',
} as const;

/** The tally under the heading: how many, and how they are getting on. */
export function tallyOf(helpers: readonly Helper[]): string {
  const parts: string[] = [SAYS.count(helpers.length)];
  const counts = { running: 0, done: 0, failed: 0 };
  for (const one of helpers) counts[one.state] += 1;
  const said: string[] = [];
  if (counts.running > 0) said.push(`${String(counts.running)} working`);
  if (counts.done > 0) said.push(`${String(counts.done)} finished`);
  if (counts.failed > 0) said.push(`${String(counts.failed)} stopped`);
  if (said.length > 0) parts.push(said.join(', '));
  return parts.join(' · ');
}

/**
 * A helper's own name.
 *
 * The whole ask is a paragraph of instructions; a row of them is four
 * paragraphs, each cut mid-sentence in the same place. The first sentence, or
 * the first line, is what somebody wrote it as and is what tells one from
 * another at a glance.
 */
export function titleOf(task: string): string {
  const first = task.split('\n').find((line) => line.trim() !== '')?.trim() ?? task.trim();
  const stop = first.search(/[.!?](\s|$)/);
  const said = stop > 12 ? first.slice(0, stop) : first;
  return said.length > 90 ? `${said.slice(0, 89).trimEnd()}…` : said;
}

/**
 * Every helper in this sitting: the list, and the selected one whole.
 *
 * A list and a pane, which is the shape every mail client has had for forty
 * years and costs nothing to learn. Up and down move between them. The right
 * half is the whole of what a helper was asked and the whole of what it said,
 * the two things that are otherwise cut to a line each, and the reason this
 * surface exists at all.
 */
export default function HelpersView({ helpers, at, onClose }: Props) {
  const shut = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState<string | null>(at);
  const copyAsked = useCopying({ idle: SAYS.copyAsked });
  const copySaid = useCopying({ idle: SAYS.copySaid });

  const chosen =
    helpers.find((one) => one.id === picked) ?? helpers[helpers.length - 1] ?? null;
  const tally = useMemo(() => tallyOf(helpers), [helpers]);

  useEffect(() => {
    shut.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const here = helpers.findIndex((one) => one.id === chosen?.id);
      if (here === -1) return;
      const next = event.key === 'ArrowDown' ? here + 1 : here - 1;
      const going = helpers[next];
      if (going === undefined) return;
      event.preventDefault();
      setPicked(going.id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, helpers, chosen]);

  return (
    <section className="sheet" aria-label={SAYS.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{SAYS.heading}</h1>
          <p className="sheet__from">{helpers.length === 0 ? SAYS.none : tally}</p>
        </div>

        <div className="sheet__chips" />

        <button ref={shut} type="button" className="sheet__close" onClick={onClose}>
          {SAYS.close}
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      {helpers.length === 0 ? (
        <div className="sheet__body">
          <div className="helpersview__blank">
            <h2 className="helpersview__blanktitle">{SAYS.none}</h2>
            <p className="helpersview__blankdetail">{SAYS.noneDetail}</p>
          </div>
        </div>
      ) : (
        <div className="sheet__body helpersview">
          {/* In the order they were sent, because that is the order they were
              thought of in and the only one that means anything. */}
          <ul className="helpersview__list scroll--auto">
            {helpers.map((helper) => (
              <li key={helper.id}>
                <button
                  type="button"
                  className={`helpersview__row ${
                    helper.id === chosen?.id ? 'helpersview__row--here' : ''
                  }`}
                  onClick={() => setPicked(helper.id)}
                  aria-current={helper.id === chosen?.id}
                >
                  <HelperMark state={helper.state} />
                  <span className="helpersview__rowtext">
                    <span className="helpersview__rowtask">{titleOf(helper.task)}</span>
                    <span className="helpersview__rowsub">
                      {SAYS.states[helper.state]} · {ago(helper.startedAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {chosen === null ? null : (
            <article className="helpersview__one scroll--auto">
              <header className="helpersview__head">
                <p className={`helpersview__state helpersview__state--${chosen.state}`}>
                  <HelperMark state={chosen.state} />
                  {SAYS.states[chosen.state]}
                </p>
                <p className="helpersview__when">
                  {SAYS.started(agoInSentence(chosen.startedAt, Date.now()))}
                </p>
              </header>

              <h2 className="helpersview__title">{titleOf(chosen.task)}</h2>

              <section className="helpersview__part">
                <div className="helpersview__partop">
                  <h3 className="sheet__blocktitle">{SAYS.asked}</h3>
                  <button
                    type="button"
                    className="helpersview__act"
                    onClick={() => copyAsked.copy(chosen.task)}
                  >
                    {copyAsked.label}
                  </button>
                </div>
                {/* The ask is a paragraph of instructions somebody wrote for a
                    machine. It is worth having in full and not worth the top of
                    the screen every time. */}
                <Clipped how={howMuch(chosen.task)} label={SAYS.showAll} height={200}>
                  <p className="helpersview__asked">{chosen.task}</p>
                </Clipped>
              </section>

              <section className="helpersview__part">
                <div className="helpersview__partop">
                  <h3 className="sheet__blocktitle">{SAYS.said}</h3>
                  {chosen.saying === null ? null : (
                    <button
                      type="button"
                      className="helpersview__act"
                      onClick={() => copySaid.copy(chosen.saying ?? '')}
                    >
                      {copySaid.label}
                    </button>
                  )}
                </div>
                {chosen.saying === null ? (
                  <p className="helpersview__quiet">
                    {chosen.state === 'running' ? SAYS.nothingSaidWorking : SAYS.nothingSaid}
                  </p>
                ) : (
                  <div className="helpersview__said">
                    <Markdown text={chosen.saying} />
                  </div>
                )}
              </section>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
