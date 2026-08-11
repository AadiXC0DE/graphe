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
  /** Said when it did not work. */
  trouble?: string | null;
};

export type BoardProps = {
  pieces: readonly BoardPiece[];
  /** Now, epoch ms. Passed in so the board draws the same twice. */
  now: number;
  /** Take this one's result into the project. Offered once it has finished. */
  onKeep?: (id: string) => void;
  /** Let one go. */
  onDrop?: (id: string) => void;
  /** Look at one's result properly. */
  onLook?: (id: string) => void;
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
  onKeep?: (id: string) => void;
  onDrop?: (id: string) => void;
  onLook?: (id: string) => void;
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
            onClick={() => onLook(piece.id)}
            aria-label={`${boardWords.look} — ${piece.doing}`}
          >
            <img className="work__picture" src={picture} alt={alt} />
          </button>
        )}
      </div>

      <div className="work__said">
        {picture === null ? null : <p className="work__doing">{piece.doing}</p>}
        <p className="work__state">
          <span className="work__dot" aria-hidden="true" />
          {saysState(piece.state)}
          <span className="work__when">{saysWhen(piece.at, now)}</span>
        </p>
        {piece.trouble === null || piece.trouble === undefined ? null : (
          <p className="work__trouble">{piece.trouble}</p>
        )}
      </div>

      <div className="work__controls">
        {piece.state === 'done' && onKeep !== undefined ? (
          <button
            type="button"
            className="work__keep"
            onClick={() => onKeep(piece.id)}
            aria-label={`${boardWords.keep} — ${piece.doing}`}
          >
            {boardWords.keep}
          </button>
        ) : null}
        {onDrop === undefined ? null : (
          <button
            type="button"
            className="work__drop"
            onClick={() => onDrop(piece.id)}
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
