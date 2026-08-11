import { useEffect, useRef, useState } from 'react';
import type { Swatch } from '../design/artifacts';
import './Swatches.css';

type Props = {
  swatches: readonly Swatch[];
  /** Absent means the chips are a picture of the palette and nothing more. */
  onCopy?: (value: string) => void;
};

const COPIED = 'Copied';
const HOW_LONG = 1400;

/**
 * A palette, drawn.
 *
 * Colour is the one thing a list of hex codes cannot tell you, so the colour is
 * the chip and the name and value sit under it. Each one carries a hairline of
 * its own, because a white swatch on a white page is otherwise a blank square.
 */
export default function Swatches({ swatches, onCopy }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  if (swatches.length === 0) return null;

  const take = (swatch: Swatch) => {
    if (onCopy === undefined) return;
    onCopy(swatch.value);
    setCopied(swatch.name);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), HOW_LONG);
  };

  return (
    <ul className="swatches">
      {swatches.map((swatch) => {
        const inside = (
          <>
            <span className="swatches__well" style={{ background: swatch.value }} />
            <span className="swatches__text">
              <span className="swatches__name">{swatch.name}</span>
              <span className="swatches__value">
                {copied === swatch.name ? COPIED : swatch.value}
              </span>
            </span>
          </>
        );

        return (
          <li key={swatch.name} className="swatches__one">
            {onCopy === undefined ? (
              <span className="swatches__chip">{inside}</span>
            ) : (
              <button
                type="button"
                className="swatches__chip swatches__chip--live"
                onClick={() => take(swatch)}
                title={`${swatch.name} — ${swatch.value}`}
              >
                {inside}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
