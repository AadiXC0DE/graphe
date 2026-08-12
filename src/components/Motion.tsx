import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../lib/motion';
import {
  FEELS,
  curvePath,
  easingForFeel,
  feelOf,
  groupMoves,
  judgeMotion,
  previewKind,
  readEasing,
  saidEasing,
  sayEasing,
  sayTime,
  sayWhat,
  timeSteps,
  type Change,
  type Easing,
  type Feel,
  type Motion as Movement,
  type MotionKind,
  type Move,
  type Note,
  type Sequence,
} from '../motion/read';
import './Motion.css';

type Props = {
  motion: Movement;
  /** Where it lives, said once so nobody has to wonder what is being changed. */
  file: string;
  /** Called when a nudge settles — on release, not on every frame. */
  onNudge: (move: Move, change: Change) => void;
  busy?: boolean;
};

export const SAYS = {
  heading: 'How it moves',
  none: 'Nothing in this project moves yet.',
  where: (name: string): string => `From ${name}`,
  play: 'Watch it',
  howLong: 'How long',
  howItGoes: 'How it starts and stops',
  exact: 'The shape, in numbers',
  still:
    'You have asked for less movement, so nothing here plays by itself. The shape and the lengths are still yours to change.',
  places: (count: number): string =>
    count === 1 ? 'in one place' : `in ${String(count)} places`,
  after: (time: string): string => `after ${time}`,
  again: 'over and over',
} as const;

/** The shelf nobody came here for starts shut. */
const SHUT_AT_FIRST: readonly MotionKind[] = ['other'];

/** How long the demonstration rests at the far end before it comes back, so the
 *  arrival can be watched rather than glimpsed. */
const REST = 320;

/**
 * The movement a project already has, where it can be watched.
 *
 * Movement is the one part of an interface nobody can review by reading it. So
 * each one performs itself on demand, the curve is drawn rather than named, and
 * both the length and the shape move under the hand without asking anybody.
 */
export default function Motion({ motion, file, onNudge, busy }: Props) {
  const groups = useMemo(() => groupMoves(motion.moves), [motion.moves]);
  const notes = useMemo(() => judgeMotion(motion), [motion]);
  const [shut, setShut] = useState<ReadonlySet<MotionKind>>(() => new Set(SHUT_AT_FIRST));
  const still = usePrefersReducedMotion();
  const base = useId();

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

  if (groups.length === 0) return <p className="motion__none">{SAYS.none}</p>;

  const overall = notes.filter((note) => note.move === null);

  const toggle = (id: MotionKind): void =>
    setShut((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="motion">
      {still ? <p className="motion__still">{SAYS.still}</p> : null}

      {overall.map((note) => (
        <p className="motion__note motion__note--all" key={note.id}>
          {note.says}
        </p>
      ))}

      {groups.map((group) => {
        const open = !shut.has(group.id);
        const panel = `${base}-${group.id}`;
        return (
          <section className="motion__group" key={group.id}>
            <button
              type="button"
              className={`motion__band${open ? ' motion__band--open' : ''}`}
              aria-expanded={open}
              aria-controls={panel}
              onClick={() => toggle(group.id)}
            >
              <span className="motion__caret" aria-hidden="true" />
              <span className="motion__shelf">{group.title}</span>
              <span className="motion__count">{group.moves.length}</span>
            </button>

            <ul className="motion__body" id={panel} hidden={!open}>
              {group.moves.map((move) => (
                <One
                  key={move.id}
                  move={move}
                  sequences={motion.sequences}
                  notes={perMove.get(move.id) ?? []}
                  onNudge={onNudge}
                  busy={busy === true}
                  still={still}
                />
              ))}
            </ul>
          </section>
        );
      })}

      <p className="motion__from">{SAYS.where(file)}</p>
    </div>
  );
}

function One({
  move,
  sequences,
  notes,
  onNudge,
  busy,
  still,
}: {
  move: Move;
  sequences: readonly Sequence[];
  notes: readonly Note[];
  onNudge: (move: Move, change: Change) => void;
  busy: boolean;
  still: boolean;
}) {
  const [duration, setDuration] = useState(move.duration);
  const [easing, setEasing] = useState<Easing>(move.easing);
  const [typed, setTyped] = useState(() => saidEasing(move.easing));
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Local while the hand is moving; theirs the moment anybody else changes it. */
  useEffect(() => setDuration(move.duration), [move.duration]);
  useEffect(() => {
    setEasing(move.easing);
    setTyped(saidEasing(move.easing));
  }, [move.easing]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const steps = useMemo(() => timeSteps(move.duration), [move.duration]);
  const shows = previewKind(move, sequences);
  const where = move.places.map((place) => place.selector).join(', ');

  const play = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    setPlaying(true);
    const howLong = still ? 0 : duration + move.delay;
    timer.current = setTimeout(() => setPlaying(false), howLong + REST);
  };

  const settleTime = (): void => {
    if (duration !== move.duration) onNudge(move, { duration });
  };

  const take = (next: Easing): void => {
    setEasing(next);
    setTyped(saidEasing(next));
    if (saidEasing(next) !== saidEasing(move.easing)) onNudge(move, { easing: next });
  };

  const readTyped = (): void => {
    const next = readEasing(typed);
    if (next === null) setTyped(saidEasing(easing));
    else take(next);
  };

  return (
    <li className="motion__one">
      <div className="motion__head">
        <span className="motion__what">{sayWhat(move)}</span>
        <span className="motion__place" title={where}>
          {SAYS.places(move.places.length)}
        </span>
        <span className="motion__value">{sayTime(duration)}</span>
      </div>

      <div className="motion__show">
        <button
          type="button"
          className="motion__stage"
          onClick={play}
          disabled={busy}
          aria-label={`${SAYS.play}: ${sayWhat(move)}`}
        >
          <span
            className="motion__thing"
            data-shows={shows}
            data-playing={playing ? 'yes' : 'no'}
            style={{
              transitionDuration: `${String(still ? 0 : duration)}ms`,
              transitionDelay: `${String(still ? 0 : move.delay)}ms`,
              transitionTimingFunction: saidEasing(easing),
            }}
          />
          <span className="motion__cue">{SAYS.play}</span>
        </button>

        <svg
          className="motion__graph"
          viewBox="-12 -26 124 152"
          role="img"
          aria-label={sayEasing(easing)}
        >
          <path className="motion__even" d="M 0 100 L 100 0" vectorEffect="non-scaling-stroke" />
          <path
            className="motion__curve"
            d={curvePath(easing, 100, 100, 28)}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <label className="motion__row">
        <span className="motion__label">{SAYS.howLong}</span>
        <input
          type="range"
          className="motion__slider"
          min={0}
          max={Math.max(0, steps.length - 1)}
          step={1}
          value={Math.max(0, steps.indexOf(duration))}
          disabled={busy}
          onChange={(event) => setDuration(steps[Number(event.target.value)] ?? duration)}
          onPointerUp={settleTime}
          onKeyUp={settleTime}
        />
      </label>

      <label className="motion__row">
        <span className="motion__label">{SAYS.howItGoes}</span>
        <select
          className="motion__feel"
          value={feelOf(easing)}
          disabled={busy}
          onChange={(event) => take(easingForFeel(event.target.value as Feel))}
        >
          {FEELS.map((feel) => (
            <option key={feel.id} value={feel.id}>
              {feel.name}
            </option>
          ))}
        </select>
      </label>

      <p className="motion__says">{sayEasing(easing)}</p>

      <input
        className="motion__exact"
        aria-label={SAYS.exact}
        value={typed}
        spellCheck={false}
        disabled={busy}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={readTyped}
        onKeyDown={(event) => {
          if (event.key === 'Enter') readTyped();
        }}
      />

      {move.delay > 0 || !Number.isFinite(move.repeats) ? (
        <p className="motion__meta">
          {move.delay > 0 ? <span>{SAYS.after(sayTime(move.delay))}</span> : null}
          {Number.isFinite(move.repeats) ? null : <span>{SAYS.again}</span>}
        </p>
      ) : null}

      {notes.map((note) => (
        <p className="motion__note" key={note.id}>
          {note.says}
        </p>
      ))}
    </li>
  );
}
