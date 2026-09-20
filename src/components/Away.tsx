import Board from './Board';
import type { Away as AwayState, Decision } from '../lib/ipc';
import { awayWords } from '../work/unattended';
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
 * Two things live in one band because they are one thing: work carrying on,
 * and something that stopped and needs a person. The question comes first and
 * is never a badge on a card, because it is the only thing on this panel that
 * cannot happen without somebody. Work is started through the tool that runs
 * it, so the band reports and answers rather than launches.
 *
 * Presentational: everything arrives as props, `now` included.
 */

export type AwayProps = {
  /** Null until the shell has answered, so nothing flashes on the way in. */
  away: AwayState | null;
  /** Now, epoch ms. Passed in so the band draws the same twice. */
  now: number;
  busy: boolean;
  /** Take one's result into the project. */
  onKeep: (id: string, where?: string) => void;
  /** Stop one, or let its result go. */
  onDrop: (id: string, where?: string) => void;
  /** Answer the question one of them stopped on. The only thing that can. */
  onAnswer: (id: string, callId: string, decision: Decision, where?: string) => void;
  /** Say something to one that is still going, without stopping it. Answers
   *  whether it was taken, so nothing claims it was. */
  onSay?: (id: string, text: string, where?: string) => Promise<boolean>;
};

/**
 * What happened while nobody was looking, drawn from the shell's own account of
 * it. Presentational: everything arrives as props, `now` included.
 */
export default function Away({ away, now, busy, onKeep, onDrop, onAnswer, onSay }: AwayProps) {
  const pieces = away?.pieces ?? [];
  const asked = pieces.filter((one) => one.question !== null);

  return (
    <section className="away" aria-label="Background work">
      <div className="away__top">
        <h2 className="away__title">Background work</h2>
      </div>

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
            key={piece.id}
            className="away__asked"
            role="group"
            aria-label={piece.question.question}
          >
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
          onSay={onSay}
        />
      )}

      {away?.spent === null || away?.spent === undefined ? null : (
        <p className="away__spent">{`${formatMoney(away.spent)} so far`}</p>
      )}
    </section>
  );
}
