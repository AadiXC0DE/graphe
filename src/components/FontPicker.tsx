import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { SYSTEM_FONT } from '../design/appearance';
import { useAnchored } from '../lib/anchored';
import './FontPicker.css';

type Props = {
  value: string;
  onChange: (family: string) => void;
  /** A line drawn in the family itself, so a font is read rather than named. */
  sample: string;
  mono?: boolean;
  label: string;
};

/** What is offered where the installed fonts cannot be read: a browser tab, or
 *  a build whose window never granted it. A short list beats an empty one. */
const FALLBACK: readonly string[] = [
  SYSTEM_FONT,
  'Satoshi',
  'Inter',
  'SF Pro Text',
  'Helvetica Neue',
  'Geist',
  'JetBrains Mono',
  'SF Mono',
  'Menlo',
  'Fira Code',
];

/** Enough rows to find anything by typing, few enough to draw at once. */
const MOST = 200;

export const FONT_WORDS = {
  find: 'Find a font',
  reading: 'Reading the fonts on this computer…',
  nothing: 'No font here goes by that name.',
} as const;

/**
 * Which font, from the ones actually installed.
 *
 * A text field asked for a family name spelled exactly, which nobody knows, and
 * answered a typo by falling back to the system stack without a word. Every row
 * is drawn in its own family, so the choice is made by looking.
 */
export default function FontPicker({ value, onChange, sample, mono = false, label }: Props) {
  const [families, setFamilies] = useState<readonly string[] | null>(null);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const at = useAnchored(chip, open, 'below-right');

  /* Asked for on the first press rather than at render: reading every installed
     font is a permission prompt on some machines and a pause on all of them. */
  useEffect(() => {
    if (!open || families !== null) return;
    const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> })
      .queryLocalFonts;
    if (query === undefined) {
      setFamilies(FALLBACK);
      return;
    }
    void query()
      .then((found) => setFamilies([SYSTEM_FONT, ...new Set(found.map((one) => one.family))].sort()))
      .catch(() => setFamilies(FALLBACK));
  }, [open, families]);

  useEffect(() => {
    if (!open) {
      setTerm('');
      return;
    }
    const away = (event: MouseEvent) => {
      const inside =
        chip.current?.contains(event.target as Node) === true ||
        list.current?.contains(event.target as Node) === true;
      if (!inside) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Closes this and only this: left to travel on, the same press reaches
      // the sheet behind it.
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const needle = term.trim().toLowerCase();
  const shown = (families ?? [])
    .filter((one) => one.toLowerCase().includes(needle))
    .slice(0, MOST);

  return (
    <div className="fontpicker">
      <button
        ref={chip}
        type="button"
        className="fontpicker__chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        style={{ fontFamily: value === SYSTEM_FONT ? undefined : `'${value}'` }}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="fontpicker__now">{value}</span>
        <span className="fontpicker__sample">{sample}</span>
      </button>

      {open
        ? createPortal(
            <div
              ref={list}
              className="fontpicker__list scroll--auto"
              style={at ?? undefined}
              role="listbox"
              aria-label={label}
            >
              <input
                className="fontpicker__find"
                autoFocus
                placeholder={FONT_WORDS.find}
                aria-label={FONT_WORDS.find}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
              />
              {families === null ? (
                <p className="fontpicker__quiet">{FONT_WORDS.reading}</p>
              ) : shown.length === 0 ? (
                <p className="fontpicker__quiet">{FONT_WORDS.nothing}</p>
              ) : (
                shown.map((one) => (
                  <button
                    key={one}
                    type="button"
                    role="option"
                    aria-selected={one === value}
                    className={`fontpicker__one ${one === value ? 'fontpicker__one--on' : ''}`}
                    style={{ fontFamily: one === SYSTEM_FONT ? undefined : `'${one}'` }}
                    onClick={() => {
                      onChange(one);
                      setOpen(false);
                    }}
                  >
                    {one}
                    {mono ? <code className="fontpicker__mono">0O il1 =&gt;</code> : null}
                  </button>
                ))
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
