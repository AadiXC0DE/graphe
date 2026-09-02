import { useState } from 'react';

import {
  appearanceWords,
  cssFor,
  type Appearance,
} from '../design/appearance';
import './AppearanceBand.css';

type Props = {
  appearance: Appearance;
  onChange: (next: Appearance) => void;
  /** Which way the palette runs right now, so the preview is the real thing
   *  rather than a guess at it. */
  on: 'light' | 'dark';
};

/**
 * How the app looks, as a handful of choices.
 *
 * Five colour presets were the whole of it, and a preset is somebody else's
 * taste. One accent and six choices now, and everything else — every surface,
 * every border, every piece of text — is worked out from them and measured
 * before it lands, so there is no combination that produces something nobody
 * can read.
 *
 * The preview is the real stylesheet, scoped to the swatch. Showing a drawing
 * of what a theme might look like is the one thing a theme builder must not do.
 */
export default function AppearanceBand({ appearance, onChange, on }: Props) {
  const [preview, setPreview] = useState<Appearance | null>(null);
  const showing = preview ?? appearance;
  const change = (next: Partial<Appearance>): void => onChange({ ...appearance, ...next });

  const choice = <K extends keyof Appearance>(
    field: K,
    options: readonly { id: Appearance[K]; says: string }[],
  ) => (
    <div className="appearance__choices" role="radiogroup">
      {options.map((one) => (
        <button
          key={String(one.id)}
          type="button"
          role="radio"
          aria-checked={appearance[field] === one.id}
          className={appearance[field] === one.id ? 'appearance__on' : ''}
          /* Hovering shows it before pressing commits it — the whole reason to
             derive a palette rather than pick one is that you can look first. */
          onMouseEnter={() => setPreview({ ...appearance, [field]: one.id })}
          onMouseLeave={() => setPreview(null)}
          onFocus={() => setPreview({ ...appearance, [field]: one.id })}
          onBlur={() => setPreview(null)}
          onClick={() => change({ [field]: one.id } as Partial<Appearance>)}
        >
          {one.says}
        </button>
      ))}
    </div>
  );

  const row = (name: string, hint: string, control: React.ReactNode) => (
    <div className="appearance__row">
      <span className="appearance__text">
        <span className="appearance__name">{name}</span>
        <span className="appearance__hint">{hint}</span>
      </span>
      {control}
    </div>
  );

  return (
    <section className="appearance" aria-label={appearanceWords.name}>
      <style>{cssFor(showing, on, '.appearance__preview')}</style>
      <p className="appearance__note">{appearanceWords.note}</p>

      {row(
        appearanceWords.accent.name,
        appearanceWords.accent.hint,
        <input
          type="color"
          className="appearance__colour"
          aria-label={appearanceWords.accent.name}
          value={appearance.accent}
          onChange={(event) => change({ accent: event.target.value })}
        />,
      )}

      {row(
        appearanceWords.tone.name,
        appearanceWords.tone.hint,
        choice('tone', [
          { id: 'warm', says: appearanceWords.tone.warm },
          { id: 'neutral', says: appearanceWords.tone.neutral },
          { id: 'cool', says: appearanceWords.tone.cool },
        ]),
      )}

      {row(
        appearanceWords.contrast.name,
        appearanceWords.contrast.hint,
        choice('contrast', [
          { id: 'normal', says: appearanceWords.contrast.normal },
          { id: 'high', says: appearanceWords.contrast.high },
        ]),
      )}

      {row(
        appearanceWords.radius.name,
        appearanceWords.radius.hint,
        choice('radius', [
          { id: 'sharp', says: appearanceWords.radius.sharp },
          { id: 'soft', says: appearanceWords.radius.soft },
          { id: 'round', says: appearanceWords.radius.round },
        ]),
      )}

      {row(
        appearanceWords.density.name,
        appearanceWords.density.hint,
        choice('density', [
          { id: 'compact', says: appearanceWords.density.compact },
          { id: 'comfortable', says: appearanceWords.density.comfortable },
          { id: 'spacious', says: appearanceWords.density.spacious },
        ]),
      )}

      {row(
        appearanceWords.motion.name,
        appearanceWords.motion.hint,
        choice('motion', [
          { id: 'full', says: appearanceWords.motion.full },
          { id: 'reduced', says: appearanceWords.motion.reduced },
          { id: 'off', says: appearanceWords.motion.off },
        ]),
      )}

      {row(
        appearanceWords.uiFont.name,
        appearanceWords.uiFont.hint,
        <input
          type="text"
          className="appearance__font"
          aria-label={appearanceWords.uiFont.name}
          value={appearance.uiFont}
          onChange={(event) => change({ uiFont: event.target.value })}
        />,
      )}

      {row(
        appearanceWords.codeFont.name,
        appearanceWords.codeFont.hint,
        <input
          type="text"
          className="appearance__font"
          aria-label={appearanceWords.codeFont.name}
          value={appearance.codeFont}
          onChange={(event) => change({ codeFont: event.target.value })}
        />,
      )}

      {row(
        appearanceWords.ligatures.name,
        appearanceWords.ligatures.hint,
        <button
          type="button"
          role="switch"
          aria-checked={appearance.ligatures}
          className={appearance.ligatures ? 'appearance__on' : ''}
          onClick={() => change({ ligatures: !appearance.ligatures })}
        >
          {appearance.ligatures ? 'On' : 'Off'}
        </button>,
      )}

      {/* The real stylesheet, on real surfaces. A drawing of what a theme might
          look like is the one thing a theme builder must not show. */}
      <div className="appearance__preview">
        <div className="appearance__sample">
          <span className="appearance__sampletitle">The quick brown fox</span>
          <span className="appearance__samplebody">
            Every surface, border and piece of text here is worked out from the accent above.
          </span>
          <span className="appearance__samplecode">const answer = 42; // =&gt; !==</span>
          <span className="appearance__sampleaccent">A press</span>
        </div>
      </div>
    </section>
  );
}
