import { useEffect, useRef, useState } from 'react';
import HelperMark from './HelperMark';
import type { Helper } from '../lib/projects';
import { agoInSentence } from '../lib/when';
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
  count: (n: number) => (n === 1 ? '1 helper' : `${String(n)} helpers`),
  states: { running: 'Working', done: 'Finished', failed: 'Stopped' },
  asked: 'What it was asked',
  said: 'What it said',
  nothingSaid: 'Nothing yet.',
  started: (when: string) => `Started ${when}`,
} as const;

/**
 * Every helper in this sitting: the list, and the selected one whole.
 *
 * A list and a pane, which is the shape every mail client has had for forty
 * years and costs nothing to learn. Up and down move between them. The right
 * half is the whole of what a helper was asked and the whole of what it said —
 * the two things that are otherwise cut to a line each, and the reason this
 * surface exists at all.
 */
export default function HelpersView({ helpers, at, onClose }: Props) {
  const shut = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState<string | null>(at);

  const chosen =
    helpers.find((one) => one.id === picked) ?? helpers[helpers.length - 1] ?? null;

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
          <p className="sheet__from">{SAYS.count(helpers.length)}</p>
        </div>

        <div className="sheet__chips" />

        <button ref={shut} type="button" className="sheet__close" onClick={onClose}>
          {SAYS.close}
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div className="sheet__body helpersview">
        {helpers.length === 0 ? (
          <p className="sheet__nothing helpersview__none">{SAYS.none}</p>
        ) : (
          <>
            {/* In the order they were sent, because that is the order they were
                thought of in and the only one that means anything. */}
            <ul className="helpersview__list">
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
                    <span className="helpersview__rowtask">{helper.task}</span>
                  </button>
                </li>
              ))}
            </ul>

            {chosen === null ? null : (
              <article className="helpersview__one">
                <header className="helpersview__head">
                  <p className="helpersview__state">
                    <HelperMark state={chosen.state} />
                    {SAYS.states[chosen.state]}
                  </p>
                  <p className="helpersview__when">
                    {SAYS.started(agoInSentence(chosen.startedAt, Date.now()))}
                  </p>
                </header>

                <section className="helpersview__part">
                  <h2 className="sheet__blocktitle">{SAYS.asked}</h2>
                  <p className="helpersview__asked">{chosen.task}</p>
                </section>

                <section className="helpersview__part">
                  <h2 className="sheet__blocktitle">{SAYS.said}</h2>
                  {chosen.saying === null ? (
                    <p className="sheet__nothing">{SAYS.nothingSaid}</p>
                  ) : (
                    <p className="helpersview__said">{chosen.saying}</p>
                  )}
                </section>
              </article>
            )}
          </>
        )}
      </div>
    </section>
  );
}
