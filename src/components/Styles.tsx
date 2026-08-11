import { useEffect, useState } from 'react';
import type { StyleToken } from '../lib/ipc';
import './Styles.css';

type Props = {
  tokens: readonly StyleToken[];
  /** Where they live, said once so nobody has to wonder what is being edited. */
  file: string;
  /** Called when a nudge settles — on release, not on every frame. */
  onNudge: (name: string, value: string) => void;
  busy?: boolean;
};

export const SAYS = {
  heading: 'Styles',
  none: 'This project has no styles I can offer you knobs for yet.',
  where: (file: string): string => `From ${file}`,
} as const;

/** How many rows before it stops. A panel is not a style editor; it is the
 *  handful of values somebody nudges while looking at their page. */
const MOST = 8;

/**
 * The values that need no judgement, moved directly.
 *
 * Spacing, radius and colour do not need a model, a round trip or a bill — a
 * slider writes the token and the page reloads. The agent is for the things
 * that need thinking about.
 */
export default function Styles({ tokens, file, onNudge, busy }: Props) {
  const shown = tokens.filter((one) => one.steps.length > 0 || one.kind === 'colour').slice(0, MOST);

  if (shown.length === 0) return <p className="styles__none">{SAYS.none}</p>;

  return (
    <div className="styles">
      {shown.map((token) => (
        <Knob key={token.name} token={token} onNudge={onNudge} busy={busy === true} />
      ))}
      <p className="styles__where">{SAYS.where(file)}</p>
    </div>
  );
}

/** One value. A colour opens a picker; everything else steps along the scale
 *  the project already uses, so a nudge can only land on a real value. */
function Knob({
  token,
  onNudge,
  busy,
}: {
  token: StyleToken;
  onNudge: (name: string, value: string) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState(token.value);

  /* Somebody else changed it — the agent, or a put-back. Theirs wins. */
  useEffect(() => setValue(token.value), [token.value]);

  const at = Math.max(0, token.steps.indexOf(value));
  const name = token.name.replace(/^--/, '').replace(/-/g, ' ');

  return (
    <label className="styles__knob">
      <span className="styles__name">{name}</span>

      {token.kind === 'colour' ? (
        <span className="styles__colour">
          <input
            type="color"
            className="styles__picker"
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
            /* On release, not per frame: one version, not two hundred. */
            onBlur={() => value !== token.value && onNudge(token.name, value)}
          />
          <span className="styles__value">{value}</span>
        </span>
      ) : (
        <span className="styles__slider">
          <input
            type="range"
            min={0}
            max={token.steps.length - 1}
            step={1}
            value={at}
            disabled={busy}
            onChange={(event) => setValue(token.steps[Number(event.target.value)] ?? value)}
            onPointerUp={() => value !== token.value && onNudge(token.name, value)}
            onKeyUp={() => value !== token.value && onNudge(token.name, value)}
          />
          <span className="styles__value">{value}</span>
        </span>
      )}
    </label>
  );
}
