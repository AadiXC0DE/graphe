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
  /** Now, epoch ms. Passed in so the band draws the same twice. */
  now: number;
  busy: boolean;
  /** Get on with something whether or not the window stays open. */
  onKeepGoing: (text: string) => void;
  /** Take one's result into the project. */
  onKeep: (id: string) => void;
  /** Stop one, or let its result go. */
  onDrop: (id: string) => void;
  /** Answer the question one of them stopped on. The only thing that can. */
  onAnswer: (id: string, callId: string, decision: Decision) => void;
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
  now,
  busy,
  onKeepGoing,
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
  const [asking, setAsking] = useState(false);
  const [repeatDoing, setRepeatDoing] = useState('');
  const [every, setEvery] = useState<EveryKind>('day');
  const [at, setAt] = useState('07:00');
  const [onDay, setOnDay] = useState(1);

  const pieces = away?.pieces ?? [];
  const repeats = away?.repeats ?? [];
  const asked = pieces.filter((one) => one.question !== null);

  const send = () => {
    const text = doing.trim();
    if (text === '') return;
    setDoing('');
    setStarting(false);
    onKeepGoing(text);
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
          {awayWords.keepGoing}
        </button>
      </div>

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
          <button
            type="button"
            className="away__do away__do--first"
            onClick={send}
            disabled={busy || doing.trim() === ''}
          >
            {awayWords.start}
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
          <div key={piece.id} className="away__asked" role="group" aria-label={piece.question.question}>
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
                  if (piece.question !== null) onAnswer(piece.id, piece.question.callId, 'yes');
                }}
              >
                {awayWords.yes}
              </button>
              <button
                type="button"
                className="away__quietdo"
                disabled={busy}
                onClick={() => {
                  if (piece.question !== null) onAnswer(piece.id, piece.question.callId, 'no');
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
