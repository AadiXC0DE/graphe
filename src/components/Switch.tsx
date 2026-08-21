import './Switch.css';

type Props = {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Said to the screen reader, since the drawn control carries no words. */
  label: string;
  disabled?: boolean;
};

/**
 * A switch, drawn once and used everywhere.
 *
 * A button wearing the role of a switch rather than a checkbox: the native
 * control was doing the work in a browser nobody is looking at — square,
 * grey, out of key with everything around it — and a labelled input cannot be
 * dropped into these rows at all, because the rows are labels themselves and
 * labels do not nest. Being a button also means focus, keyboard and press
 * come free; the state is `aria-checked`, and the drawing over it is ours: a
 * track that fills when it is on, a knob that travels the width of the track
 * and never scales from nothing. Pressing nudges the knob down, so the
 * control answers the hand before the state changes.
 *
 * The `tswitch` class prefix is deliberate: a plain `.switch` already exists
 * in ProjectMenu for its own row switches, and two components under the same
 * name would cancel each other out in the cascade.
 */
export default function Switch({ on, onChange, label, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`tswitch ${on ? 'tswitch--on' : ''} ${disabled === true ? 'tswitch--off-duty' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="tswitch__track" aria-hidden="true">
        <span className="tswitch__knob" />
      </span>
    </button>
  );
}
