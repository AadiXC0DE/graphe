import {
  boardWords,
  groupWork,
  saysBoard,
  saysDrop,
  saysFull,
  saysState,
  saysWhen,
  type OnBoard,
} from '../work/board';
import type { Money } from '../agent/types';
import { formatMoney } from '../cost/money';
import './Board.css';

/**
 * Several pieces of work at once, as a contact sheet.
 *
 * The competition draws this as a list of names with a spinner beside each one,
 * which asks somebody to keep track of processes. We already draw a change as a
 * picture, so the board is the pictures: you compare results, not progress. The
 * state of each is a quiet line under its own card, never the point of it.
 *
 * One with no picture yet shows its sentence, big, where its picture will go —
 * not a grey rectangle pretending to be a loading picture. There is something
 * true to say, so it says it.
 *
 * Presentational: everything arrives as props, including `now`.
 */

export type BoardPiece = OnBoard & {
  /** One of several goes at the same thing, and which one. */
  oneOf?: { of: number; at: number } | null;
  /** Which folder this belongs to, when the board is showing more than one.
   *  `where` is the path an action needs; `project` is what a person calls it. */
  where?: string;
  project?: string;
  /** Said when it did not work. */
  trouble?: string | null;
  /** What this one is waiting for, already a sentence. Null when it waits for
   *  nothing, which is almost all of them. */
  after?: { id: string; doing: string; says: string } | null;
  /** What this one came to. Null until anything has been spent on it. */
  spent?: Money | null;
};

export type BoardProps = {
  pieces: readonly BoardPiece[];
  /** Now, epoch ms. Passed in so the board draws the same twice. */
  now: number;
  /** Take this one's result into the project. Offered once it has finished.
   *  The folder comes with it, because a board can be showing several. */
  onKeep?: (id: string, where?: string) => void;
  /** Let one go. */
  onDrop?: (id: string, where?: string) => void;
  /** Look at one's result properly. */
  onLook?: (id: string, where?: string) => void;
  /** How many go side by side, for the line under the summary. */
  atOnce?: number;
};

function Card({
  piece,
  now,
  onKeep,
  onDrop,
  onLook,
}: {
  piece: BoardPiece;
  now: number;
  onKeep?: (id: string, where?: string) => void;
  onDrop?: (id: string, where?: string) => void;
  onLook?: (id: string, where?: string) => void;
}) {
  const picture = piece.picture ?? null;
  const alt = `What ${piece.doing} ended up looking like`;

  return (
    <article className={`work work--${piece.state}`} aria-label={piece.doing}>
      <div className="work__frame">
        {picture === null ? (
          <p className="work__instead">{piece.doing}</p>
        ) : onLook === undefined ? (
          <img className="work__picture" src={picture} alt={alt} />
        ) : (
          <button
            type="button"
            className="work__open"
            onClick={() => onLook(piece.id, piece.where)}
            aria-label={`${boardWords.look} — ${piece.doing}`}
          >
            <img className="work__picture" src={picture} alt={alt} />
          </button>
        )}
      </div>

      <div className="work__said">
        {/* Both of these answer "which one am I looking at?", so they come
            before the sentence whether or not there is a picture above it.
            The folder only when the board is showing more than one: on a board
            of one it would be the same word on every card. */}
        {piece.project === undefined ? null : (
          <p className="work__where">{piece.project}</p>
        )}
        {piece.oneOf === null || piece.oneOf === undefined ? null : (
          <p className="work__oneof">{boardWords.oneOf(piece.oneOf.at, piece.oneOf.of)}</p>
        )}
        {picture === null ? null : <p className="work__doing">{piece.doing}</p>}
        <p className="work__state">
          <span className="work__dot" aria-hidden="true" />
          {saysState(piece.state)}
          <span className="work__when">{saysWhen(piece.at, now)}</span>
          {/* A row is a picture, a sentence and what it cost. Absent until
              there is a number, like the meter — nothing spent, nothing said. */}
          {piece.spent === null || piece.spent === undefined ? null : (
            <span className="work__spent">{formatMoney(piece.spent)}</span>
          )}
        </p>
        {/* A plan is only a plan if you can see it. Under the state line,
            because it is a fact about when this starts, not about what it is. */}
        {piece.after === null || piece.after === undefined ? null : (
          <p className="work__after">{piece.after.says}</p>
        )}
        {piece.trouble === null || piece.trouble === undefined ? null : (
          <p className="work__trouble">{piece.trouble}</p>
        )}
      </div>

      <div className="work__controls">
        {piece.state === 'done' && onKeep !== undefined ? (
          <button
            type="button"
            className="work__keep"
            onClick={() => onKeep(piece.id, piece.where)}
            aria-label={`${boardWords.keep} — ${piece.doing}`}
            title={
              piece.oneOf === null || piece.oneOf === undefined
                ? undefined
                : boardWords.insteadOfOthers(piece.oneOf.of)
            }
          >
            {boardWords.keep}
          </button>
        ) : null}
        {onDrop === undefined ? null : (
          <button
            type="button"
            className="work__drop"
            onClick={() => onDrop(piece.id, piece.where)}
            aria-label={`${saysDrop(piece.state)} — ${piece.doing}`}
          >
            {saysDrop(piece.state)}
          </button>
        )}
      </div>
    </article>
  );
}

export default function Board({ pieces, now, onKeep, onDrop, onLook, atOnce }: BoardProps) {
  const bands = groupWork(pieces);
  const anyWaiting = pieces.some((one) => one.state === 'waiting');

  return (
    <section className="board" aria-label="What is being worked on">
      <header className="board__head">
        <p className="board__summary">{saysBoard(pieces)}</p>
        {anyWaiting ? <p className="board__note">{saysFull(atOnce)}</p> : null}
      </header>

      {bands.map((band) => (
        <section key={band.key} className="board__band" aria-label={band.label}>
          <h3 className="board__band-name">{band.label}</h3>
          <ul className="board__sheet">
            {band.items.map((piece) => (
              <li key={piece.id} className="board__cell">
                <Card piece={piece} now={now} onKeep={onKeep} onDrop={onDrop} onLook={onLook} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
