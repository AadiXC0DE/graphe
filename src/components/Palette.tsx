import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { KEY_WORDS, grouped, isReady, matches, type Command } from '../lib/commands';
import { saysChord } from '../lib/keys';
import './Palette.css';

/** Every word on this panel, so the copy can be read without the markup. */
export const SAYS = {
  title: 'Things you can do',
  close: 'Close',
  list: 'What you can do',
  move: 'to move',
  choose: 'to run',
  dismiss: 'esc to close',
} as const;

const LIST = 'palette-list';
const ROW = (at: number) => `palette-row-${at}`;

/* -------------------------------------------------------------------------- */
/* What the keyboard walks                                                     */
/* -------------------------------------------------------------------------- */

/** A row as the list draws it, and where the arrow keys reach it. */
export type Row = { command: Command; at: number };
export type Shown = { where: string; rows: readonly Row[] };

/**
 * What a typed word shows, in bands, each row carrying its own place.
 *
 * Bands re-bucket the ranked list, so a row's place on screen is not its place
 * in `matches` — the number has to be handed out here, once, or the arrows and
 * the eye disagree.
 */
export function shownBands(commands: readonly Command[], query: string): readonly Shown[] {
  let at = 0;
  return grouped(matches(commands, query)).map((band) => ({
    where: band.where,
    rows: band.commands.map((command) => ({ command, at: at++ })),
  }));
}

/** Every row in the one order the arrows walk. */
export function walkOrder(bands: readonly Shown[]): readonly Command[] {
  return bands.flatMap((band) => band.rows.map((row) => row.command));
}

/**
 * Where the highlight lands after a move.
 *
 * It wraps. Down at the bottom returns to the top, which is how somebody who
 * has held the key finds their way back without letting go.
 */
export function movedTo(at: number, by: number, count: number): number {
  if (count <= 0) return 0;
  return (((at + by) % count) + count) % count;
}

/** Which row is lit, given a highlight that may be stale — the list shortens
 *  under the fingers as somebody types. -1 when there is nothing to light. */
export function litRow(at: number, count: number): number {
  if (count <= 0) return -1;
  return Math.min(Math.max(at, 0), count - 1);
}

/**
 * The command Enter would run, or nothing.
 *
 * A command that cannot run is still walked and still read — skipping it with
 * the arrows would hide the one row that says why it is stopped.
 */
export function chosenAt(rows: readonly Command[], at: number): Command | null {
  const command = rows[at];
  if (command === undefined) return null;
  return isReady(command) ? command : null;
}

/** Why a stopped command is stopped, in its own words or the general ones. */
export function whyNotOf(command: Command): string {
  const said = command.whyNot?.trim() ?? '';
  return said === '' ? KEY_WORDS.notReady : said;
}

/** What to say when no row is drawn. Nothing registered and nothing found are
 *  different problems, and only one of them is answered by typing less. */
export function blankWords(total: number, shown: number): string | null {
  if (shown > 0) return null;
  return total === 0 ? KEY_WORDS.empty : KEY_WORDS.nothing;
}

/** Which key this machine holds. Read once — nobody changes computer mid-list. */
export function onMacHere(): boolean {
  const here: { platform?: string; userAgent?: string } | undefined = globalThis.navigator;
  return /mac/i.test(here?.platform ?? here?.userAgent ?? '');
}

/* -------------------------------------------------------------------------- */
/* The panel                                                                   */
/* -------------------------------------------------------------------------- */

type Props = {
  open: boolean;
  commands: readonly Command[];
  onClose: () => void;
  onMac?: boolean;
};

/**
 * Everything this window can do, reachable by typing three letters of its name.
 *
 * Opened and closed by a key, many times a day, so it arrives and leaves with
 * no animation at all: anything that fades in is a delay between the press and
 * the typing. The only movement in here is a row answering a press.
 */
export default function Palette({ open, commands, onClose, onMac }: Props) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [macHere] = useState(onMacHere);
  const mac = onMac ?? macHere;

  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const bands = useMemo(() => shownBands(commands, query), [commands, query]);
  const rows = useMemo(() => walkOrder(bands), [bands]);
  const lit = litRow(highlight, rows.length);

  // A fresh box every time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
  }, [open]);

  // Focus goes into the field and comes back to wherever it was.
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    field.current?.focus();
    return () => returnTo.current?.focus();
  }, [open]);

  // Escape closes this and only this, never the panel behind it as well.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  // The lit row follows the arrows, and jumps rather than glides: this list is
  // walked with a held key, and a smooth scroll would trail the hand.
  useEffect(() => {
    if (!open || lit < 0) return;
    list.current?.querySelector(`[data-at="${lit}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, lit]);

  const run = useCallback(
    (command: Command | null) => {
      if (command === null) return;
      onClose();
      command.run();
    },
    [onClose],
  );

  if (!open) return null;

  const blank = blankWords(commands.length, rows.length);

  return (
    <div className="palette" role="dialog" aria-modal="true" aria-label={SAYS.title}>
      <button
        type="button"
        className="palette__backdrop"
        onClick={onClose}
        aria-label={SAYS.close}
        tabIndex={-1}
      />

      <div className="palette__panel">
        <div className="palette__field">
          <svg
            className="palette__mark"
            viewBox="0 0 14 14"
            width="14"
            height="14"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="6.2" cy="6.2" r="4.2" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M9.4 9.4 12.4 12.4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>

          <input
            ref={field}
            className="palette__input"
            type="text"
            role="combobox"
            aria-label={SAYS.title}
            aria-expanded
            aria-controls={LIST}
            aria-autocomplete="list"
            aria-activedescendant={lit < 0 ? undefined : ROW(lit)}
            autoComplete="off"
            spellCheck={false}
            placeholder={KEY_WORDS.placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              // The field is the only thing in here that takes focus, so the
              // trap is a Tab that goes nowhere rather than one that cycles.
              if (event.key === 'Tab') {
                event.preventDefault();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlight(movedTo(lit, 1, rows.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlight(movedTo(lit, -1, rows.length));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(chosenAt(rows, lit));
              }
            }}
          />
        </div>

        <div ref={list} id={LIST} className="palette__list" role="listbox" aria-label={SAYS.list}>
          {bands.map((band) => (
            <div key={band.where} className="palette__band" role="group" aria-label={band.where}>
              <div className="palette__bandhead" aria-hidden="true">
                {band.where}
              </div>

              {band.rows.map(({ command, at }) => {
                const ready = isReady(command);
                return (
                  <div
                    key={command.id}
                    id={ROW(at)}
                    data-at={at}
                    role="option"
                    aria-selected={at === lit}
                    aria-disabled={ready ? undefined : true}
                    className={`palette__row ${at === lit ? 'palette__row--lit' : ''} ${
                      ready ? '' : 'palette__row--stopped'
                    }`}
                    // Down rather than click: the field must not lose focus.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      run(ready ? command : null);
                    }}
                    onMouseMove={() => setHighlight(at)}
                  >
                    <span className="palette__name">{command.name}</span>
                    {ready ? (
                      command.keys === undefined || command.keys === '' ? null : (
                        <kbd className="palette__chord">{saysChord(command.keys, mac)}</kbd>
                      )
                    ) : (
                      // The chord is dropped with the command: printing a key
                      // that will not fire is worse than printing nothing.
                      <span className="palette__why">{whyNotOf(command)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {blank === null ? null : <p className="palette__blank">{blank}</p>}

        <footer className="palette__foot">
          <span className="palette__hint">
            <kbd className="palette__key">↑</kbd>
            <kbd className="palette__key">↓</kbd> {SAYS.move}
          </span>
          <span className="palette__hint">
            <kbd className="palette__key">↵</kbd> {SAYS.choose}
          </span>
          <span className="palette__hint palette__hint--last">{SAYS.dismiss}</span>
        </footer>
      </div>
    </div>
  );
}
