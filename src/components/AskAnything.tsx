import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MOST_WE_SHOW, findAnything, kindWords } from '../lib/anything';
import type { Found, Things } from '../lib/anything';
import { usePrefersReducedMotion } from '../lib/motion';
import './AskAnything.css';

/** Every word on this bar, in one place, so the copy can be read without
 *  reading the markup. */
export const SAYS = {
  title: 'Ask for anything',
  placeholder: 'Go somewhere, or just say what you want',
  close: 'Close',
  results: 'What I found',
  empty: 'Start typing. Anything I can’t find, I’ll just do.',
  move: 'to move',
  choose: 'to go',
  dismiss: 'esc to close',
} as const;

type Props = {
  /** Everything the window can jump to right now. */
  things: Things;
  /** Somebody chose a row. The kind says what it is; the payload is the thing
   *  itself. This closes on its own straight after. */
  onPick: (found: Found) => void;

  /** Open it from somewhere else — a button in the window. Leave this off and
   *  the bar looks after itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;

  placeholder?: string;
  /** How many rows to show at once, the "say this" row included. */
  limit?: number;
};

const ROW = (index: number) => `askanything-row-${index}`;
const LIST = 'askanything-list';

/**
 * Ask for anything: one line that goes wherever you meant.
 *
 * It reads what you type against the projects, conversations, pages and
 * versions on hand, and the last row is always the sentence itself — because
 * the answer to "I can't find it" in this product is to say what you wanted and
 * have it done. Nothing here has to be learned in a particular order: a name
 * gets you a place, a sentence gets you work.
 *
 * Presentational and self-contained. It owns whether it is open and which row
 * is lit, and nothing else; where a row leads is the caller's business.
 */
export default function AskAnything({
  things,
  onPick,
  open: fromOutside,
  onOpenChange,
  placeholder,
  limit = MOST_WE_SHOW,
}: Props) {
  const [mine, setMine] = useState(false);
  const open = fromOutside ?? mine;

  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  /** Read once each time it opens, so "3 minutes ago" does not drift under
   *  somebody's fingers while they type. */
  const [now, setNow] = useState(() => Date.now());

  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const reduced = usePrefersReducedMotion();

  const setOpen = useCallback(
    (next: boolean) => {
      if (fromOutside === undefined) setMine(next);
      onOpenChange?.(next);
    },
    [fromOutside, onOpenChange],
  );

  const found = useMemo(
    () => findAnything(query, things, { now, limit }),
    [query, things, now, limit],
  );

  // A fresh box every time, and a clock reading to go with it.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
    setNow(Date.now());
  }, [open]);

  // Focus goes into the field and comes back to wherever it was.
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    field.current?.focus();
    return () => returnTo.current?.focus();
  }, [open]);

  /* The one shortcut, and the way out. Both are caught before anything else in
     the window sees them: Escape here must close this bar and only this bar,
     never the panel underneath it as well. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(!open);
        return;
      }
      if (open && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, setOpen]);

  // The lit row follows the list when the list is longer than the window.
  useEffect(() => {
    if (!open) return;
    const row = list.current?.children[highlight];
    row?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [open, highlight, reduced]);

  const choose = useCallback(
    (one: Found | undefined) => {
      if (one === undefined) return;
      setOpen(false);
      onPick(one);
    },
    [onPick, setOpen],
  );

  if (!open) return null;

  const lit = Math.min(highlight, Math.max(0, found.length - 1));

  const move = (by: number) => {
    if (found.length === 0) return;
    setHighlight((lit + by + found.length) % found.length);
  };

  return (
    <div className="askanything" role="dialog" aria-modal="true" aria-label={SAYS.title}>
      <button
        type="button"
        className="askanything__backdrop"
        onClick={() => setOpen(false)}
        aria-label={SAYS.close}
        tabIndex={-1}
      />

      <div className="askanything__panel">
        <div className="askanything__field">
          <svg
            className="askanything__mark"
            viewBox="0 0 14 14"
            width="14"
            height="14"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="6.2" cy="6.2" r="4.2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.4 9.4 12.4 12.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>

          <input
            ref={field}
            className="askanything__input"
            type="text"
            role="combobox"
            aria-label={SAYS.title}
            aria-expanded
            aria-controls={LIST}
            aria-autocomplete="list"
            aria-activedescendant={found.length === 0 ? undefined : ROW(lit)}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder ?? SAYS.placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              // Only the field takes focus in here, so a trap is a Tab that
              // goes nowhere rather than one that cycles between two things.
              if (event.key === 'Tab') {
                event.preventDefault();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                move(1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                move(-1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                setHighlight(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                setHighlight(Math.max(0, found.length - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(found[lit]);
              }
            }}
          />
        </div>

        <ul
          ref={list}
          id={LIST}
          className="askanything__list"
          role="listbox"
          aria-label={SAYS.results}
        >
          {found.map((one, index) => (
            <li
              key={one.id}
              id={ROW(index)}
              role="option"
              aria-selected={index === lit}
              className={`askanything__row ${index === lit ? 'askanything__row--lit' : ''} ${
                one.kind === 'say' ? 'askanything__row--say' : ''
              }`}
              // Down rather than click: the field must not lose focus first.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(one);
              }}
              onMouseMove={() => setHighlight(index)}
            >
              <span className="askanything__text">
                <span className="askanything__label">{one.label}</span>
                <span className="askanything__sub">{one.sub}</span>
              </span>
              <span className="askanything__kind">{kindWords[one.kind]}</span>
            </li>
          ))}
        </ul>

        {found.length === 0 ? <p className="askanything__blank">{SAYS.empty}</p> : null}

        <footer className="askanything__foot">
          <span className="askanything__hint">
            <kbd className="askanything__key">↑</kbd>
            <kbd className="askanything__key">↓</kbd> {SAYS.move}
          </span>
          <span className="askanything__hint">
            <kbd className="askanything__key">↵</kbd> {SAYS.choose}
          </span>
          <span className="askanything__hint askanything__hint--last">{SAYS.dismiss}</span>
        </footer>
      </div>
    </div>
  );
}
