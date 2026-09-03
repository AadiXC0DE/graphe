import { useEffect, useMemo, useState } from 'react';
import { usePrefersReducedMotion } from '../lib/motion';
import {
  groupMoves,
  judgeMotion,
  readEasing,
  saidEasing,
  sayTime,
  sayWhat,
  type Change,
  type Easing,
  type Motion as Movement,
  type Move,
  type MoveGroup,
  type Note,
} from '../motion/read';
import './Motion.css';

type Props = {
  motion: Movement;
  /** Where it lives, said once so nobody has to wonder what is being changed. */
  file: string;
  /** Called when an edit settles — on commit, not on every keystroke. */
  onNudge: (move: Move, change: Change) => void;
  busy?: boolean;
};

/** Past this many in one table, finding one by eye stops working. */
const FIND_APPEARS_AT = 12;

export const SAYS = {
  heading: 'Motion',
  none: 'Nothing in this project moves yet.',
  find: 'Find a movement',
  nothingFound: 'Nothing here matches that.',
  where: (name: string): string => `From ${name}`,
  element: 'Element',
  duration: 'Duration',
  easing: 'Easing',
  still: 'You have asked for less movement, so nothing here plays by itself.',
  places: (count: number): string => (count === 1 ? 'in one place' : `in ${String(count)} places`),
} as const;

/**
 * The movement a project already has, as a table.
 *
 * The same shape as the styles: every movement on one line, with its length and
 * its curve where they can be read against each other and changed in place. A
 * project's timing is a system, and a system is read in a column.
 */
export default function Motion({ motion, file, onNudge, busy }: Props) {
  const all = useMemo(() => groupMoves(motion.moves), [motion.moves]);
  const notes = useMemo(() => judgeMotion(motion), [motion]);
  const [term, setTerm] = useState('');
  const still = usePrefersReducedMotion();

  const findable = motion.moves.length > FIND_APPEARS_AT;
  const wanted = term.trim().toLowerCase();
  const groups = useMemo(() => {
    if (wanted === '') return all;
    return all
      .map((group) => ({
        ...group,
        moves: group.moves.filter((move) =>
          `${sayWhat(move)} ${move.places.map((place) => place.selector).join(' ')}`
            .toLowerCase()
            .includes(wanted),
        ),
      }))
      .filter((group) => group.moves.length > 0);
  }, [all, wanted]);

  const perMove = useMemo(() => {
    const found = new Map<string, Note[]>();
    for (const note of notes) {
      if (note.move === null) continue;
      const running = found.get(note.move.id);
      if (running) running.push(note);
      else found.set(note.move.id, [note]);
    }
    return found;
  }, [notes]);

  if (all.length === 0) return <p className="motion__none">{SAYS.none}</p>;

  const overall = notes.filter((note) => note.move === null);

  return (
    <div className="motion">
      {still ? <p className="motion__still">{SAYS.still}</p> : null}

      {overall.map((note) => (
        <p className="motion__note motion__note--all" key={note.id}>
          {note.says}
        </p>
      ))}

      {findable ? (
        <input
          className="motion__find"
          type="search"
          value={term}
          placeholder={SAYS.find}
          aria-label={SAYS.find}
          onChange={(event) => setTerm(event.target.value)}
        />
      ) : null}

      {groups.length === 0 ? <p className="motion__none">{SAYS.nothingFound}</p> : null}

      {groups.map((group) => (
        <Shelf
          key={group.id}
          group={group}
          notes={perMove}
          onNudge={onNudge}
          busy={busy === true}
        />
      ))}

      <p className="motion__from">{SAYS.where(file)}</p>
    </div>
  );
}

function Shelf({
  group,
  notes,
  onNudge,
  busy,
}: {
  group: MoveGroup;
  notes: ReadonlyMap<string, readonly Note[]>;
  onNudge: (move: Move, change: Change) => void;
  busy: boolean;
}) {
  return (
    <table className="motion__table">
      <caption className="motion__caption">
        {group.title}
        <span className="motion__count">{group.moves.length}</span>
      </caption>
      <thead>
        <tr>
          <th scope="col">{SAYS.element}</th>
          <th scope="col">{SAYS.duration}</th>
          <th scope="col">{SAYS.easing}</th>
        </tr>
      </thead>
      <tbody>
        {group.moves.map((move) => (
          <One
            key={move.id}
            move={move}
            notes={notes.get(move.id) ?? []}
            onNudge={onNudge}
            busy={busy}
          />
        ))}
      </tbody>
    </table>
  );
}

function One({
  move,
  notes,
  onNudge,
  busy,
}: {
  move: Move;
  notes: readonly Note[];
  onNudge: (move: Move, change: Change) => void;
  busy: boolean;
}) {
  const [time, setTime] = useState(() => sayTime(move.duration));
  const [curve, setCurve] = useState(() => saidEasing(move.easing));

  /* Local while it is being typed; theirs the moment anybody else changes it. */
  useEffect(() => setTime(sayTime(move.duration)), [move.duration]);
  useEffect(() => setCurve(saidEasing(move.easing)), [move.easing]);

  const settleTime = (): void => {
    const read = readTime(time);
    if (read === null || read === move.duration) {
      setTime(sayTime(move.duration));
      return;
    }
    onNudge(move, { duration: read });
  };

  const settleCurve = (): void => {
    const read: Easing | null = readEasing(curve);
    if (read === null || saidEasing(read) === saidEasing(move.easing)) {
      setCurve(saidEasing(move.easing));
      return;
    }
    onNudge(move, { easing: read });
  };

  const where = move.places.map((place) => place.selector).join(', ');

  return (
    <tr className="motion__row">
      <th scope="row" className="motion__what">
        <span className="motion__name">{sayWhat(move)}</span>
        <span className="motion__place" title={where}>
          {SAYS.places(move.places.length)}
        </span>
        {notes.map((note) => (
          <span className="motion__note" key={note.id}>
            {note.says}
          </span>
        ))}
      </th>
      <td>
        <input
          className="motion__value"
          aria-label={`${SAYS.duration}: ${sayWhat(move)}`}
          value={time}
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setTime(event.target.value)}
          onBlur={settleTime}
          onKeyDown={(event) => {
            if (event.key === 'Enter') settleTime();
            if (event.key === 'Escape') setTime(sayTime(move.duration));
          }}
        />
      </td>
      <td>
        <input
          className="motion__value motion__value--curve"
          aria-label={`${SAYS.easing}: ${sayWhat(move)}`}
          value={curve}
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setCurve(event.target.value)}
          onBlur={settleCurve}
          onKeyDown={(event) => {
            if (event.key === 'Enter') settleCurve();
            if (event.key === 'Escape') setCurve(saidEasing(move.easing));
          }}
        />
      </td>
    </tr>
  );
}

/** `200ms`, `0.2s` or a bare number. Null for anything that is not a length. */
export function readTime(said: string): number | null {
  const found = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(ms|s)?\s*$/i.exec(said);
  const amount = found?.[1];
  if (amount === undefined) return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;
  return found?.[2]?.toLowerCase() === 's' ? Math.round(value * 1000) : Math.round(value);
}
