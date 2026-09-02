import { useEffect, useMemo, useRef } from 'react';

import { findIn, nextFound, threadWords } from '../lib/threadview';
import type { Turn } from '../lib/thread';
import './FindInThread.css';

type Props = {
  /** The whole conversation, not the part of it that is drawn. */
  turns: readonly Turn[];
  term: string;
  onTerm: (term: string) => void;
  /** Which turn the reader is standing on, by its place in `turns`. */
  at: number | null;
  /** Go to a result: which turn, and how much of the conversation has to be
   *  drawn for it to be on screen at all. */
  onAt: (turn: number, showFrom: number) => void;
  onClose: () => void;
};

/**
 * Finding a word in a long conversation.
 *
 * The browser's own find reaches only what is drawn, and a conversation draws
 * its tail. This searches every turn, says how many it found and where, and
 * asks for enough of the conversation to be drawn before it scrolls.
 */
export default function FindInThread({ turns, term, onTerm, at, onAt, onClose }: Props) {
  const box = useRef<HTMLInputElement>(null);
  const found = useMemo(() => findIn(turns, term), [turns, term]);

  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);

  /* A result is at a place in the whole conversation; the tail is drawn from
     the end, so reaching one means drawing everything after it too. */
  const go = (to: number | null): void => {
    if (to === null) return;
    onAt(to, turns.length - to);
  };

  const standing = at === null ? -1 : found.findIndex((one) => one.at === at);
  const line = standing < 0 ? (found[0]?.line ?? '') : (found[standing]?.line ?? '');

  return (
    <div className="findthread" role="search">
      <input
        ref={box}
        type="search"
        className="findthread__box"
        value={term}
        placeholder={threadWords.find}
        aria-label={threadWords.find}
        onChange={(event) => onTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            go(nextFound(found, at));
          }
        }}
      />

      {term.trim() === '' ? null : (
        <span className="findthread__count">
          {found.length === 0
            ? threadWords.nothingFound
            : threadWords.found(standing < 0 ? 1 : standing + 1, found.length)}
        </span>
      )}

      {/* The line the result sits on, so a result is legible without opening
          it. Truncated by the stylesheet rather than here: a sentence cut in
          the middle of a word is worse than one that runs off the end. */}
      {line === '' ? null : <span className="findthread__line">{line}</span>}

      <button
        type="button"
        className="findthread__act"
        onClick={() => go(nextFound(found, at))}
        disabled={found.length === 0}
      >
        Next
      </button>
      <button type="button" className="findthread__act" onClick={onClose}>
        Done
      </button>
    </div>
  );
}
