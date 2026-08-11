import { useEffect, useId, useMemo, useState } from 'react';
import {
  controlFor,
  groupTokens,
  readable,
  specimenSize,
  type GroupId,
  type StyleGroup,
} from '../design/grouping';
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
  more: (count: number): string =>
    count === 1 ? '1 more in the file' : `${String(count)} more in the file`,
  pickHint: 'Hover a colour to read it.',
  /** Two letters with an ascender and a descender: the shape of a size. */
  specimen: 'Ag',
} as const;

/** Shelves everybody wants open the moment the panel appears. The leftovers
 *  start shut because they are the ones nobody came here for. */
const SHUT_AT_FIRST: readonly GroupId[] = ['other'];

type Nudge = (name: string, value: string) => void;

/**
 * The values that need no judgement, moved directly.
 *
 * Spacing, radius and colour do not need a model, a round trip or a bill — a
 * slider writes the token and the page reloads. The agent is for the things
 * that need thinking about.
 */
export default function Styles({ tokens, file, onNudge, busy }: Props) {
  const groups = useMemo(() => groupTokens(tokens), [tokens]);
  const [shut, setShut] = useState<ReadonlySet<GroupId>>(() => new Set(SHUT_AT_FIRST));
  const base = useId();

  if (groups.length === 0) return <p className="styles__none">{SAYS.none}</p>;

  const toggle = (id: GroupId): void =>
    setShut((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="styles">
      {groups.map((group) => {
        const open = !shut.has(group.id);
        const panel = `${base}-${group.id}`;
        return (
          <section className="styles__group" key={group.id}>
            <button
              type="button"
              className={`styles__band${open ? ' styles__band--open' : ''}`}
              aria-expanded={open}
              aria-controls={panel}
              onClick={() => toggle(group.id)}
            >
              <span className="styles__caret" aria-hidden="true" />
              <span className="styles__shelf">{group.title}</span>
              <span className="styles__count">{group.tokens.length + group.hidden}</span>
            </button>

            <div className="styles__body" id={panel} hidden={!open}>
              <Shelf group={group} onNudge={onNudge} busy={busy === true} />
              {group.hidden > 0 ? <p className="styles__rest">{SAYS.more(group.hidden)}</p> : null}
            </div>
          </section>
        );
      })}
      <p className="styles__where">{SAYS.where(file)}</p>
    </div>
  );
}

function Shelf({ group, onNudge, busy }: { group: StyleGroup; onNudge: Nudge; busy: boolean }) {
  if (group.id === 'colour') return <Palette tokens={group.tokens} onNudge={onNudge} busy={busy} />;
  if (group.id === 'shadow') return <Shadows tokens={group.tokens} />;

  const type = group.id === 'type';
  const Row = type ? TypeStep : Step;

  return (
    <div className={`styles__scale${type ? ' styles__scale--type' : ''}`}>
      {group.tokens
        .filter((token) => controlFor(token) === 'steps')
        .map((token) => (
          <Row key={token.name} token={token} onNudge={onNudge} busy={busy} />
        ))}
    </div>
  );
}

/** Local while the hand is moving; theirs the moment anybody else changes it. */
function useKnob(token: StyleToken, onNudge: Nudge) {
  const [value, setValue] = useState(token.value);

  useEffect(() => setValue(token.value), [token.value]);

  /* On release, not per frame: one version, not two hundred. */
  const settle = (): void => {
    if (value !== token.value) onNudge(token.name, value);
  };

  return { value, setValue, settle };
}

/**
 * The palette as squares.
 *
 * Twenty colours in the space four rows used to take, because a colour is the
 * one thing a name cannot tell you. The line underneath is the label: it says
 * whatever the hand is over, so nothing has to be written beside each square.
 */
function Palette({
  tokens,
  onNudge,
  busy,
}: {
  tokens: readonly StyleToken[];
  onNudge: Nudge;
  busy: boolean;
}) {
  const [peek, setPeek] = useState<{ name: string; value: string } | null>(null);

  return (
    <div className="styles__palette">
      <div className="styles__wells">
        {tokens.map((token) => (
          <Chip
            key={token.name}
            token={token}
            onNudge={onNudge}
            onPeek={(name, value) => setPeek({ name, value })}
            busy={busy}
          />
        ))}
      </div>
      <p className="styles__read">
        {peek === null ? (
          SAYS.pickHint
        ) : (
          <>
            <span className="styles__name">{readable(peek.name)}</span>
            <span className="styles__value">{peek.value}</span>
          </>
        )}
      </p>
    </div>
  );
}

/** One colour. The well is painted with the value as written, so a blend or a
 *  soft grey looks like itself rather than like whatever a picker can hold. */
function Chip({
  token,
  onNudge,
  onPeek,
  busy,
}: {
  token: StyleToken;
  onNudge: Nudge;
  onPeek: (name: string, value: string) => void;
  busy: boolean;
}) {
  const { value, setValue, settle } = useKnob(token, onNudge);
  const name = readable(token.name);

  return (
    <span
      className="styles__well"
      style={{ background: value }}
      title={`${name} — ${value}`}
      onPointerEnter={() => onPeek(token.name, value)}
    >
      <input
        type="color"
        className="styles__pick"
        aria-label={name}
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
        disabled={busy}
        onFocus={() => onPeek(token.name, value)}
        onChange={(event) => {
          setValue(event.target.value);
          onPeek(token.name, event.target.value);
        }}
        onBlur={settle}
      />
    </span>
  );
}

/** One step of a scale. Name, slider and value on a single line, so a dozen of
 *  them read as the scale they are. */
function Step({ token, onNudge, busy }: { token: StyleToken; onNudge: Nudge; busy: boolean }) {
  const { value, setValue, settle } = useKnob(token, onNudge);

  return (
    <label className="styles__row">
      <span className="styles__name">{readable(token.name)}</span>
      <Slider token={token} value={value} setValue={setValue} settle={settle} busy={busy} />
      <span className="styles__value">{value}</span>
    </label>
  );
}

/** A size shown at its size. A number tells you nothing about type; the letters
 *  do, and they move as the slider does. */
function TypeStep({ token, onNudge, busy }: { token: StyleToken; onNudge: Nudge; busy: boolean }) {
  const { value, setValue, settle } = useKnob(token, onNudge);
  const size = specimenSize(value);

  return (
    <label className="styles__type">
      <span
        className="styles__specimen"
        style={size === null ? undefined : { fontSize: `${String(size)}px` }}
        aria-hidden="true"
      >
        {SAYS.specimen}
      </span>
      <span className="styles__typebody">
        <span className="styles__typehead">
          <span className="styles__name">{readable(token.name)}</span>
          <span className="styles__value">{value}</span>
        </span>
        <Slider token={token} value={value} setValue={setValue} settle={settle} busy={busy} />
      </span>
    </label>
  );
}

function Slider({
  token,
  value,
  setValue,
  settle,
  busy,
}: {
  token: StyleToken;
  value: string;
  setValue: (value: string) => void;
  settle: () => void;
  busy: boolean;
}) {
  return (
    <input
      type="range"
      className="styles__slider"
      min={0}
      max={Math.max(0, token.steps.length - 1)}
      step={1}
      value={Math.max(0, token.steps.indexOf(value))}
      disabled={busy}
      onChange={(event) => setValue(token.steps[Number(event.target.value)] ?? value)}
      onPointerUp={settle}
      onKeyUp={settle}
    />
  );
}

/** Shadows can only be looked at, so they are drawn rather than listed. */
function Shadows({ tokens }: { tokens: readonly StyleToken[] }) {
  return (
    <ul className="styles__lifts">
      {tokens.map((token) => (
        <li
          key={token.name}
          className="styles__lift"
          title={`${readable(token.name)} — ${token.value}`}
        >
          <span className="styles__card" style={{ boxShadow: token.value }} />
          <span className="styles__name">{readable(token.name)}</span>
        </li>
      ))}
    </ul>
  );
}
