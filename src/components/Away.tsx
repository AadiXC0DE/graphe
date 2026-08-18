import { afterWords } from '../work/after';
import { useState } from 'react';
import Board from './Board';
import type { Away as AwayState, Decision, EveryKind } from '../lib/ipc';
import { awayWords } from '../work/unattended';
import { standingWords } from '../work/standing';
import { formatMoney } from '../cost/money';
import './Away.css';

/**
 * What happened while nobody was looking.
 *
 * The competition runs this in a data centre and reports back in code changes,
 * which is the one artefact this app's audience cannot read. This runs on the
 * machine the folder is already on, and reports back the way everything else
 * here does: a picture of what it made, a sentence about it, and what it cost.
 *
 * Three things live in one band because they are one thing — work carrying on,
 * something that stopped and needs a person, and the things asked for over and
 * over that produce both. The question comes first and is never a badge on a
 * card: it is the only thing on this panel that cannot happen without somebody.
 *
 * Presentational: everything arrives as props, `now` included.
 */

export type AwayProps = {
  /** Null until the shell has answered, so nothing flashes on the way in. */
  away: AwayState | null;
  /** The other folders that have work of their own. Empty is the ordinary
   *  case, and the board stays a board of one when it is. */
  elsewhere?: readonly { where: string; project: string; away: AwayState }[];
  /** What this folder is called. Only used once the board is showing more than
   *  one, where an unlabelled card would mean "this one" by inference. */
  project?: string;
  /** Now, epoch ms. Passed in so the band draws the same twice. */
  now: number;
  busy: boolean;
  /** Get on with something whether or not the window stays open.
   *  `untilDone` is overnight mode: full access, no questions, wall clock. */
  onKeepGoing: (text: string, untilDone?: boolean) => void;
  /** Ask for work that waits until another piece has finished. Left off, the
   *  offer is not made — there is nothing to wait for on an empty board. */
  onStartAfter?: (text: string, after: string) => void;
  /** Take one's result into the project. The folder comes with it: this board
   *  can be showing work from several. */
  onKeep: (id: string, where?: string) => void;
  /** Stop one, or let its result go. */
  onDrop: (id: string, where?: string) => void;
  /** Answer the question one of them stopped on. The only thing that can. */
  onAnswer: (id: string, callId: string, decision: Decision, where?: string) => void;
  onAddRepeat: (
    doing: string,
    every: EveryKind,
    at: { hour: number; minute: number },
    on?: number,
  ) => void;
  onSwitchRepeat: (id: string, on: boolean) => void;
  onForgetRepeat: (id: string) => void;
};

const RHYTHMS: readonly { id: EveryKind; name: string }[] = [
  { id: 'day', name: 'Every day' },
  { id: 'weekday', name: 'Every weekday' },
  { id: 'week', name: 'Once a week' },
  { id: 'month', name: 'Once a month' },
];

const DAYS: readonly { id: number; name: string }[] = [
  { id: 1, name: 'Monday' },
  { id: 2, name: 'Tuesday' },
  { id: 3, name: 'Wednesday' },
  { id: 4, name: 'Thursday' },
  { id: 5, name: 'Friday' },
  { id: 6, name: 'Saturday' },
  { id: 0, name: 'Sunday' },
];

/** "07:00" as the two numbers the shell wants. Anything unreadable is nine in
 *  the morning, which is when somebody sitting down would have meant. */
function readTime(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':');
  const hours = Number(hour);
  const minutes = Number(minute);
  return {
    hour: Number.isFinite(hours) ? hours : 9,
    minute: Number.isFinite(minutes) ? minutes : 0,
  };
}

export default function Away({
  away,
  elsewhere,
  project,
  now,
  busy,
  onKeepGoing,
  onStartAfter,
  onKeep,
  onDrop,
  onAnswer,
  onAddRepeat,
  onSwitchRepeat,
  onForgetRepeat,
}: AwayProps) {
  const [doing, setDoing] = useState('');
  /* Both forms are folded until somebody wants one. The band is about what is
     running; a pair of empty boxes above that is a pair of empty boxes. */
  const [starting, setStarting] = useState(false);
  /** Overnight: full access, no questions, keep going until the goal lands. */
  const [untilDone, setUntilDone] = useState(false);
  /** One board or all of them. Off by default: most of the time there is only
   *  one folder with anything in it, and the answer would be the same. */
  const [across, setAcross] = useState(false);
  /** Which piece this one should wait for, or empty for none. */
  const [waitFor, setWaitFor] = useState('');
  const [asking, setAsking] = useState(false);
  const [repeatDoing, setRepeatDoing] = useState('');
  const [every, setEvery] = useState<EveryKind>('day');
  const [at, setAt] = useState('07:00');
  const [onDay, setOnDay] = useState(1);

  const others = elsewhere ?? [];
  const mine = away?.pieces ?? [];
  /* Every folder's work as one list, each piece carrying the folder it belongs
     to so a press lands where it was meant to. */
  // Labelled only once there is something to tell it apart from. On a board of
  // one folder the same word on every card is noise.
  const here = mine.map((one) => ({
    ...one,
    where: undefined as string | undefined,
    project: (across ? project : undefined) as string | undefined,
  }));
  const all = [
    ...here,
    ...others.flatMap((one) =>
      one.away.pieces.map((piece) => ({
        ...piece,
        where: one.where as string | undefined,
        project: one.project as string | undefined,
      })),
    ),
  ];
  const showing = across ? all : here;
  const pieces = showing;
  const repeats = away?.repeats ?? [];
  const asked = showing.filter((one) => one.question !== null);
  /* Only work that has not finished can be waited for — waiting for something
     already done would start straight away, which is not what was asked.
     And only this folder's, whatever the board is showing: new work starts
     where you are, and nothing here can wait for another folder's piece. */
  const canWaitFor = here.filter(
    (one) => one.state === 'running' || one.state === 'waiting' || one.state === 'needs-you',
  );

  const send = () => {
    const text = doing.trim();
    if (text === '') return;
    const goal = untilDone;
    setDoing('');
    setStarting(false);
    setUntilDone(false);
    // Overnight mode cannot wait on something else — it is the thing that runs.
    if (waitFor === '' || goal) onKeepGoing(text, goal);
    else onStartAfter?.(text, waitFor);
    setWaitFor('');
  };

  const askForIt = () => {
    const text = repeatDoing.trim();
    if (text === '') return;
    setRepeatDoing('');
    setAsking(false);
    onAddRepeat(text, every, readTime(at), every === 'week' ? onDay : 1);
  };

  return (
    <section className="away" aria-label="Background work">
      <div className="away__top">
        <h2 className="away__title">Background work</h2>
        <button
          type="button"
          className="away__new"
          aria-expanded={starting}
          onClick={() => setStarting((was) => !was)}
        >
          <Plus />
          {awayWords.keepGoing}
        </button>
      </div>

      {/* Offered only when another folder actually has work in it. A switch
          with nothing on the other side of it is noise on every other day. */}
      {others.length === 0 ? null : (
        <div className="away__scope" role="group" aria-label="Which projects to show">
          {[false, true].map((wide) => (
            <button
              key={String(wide)}
              type="button"
              className={`away__scopeone ${across === wide ? 'away__scopeone--on' : ''}`}
              aria-pressed={across === wide}
              onClick={() => setAcross(wide)}
            >
              {wide ? awayWords.everywhere : awayWords.here}
            </button>
          ))}
        </div>
      )}

      {across ? (
        <p className="away__across">
          {awayWords.acrossSays(others.length + 1, all.filter((one) => one.state === 'running').length)}
        </p>
      ) : null}

      {/* Where the hand already is: one box, and it carries on without you. */}
      {starting ? (
        <div className="away__ask">
          <textarea
            id="away-doing"
            className="away__box"
            rows={2}
            autoFocus
            value={doing}
            placeholder={standingWords.example}
            aria-label={awayWords.keepGoing}
            disabled={busy}
            onChange={(event) => setDoing(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                send();
              }
            }}
          />
          <p className="away__hint">{awayWords.keepGoingHint}</p>

          <label className="away__goal">
            <input
              type="checkbox"
              checked={untilDone}
              disabled={busy}
              onChange={(event) => setUntilDone(event.target.checked)}
            />
            <span>
              <span className="away__goalname">{awayWords.untilDone}</span>
              <span className="away__hint">{awayWords.untilDoneHint}</span>
            </span>
          </label>

          {/* Order, said in the words somebody would use. Offered only when
              there is something to wait for, which is what makes it an offer
              rather than a setting. Overnight work never waits. */}
          {untilDone || onStartAfter === undefined || canWaitFor.length === 0 ? null : (
            <div className="away__after">
              <label className="away__afterlabel" htmlFor="away-after">
                {afterWords.pick}
              </label>
              <select
                id="away-after"
                className="away__pick"
                value={waitFor}
                disabled={busy}
                onChange={(event) => setWaitFor(event.target.value)}
              >
                <option value="">{afterWords.noWait}</option>
                {canWaitFor.map((one) => (
                  <option key={one.id} value={one.id}>
                    {afterWords.waits(one.doing)}
                  </option>
                ))}
              </select>
              <p className="away__hint">{afterWords.what}</p>
            </div>
          )}

          <button
            type="button"
            className="away__do away__do--first"
            onClick={send}
            disabled={busy || doing.trim() === ''}
          >
            {untilDone ? awayWords.startUntilDone : waitFor === '' ? awayWords.start : afterWords.start}
          </button>
        </div>
      ) : null}

      {away?.sinceYouWere === null || away?.sinceYouWere === undefined ? null : (
        <p className="away__since" role="status">
          {away.sinceYouWere}
        </p>
      )}

      {/* Anything that stopped for a person, first and whole. Nothing else on
          this panel is something only they can do. */}
      {asked.map((piece) =>
        piece.question === null ? null : (
          <div
            key={`${piece.where ?? ''}\u0000${piece.id}`}
            className="away__asked"
            role="group"
            aria-label={piece.question.question}
          >
            {piece.project === undefined ? null : (
              <p className="away__wherefrom">{piece.project}</p>
            )}
            <p className="away__doing">{piece.doing}</p>
            <p className="away__question">{piece.question.question}</p>
            {piece.question.detail === null ? null : (
              <p className="away__detail">{piece.question.detail}</p>
            )}
            {piece.question.consequence === null ? null : (
              <p className="away__detail">{piece.question.consequence}</p>
            )}
            <p className="away__why">{awayWords.why}</p>
            <div className="away__row">
              <button
                type="button"
                className="away__do away__do--first"
                disabled={busy}
                onClick={() => {
                  if (piece.question !== null) onAnswer(piece.id, piece.question.callId, 'yes', piece.where);
                }}
              >
                {awayWords.yes}
              </button>
              <button
                type="button"
                className="away__quietdo"
                disabled={busy}
                onClick={() => {
                  if (piece.question !== null) onAnswer(piece.id, piece.question.callId, 'no', piece.where);
                }}
              >
                {awayWords.no}
              </button>
            </div>
          </div>
        ),
      )}

      {pieces.length === 0 ? (
        <p className="away__quiet">
          {awayWords.nothing} {awayWords.what}
        </p>
      ) : (
        <Board
          pieces={pieces}
          now={now}
          atOnce={away?.atOnce ?? 4}
          onKeep={onKeep}
          onDrop={onDrop}
        />
      )}

      {away?.spent === null || away?.spent === undefined ? null : (
        <p className="away__spent">{`${formatMoney(away.spent)} so far`}</p>
      )}

      {/* The same thing, on a rhythm. Behind the same control rather than in a
          settings screen somewhere else. */}
      <div className="away__over">
        <div className="away__top">
          <h3 className="away__subtitle">{standingWords.title}</h3>
          <button
            type="button"
            className="away__new"
            aria-expanded={asking}
            onClick={() => setAsking((was) => !was)}
          >
            <Plus />
            {standingWords.label}
          </button>
        </div>
        {repeats.length === 0 ? (
          <p className="away__quiet">{standingWords.none}</p>
        ) : (
          <ul className="away__repeats">
            {repeats.map((one) => (
              <li key={one.id} className={`away__repeat ${one.on ? '' : 'away__repeat--off'}`}>
                <p className="away__doing">{one.doing}</p>
                <p className="away__when">
                  {one.says}
                  <span className="away__next">{one.next}</span>
                </p>
                {one.lastSaid === null ? null : <p className="away__detail">{one.lastSaid}</p>}
                <div className="away__row">
                  <button
                    type="button"
                    className="away__quietdo"
                    disabled={busy}
                    onClick={() => onSwitchRepeat(one.id, !one.on)}
                  >
                    {one.on ? standingWords.stop : standingWords.start}
                  </button>
                  <button
                    type="button"
                    className="away__quietdo"
                    disabled={busy}
                    onClick={() => onForgetRepeat(one.id)}
                  >
                    {standingWords.remove}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {asking ? (
          <div className="away__form">
            <p className="away__hint">{standingWords.hint}</p>
            <textarea
              className="away__box"
              rows={2}
              value={repeatDoing}
              placeholder={standingWords.example}
              aria-label={standingWords.label}
              onChange={(event) => setRepeatDoing(event.target.value)}
            />
            <div className="away__row">
              <select
                className="away__pick"
                value={every}
                aria-label="How often"
                onChange={(event) => setEvery(event.target.value as EveryKind)}
              >
                {RHYTHMS.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
              </select>
              {every === 'week' ? (
                <select
                  className="away__pick"
                  value={String(onDay)}
                  aria-label="Which day"
                  onChange={(event) => setOnDay(Number(event.target.value))}
                >
                  {DAYS.map((one) => (
                    <option key={one.id} value={String(one.id)}>
                      {one.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                className="away__pick"
                type="time"
                value={at}
                aria-label="At what time"
                onChange={(event) => setAt(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="away__do away__do--first"
              onClick={askForIt}
              disabled={busy || repeatDoing.trim() === ''}
            >
              {standingWords.add}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The small + that says a pill adds something. Its own component so the two
 *  pills and the one in the repeat form stay the same shape. */
function Plus() {
  return (
    <svg className="away__plus" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
