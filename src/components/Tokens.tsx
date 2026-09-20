import { useId, useMemo, useState } from 'react';
import { groupTokens, type StyleGroup } from '../design/grouping';
import type { StyleToken } from '../lib/ipc';
import './Tokens.css';

type Props = {
  /** Every value the project declares, as the shell read them off its sheets. */
  tokens: readonly StyleToken[];
  /** How many stylesheets they were read from, said once so nobody has to
   *  wonder how wide the reading was. */
  sheets: number;
  /** Open one in the person's editor. */
  onOpenFile: (file: string) => void;
};

export const SAYS = {
  heading: 'Tokens',
  find: 'Find a value',
  nothingFound: 'Nothing here matches that.',
  name: 'Name',
  value: 'Value',
  used: 'Used',
  where: 'File',
  open: 'Open in editor',
  /** How wide the reading was, which is what makes an empty Used column mean
   *  something rather than look broken. */
  from: (count: number): string =>
    count === 1 ? 'From 1 stylesheet' : `From ${String(count)} stylesheets`,
  count: (drawn: number): string => (drawn === 1 ? '1 value' : `${String(drawn)} values`),
  /** Said under a shelf that had to stop, so a capped list never reads as the
   *  whole one. */
  hidden: (count: number): string => `${String(count)} more not shown`,
} as const;

/**
 * The project's own values, as a spec sheet.
 *
 * A table rather than a wall of cards: a design system is read down a column —
 * every name, every value, and how much of the project leans on it. Nothing
 * here changes anything. It is the reading the agent gets from `read_tokens`,
 * drawn for the person reading alongside it.
 */
export default function Tokens({ tokens, sheets, onOpenFile }: Props) {
  const groups = useMemo(() => groupTokens(tokens), [tokens]);
  const [term, setTerm] = useState('');
  const heading = useId();

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

  /* Absent, not empty: a project with no tokens has no design system to show,
     and a heading over a blank table says only that something is missing. */
  if (groups.length === 0) return null;

  const drawn = groups.reduce((sum, group) => sum + group.tokens.length + group.hidden, 0);

  return (
    <section className="tokens" aria-labelledby={heading}>
      <div className="tokens__head">
        <h2 className="tokens__title" id={heading}>
          {SAYS.heading}
        </h2>
        <span className="tokens__count">{SAYS.count(drawn)}</span>
      </div>
      <input
        className="tokens__find"
        type="search"
        value={term}
        placeholder={SAYS.find}
        aria-label={SAYS.find}
        onChange={(event) => setTerm(event.target.value)}
      />
      <p className="tokens__from">{SAYS.from(sheets)}</p>

      {shown.length === 0 ? <p className="tokens__none">{SAYS.nothingFound}</p> : null}

      {shown.map((group) => (
        <Shelf key={group.id} group={group} onOpenFile={onOpenFile} />
      ))}
    </section>
  );
}

function Shelf({
  group,
  onOpenFile,
}: {
  group: StyleGroup;
  onOpenFile: (file: string) => void;
}) {
  return (
    <table className="tokens__table">
      <caption className="tokens__caption">
        {group.title}
        <span className="tokens__shelfcount">{group.tokens.length + group.hidden}</span>
      </caption>
      <thead>
        <tr>
          <th scope="col">{SAYS.name}</th>
          <th scope="col">{SAYS.value}</th>
          <th scope="col" className="tokens__usedhead">
            {SAYS.used}
          </th>
          <th scope="col">
            <span className="tokens__offside">{SAYS.where}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {group.tokens.map((token) => (
          <tr key={token.name} className="tokens__row">
            <th scope="row" className="tokens__name">
              {token.name}
            </th>
            <td className="tokens__valuecell">
              {token.kind === 'colour' ? (
                /* Painted with the value exactly as written, so a blend or a
                   soft grey looks like itself rather than like a hex code. */
                <span className="tokens__well" style={{ background: token.value }} />
              ) : null}
              <span className="tokens__value">{token.value}</span>
            </td>
            <td className="tokens__used">{token.used === 0 ? '' : token.used}</td>
            <td className="tokens__placecell">
              <button
                type="button"
                className="tokens__place"
                onClick={() => onOpenFile(token.file)}
                title={SAYS.open}
                aria-label={`Open ${token.file} in your editor`}
              >
                {token.file}:{token.line}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
      {group.hidden > 0 ? (
        <tfoot>
          <tr>
            <td className="tokens__hidden" colSpan={4}>
              {SAYS.hidden(group.hidden)}
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
