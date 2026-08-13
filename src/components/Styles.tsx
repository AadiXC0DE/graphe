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
  /** Two letters with an ascender and a descender: the shape of a size. */
  specimen: 'Ag',
  /** Shown at the top of a discipline, so a visitor reads what they are.' */
  groups: {
    colour: 'The palette, each swatch named and its value beside it.',
    type: 'Text sizes, drawn at size. Drag a row to borrow a step.',
    spacing: 'The room between things, as bars measured at their own width.',
    corners: 'How much the edges soften, as squares of their own radius.',
    shadow: 'How high things sit, as cards casting their own shadow.',
    size: 'Sizes that are not text, stepped by number.',
    other: 'The rest, without a shape of their own.',
  } as const,
} as const;

/** Everything open the moment the panel appears: this is where somebody comes
 *  to read a whole system, not to hunt a band. */
const SHUT_AT_FIRST: readonly GroupId[] = [];

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
          <section className={`styles__group ${open ? 'styles__group--open' : ''}`} key={group.id}>
            <button
              type="button"
              className={`styles__band${open ? ' styles__band--open' : ''}`}
              aria-expanded={open}
              aria-controls={panel}
              onClick={() => toggle(group.id)}
            >
              <span className="styles__shelf">{group.title}</span>
              <span className="styles__count">{group.tokens.length + group.hidden}</span>
              <span className="styles__caret" aria-hidden="true" />
            </button>

            <div className="styles__body" id={panel} hidden={!open}>
              <p className="styles__intro">{SAYS.groups[group.id]}</p>
              <Shelf group={group} onNudge={onNudge} busy={busy === true} />
              {group.hidden > 0 ? (
                <p className="styles__rest">{SAYS.more(group.hidden)}</p>
              ) : null}
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
  if (group.id === 'spacing') return <SpacingScale tokens={group.tokens} onNudge={onNudge} busy={busy} />;
  if (group.id === 'corners') return <CornerScale tokens={group.tokens} onNudge={onNudge} busy={busy} />;

  /* The type shelf is a mix: real sizes get a specimen at size, and a font
     stack — not editable, but still the answer to “what type is this?” — is
     drawn as the family it names. */
  const type = group.id === 'type';

  if (type) {
    return (
      <div className="styles__scale styles__scale--type">
        {group.tokens.map((token) =>
          controlFor(token) === 'steps' ? (
            <TypeStep key={token.name} token={token} onNudge={onNudge} busy={busy} />
          ) : (
            <Family key={token.name} token={token} />
          ),
        )}
      </div>
    );
  }

  return (
    <div className="styles__scale">
      {group.tokens
        .filter((token) => controlFor(token) === 'steps')
        .map((token) => (
          <Step key={token.name} token={token} onNudge={onNudge} busy={busy} />
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
 * The palette as swatches.
 *
 * Each swatch carries its name and value beneath it, so the whole palette
 * reads as a family you can scan rather than a wall of colour you have to hunt
 * through. Changing a swatch needs one press of the colour well inside it.
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
  return (
    <ul className="styles__palette">
      {tokens.map((token) => (
        <Chip key={token.name} token={token} onNudge={onNudge} busy={busy} />
      ))}
    </ul>
  );
}

/** One colour. The well is painted with the value as written, and the value it
 *  writes back is shown beside the name. A blend or a soft grey looks like
 *  itself rather than like whatever a picker can hold. */
function Chip({
  token,
  onNudge,
  busy,
}: {
  token: StyleToken;
  onNudge: Nudge;
  busy: boolean;
}) {
  const { value, setValue, settle } = useKnob(token, onNudge);
  const name = readable(token.name);

  return (
    <li className="styles__swatch">
      <span className="styles__well" style={{ background: value }}>
        <input
          type="color"
          className="styles__pick"
          aria-label={name}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          disabled={busy}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onBlur={settle}
        />
      </span>
      <span className="styles__swname" title={`${name} — ${value}`}>
        {name}
      </span>
    </li>
  );
}

/** A spacing token drawn as a bar at its own width, so a 4px step is visibly
 *  a hair and a 48px step is visibly a room. The label + slider sit under it. */
function SpacingScale({
  tokens,
  onNudge,
  busy,
}: {
  tokens: readonly StyleToken[];
  onNudge: Nudge;
  busy: boolean;
}) {
  return (
    <div className="styles__measures">
      {tokens.map((token) => (
        <SpacingStep key={token.name} token={token} onNudge={onNudge} busy={busy} />
      ))}
    </div>
  );
}

function SpacingStep({
  token,
  onNudge,
  busy,
}: {
  token: StyleToken;
  onNudge: Nudge;
  busy: boolean;
}) {
  const { value, setValue, settle } = useKnob(token, onNudge);
  return (
    <label className="styles__measure">
      <span className="styles__measuretrack" aria-hidden="true">
        <span className="styles__measurebar" style={{ width: `min(${value}, 100%)` }} />
      </span>
      <span className="styles__measuremeta">
        <span className="styles__name">{readable(token.name)}</span>
        <span className="styles__value">{value}</span>
      </span>
      <Slider token={token} value={value} setValue={setValue} settle={settle} busy={busy} />
    </label>
  );
}

/** Corner radius drawn as a square that round is, so the curve itself is the
 *  picture — not a number pressed through a gradient of more or less. */
function CornerScale({
  tokens,
  onNudge,
  busy,
}: {
  tokens: readonly StyleToken[];
  onNudge: Nudge;
  busy: boolean;
}) {
  return (
    <div className="styles__corners">
      {tokens.map((token) => (
        <CornerStep key={token.name} token={token} onNudge={onNudge} busy={busy} />
      ))}
    </div>
  );
}

function CornerStep({
  token,
  onNudge,
  busy,
}: {
  token: StyleToken;
  onNudge: Nudge;
  busy: boolean;
}) {
  const { value, setValue, settle } = useKnob(token, onNudge);
  return (
    <label className="styles__corner">
      <span className="styles__cornerbox" style={{ borderRadius: value }} aria-hidden="true" />
      <span className="styles__cornerhead">
        <span className="styles__name">{readable(token.name)}</span>
        <span className="styles__value">{value}</span>
      </span>
      <Slider token={token} value={value} setValue={setValue} settle={settle} busy={busy} />
    </label>
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

/** A font family: not editable, but the very thing the type shelf exists to
 *  name. Drawn as the specimen in that face, with the stack written under it. */
function Family({ token }: { token: StyleToken }) {
  return (
    <div className="styles__family">
      <span className="styles__familysample" style={{ fontFamily: token.value }} aria-hidden="true">
        {SAYS.specimen} Family
      </span>
      <span className="styles__typehead">
        <span className="styles__name">{readable(token.name)}</span>
        <span className="styles__value styles__familyvalue" title={token.value}>
          {token.value}
        </span>
      </span>
    </div>
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
