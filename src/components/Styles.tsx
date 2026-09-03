import { useEffect, useMemo, useState } from 'react';
import { groupTokens, type StyleGroup } from '../design/grouping';
import type { StyleToken } from '../lib/ipc';
import './Styles.css';

type Props = {
  tokens: readonly StyleToken[];
  /** Where they live, said once so nobody has to wonder what is being edited. */
  file: string;
  /** The stylesheet as written, for counting what each value is used by. */
  text?: string;
  /** Called when an edit settles — on commit, not on every keystroke. */
  onNudge: (name: string, value: string) => void;
  /** The ones moved but not yet saved, so each can be put back on its own. */
  nudged?: readonly string[];
  onReset?: (name: string) => void;
  busy?: boolean;
};

export const SAYS = {
  heading: 'Styles',
  none: 'This project has no styles I can offer you knobs for yet.',
  find: 'Find a style',
  nothingFound: 'Nothing here matches that.',
  where: (file: string): string => `From ${file}`,
  name: 'Name',
  value: 'Value',
  used: 'Used',
  reset: 'Put back',
  /** How many places in the stylesheet reach for this value. */
  uses: (count: number): string => (count === 1 ? '1 use' : `${String(count)} uses`),
} as const;

/** How many times each value is asked for by name in the stylesheet. A value
 *  nothing reaches for is a value nobody has to be careful with. */
export function usesIn(text: string): ReadonlyMap<string, number> {
  const found = new Map<string, number>();
  for (const match of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
    const name = match[1];
    if (name === undefined) continue;
    found.set(name, (found.get(name) ?? 0) + 1);
  }
  return found;
}

/**
 * The project's visual language as a spec sheet.
 *
 * A table rather than a wall of cards: a design system is read down a column —
 * every name, every value, and how much of the project leans on it — and a
 * value is changed where it is read rather than behind an edit mode.
 */
export default function Styles({ tokens, file, text, onNudge, nudged, onReset, busy }: Props) {
  const groups = useMemo(() => groupTokens(tokens), [tokens]);
  const uses = useMemo(() => usesIn(text ?? ''), [text]);
  const [term, setTerm] = useState('');

  const wanted = term.trim().toLowerCase();
  const shown = useMemo(
    () =>
      wanted === ''
        ? groups
        : groups
            .map((group) => ({
              ...group,
              tokens: group.tokens.filter((token) =>
                `${token.name} ${token.value}`.toLowerCase().includes(wanted),
              ),
            }))
            .filter((group) => group.tokens.length > 0),
    [groups, wanted],
  );

  if (groups.length === 0) return <p className="styles__none">{SAYS.none}</p>;

  const moved = new Set(nudged ?? []);

  return (
    <div className="styles">
      <div className="styles__head">
        <input
          className="styles__find"
          type="search"
          value={term}
          placeholder={SAYS.find}
          aria-label={SAYS.find}
          onChange={(event) => setTerm(event.target.value)}
        />
        <p className="styles__where">{SAYS.where(file)}</p>
      </div>

      {shown.length === 0 ? <p className="styles__none">{SAYS.nothingFound}</p> : null}

      {shown.map((group) => (
        <Shelf
          key={group.id}
          group={group}
          uses={uses}
          moved={moved}
          onNudge={onNudge}
          {...(onReset === undefined ? {} : { onReset })}
          busy={busy === true}
        />
      ))}
    </div>
  );
}

function Shelf({
  group,
  uses,
  moved,
  onNudge,
  onReset,
  busy,
}: {
  group: StyleGroup;
  uses: ReadonlyMap<string, number>;
  moved: ReadonlySet<string>;
  onNudge: (name: string, value: string) => void;
  onReset?: (name: string) => void;
  busy: boolean;
}) {
  return (
    <table className="styles__table">
      <caption className="styles__caption">
        {group.title}
        <span className="styles__count">{group.tokens.length + group.hidden}</span>
      </caption>
      <thead>
        <tr>
          <th scope="col">{SAYS.name}</th>
          <th scope="col">{SAYS.value}</th>
          <th scope="col" className="styles__usedhead">
            {SAYS.used}
          </th>
          <th scope="col">
            <span className="styles__hidden">{SAYS.reset}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {group.tokens.map((token) => (
          <Row
            key={token.name}
            token={token}
            colour={group.id === 'colour'}
            used={uses.get(token.name) ?? 0}
            moved={moved.has(token.name)}
            onNudge={onNudge}
            {...(onReset === undefined ? {} : { onReset })}
            busy={busy}
          />
        ))}
      </tbody>
    </table>
  );
}

function Row({
  token,
  colour,
  used,
  moved,
  onNudge,
  onReset,
  busy,
}: {
  token: StyleToken;
  colour: boolean;
  used: number;
  moved: boolean;
  onNudge: (name: string, value: string) => void;
  onReset?: (name: string) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState(token.value);

  /* Local while it is being typed; theirs the moment anybody else changes it. */
  useEffect(() => setValue(token.value), [token.value]);

  const settle = (next = value): void => {
    if (next !== token.value) onNudge(token.name, next);
  };

  return (
    <tr className={`styles__row${moved ? ' styles__row--moved' : ''}`}>
      <th scope="row" className="styles__name">
        {token.name}
      </th>
      <td className="styles__valuecell">
        {colour ? (
          <span className="styles__well" style={{ background: value }}>
            <input
              type="color"
              className="styles__pick"
              aria-label={token.name}
              value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
              onBlur={() => settle()}
            />
          </span>
        ) : null}
        <input
          className="styles__value"
          aria-label={token.name}
          value={value}
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => settle()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') settle();
            if (event.key === 'Escape') setValue(token.value);
          }}
        />
      </td>
      <td className="styles__used">{used === 0 ? '' : used}</td>
      <td className="styles__resetcell">
        {moved && onReset !== undefined ? (
          <button
            type="button"
            className="styles__reset"
            title={SAYS.reset}
            aria-label={`${SAYS.reset}: ${token.name}`}
            onClick={() => onReset(token.name)}
          >
            ↻
          </button>
        ) : null}
      </td>
    </tr>
  );
}
