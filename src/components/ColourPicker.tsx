import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useAnchored } from '../lib/anchored';
import { hexOf, rgbFrom } from '../design/palette-oklch';
import './ColourPicker.css';

type Props = {
  /** What the row is called, beside the swatch and on the menu. */
  name: string;
  /** The colour as it stands. Always a real hex, even where the value is being
   *  worked out rather than chosen, so the swatch shows what is on screen. */
  value: string;
  /** Null where this one is being worked out from the accent rather than set. */
  chosen: string | null;
  onChange: (hex: string) => void;
  /** Offered only where there is something to go back to. */
  onAuto?: () => void;
};

/** Colours worth one press. Two rows of six: a neutral pair, then the hues
 *  people actually reach for, at a lightness that reads on either ground. */
const READY: readonly { hex: string; says: string }[] = [
  { hex: '#b8492c', says: 'Ember' },
  { hex: '#c2410c', says: 'Rust' },
  { hex: '#b45309', says: 'Amber' },
  { hex: '#4d7c0f', says: 'Moss' },
  { hex: '#0f766e', says: 'Pine' },
  { hex: '#0369a1', says: 'Harbour' },
  { hex: '#4f46e5', says: 'Indigo' },
  { hex: '#7e22ce', says: 'Violet' },
  { hex: '#be123c', says: 'Rose' },
  { hex: '#0f172a', says: 'Ink' },
  { hex: '#57534e', says: 'Stone' },
  { hex: '#fafaf9', says: 'Paper' },
];

const WORDS = {
  auto: 'Auto',
  autoNote: 'Worked out from the accent',
  own: 'Any colour…',
  hex: 'Hex',
} as const;

/** A hex somebody is part way through typing is not a colour yet. */
function readable(text: string): string | null {
  const said = text.trim();
  const full = said.startsWith('#') ? said : `#${said}`;
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(full)) return null;
  const rgb = rgbFrom(full);
  return rgb === null ? null : hexOf(rgb);
}

/**
 * One colour, chosen the way people choose colours.
 *
 * A bare `<input type="color">` is a grey rectangle that opens the operating
 * system's colour wheel: nothing to recognise, nothing to compare against, and
 * three of them in a row read as a form rather than a palette. This is the
 * swatch, what it is set to, and a small menu of colours worth one press, with
 * the wheel still behind "Any colour" for whoever wants it.
 */
export default function ColourPicker({ name, value, chosen, onChange, onAuto }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(value);
  const chip = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const at = useAnchored(chip, open, 'below-right');

  useEffect(() => {
    if (!open) setTyped(value);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (chip.current?.contains(target) === true) return;
      if (menu.current?.contains(target) === true) return;
      setOpen(false);
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      chip.current?.focus();
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const take = (hex: string): void => {
    onChange(hex);
    setOpen(false);
  };

  return (
    <span className="colour">
      <span className="colour__name">{name}</span>
      <button
        ref={chip}
        type="button"
        className="colour__chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={name}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="colour__swatch" style={{ background: value }} aria-hidden="true" />
        <span className="colour__value">{chosen === null ? WORDS.auto : value.toUpperCase()}</span>
      </button>

      {open && at !== null
        ? createPortal(
            <div ref={menu} className="colour__menu" style={at} role="dialog" aria-label={name}>
              <div className="colour__grid">
                {READY.map((one) => (
                  <button
                    key={one.hex}
                    type="button"
                    className={`colour__one ${one.hex.toLowerCase() === value.toLowerCase() ? 'colour__one--on' : ''}`}
                    style={{ background: one.hex }}
                    title={one.says}
                    aria-label={one.says}
                    onClick={() => take(one.hex)}
                  />
                ))}
              </div>

              <div className="colour__row">
                <span className="colour__rowname">{WORDS.hex}</span>
                <input
                  className="colour__hex"
                  value={typed}
                  spellCheck={false}
                  aria-label={WORDS.hex}
                  onChange={(event) => {
                    setTyped(event.target.value);
                    const read = readable(event.target.value);
                    if (read !== null) onChange(read);
                  }}
                />
              </div>

              <label className="colour__row colour__row--press">
                <span className="colour__rowname">{WORDS.own}</span>
                <input
                  type="color"
                  className="colour__wheel"
                  aria-label={WORDS.own}
                  value={value}
                  onChange={(event) => onChange(event.target.value)}
                />
              </label>

              {onAuto === undefined ? null : (
                <button
                  type="button"
                  className={`colour__auto ${chosen === null ? 'colour__auto--on' : ''}`}
                  onClick={() => {
                    onAuto();
                    setOpen(false);
                  }}
                >
                  <span className="colour__rowname">{WORDS.auto}</span>
                  <span className="colour__autonote">{WORDS.autoNote}</span>
                </button>
              )}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
