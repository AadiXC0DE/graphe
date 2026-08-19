import { useState } from 'react';
import {
  boardWords,
  canHearYou,
  speaksForGroup,
  groupWork,
  saysBoard,
  saysDrop,
  saysFull,
  saysState,
  saysWhen,
  type OnBoard,
} from '../work/board';
import { orderToTake, stackWords, type Standing } from '../work/stack';
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
  oneOf?: { of: number; at: number;
    /** What the goes share, so any one of them can open the comparison. */
    named: string } | null;
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
  /** The files it changed, once it has finished. What lets the order say where
   *  two of them are going to meet. */
  touches?: readonly string[] | null;
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
  /** Say something to one that is still going. Left off, the offer is not
   *  made — there is nothing to say to work that has already finished.
   *  Answers whether it was taken, so the card never claims it was. */
  onSay?: (id: string, text: string, where?: string) => Promise<boolean>;
  /** Hold the several goes at one job up against each other. */
  onAgainst?: (named: string, where?: string) => void;
  /** Let one off the wait it was given, so it can take the next free slot. */
  onStopWaiting?: (id: string, where?: string) => void;
  /** Take everything that has finished, in the order it has to go in. Left off,
   *  the offer is not made and each one is still a press of its own. */
  onTakeAll?: (ids: readonly string[], where?: string) => void;
  /** How many go side by side, for the line under the summary. */
  atOnce?: number;
};

function Card({
  piece,
  now,
  onKeep,
  onDrop,
  onLook,
  onSay,
  onAgainst,
  onStopWaiting,
  speaksHere = false,
}: {
  piece: BoardPiece;
  now: number;
  onKeep?: (id: string, where?: string) => void;
  onDrop?: (id: string, where?: string) => void;
  onLook?: (id: string, where?: string) => void;
  onSay?: (id: string, text: string, where?: string) => Promise<boolean>;
  onAgainst?: (named: string, where?: string) => void;
  onStopWaiting?: (id: string, where?: string) => void;
  /** Whether this is the card that carries the comparison for its group. */
  speaksHere?: boolean;
}) {
  const picture = piece.picture ?? null;
  const alt = `What ${piece.doing} ended up looking like`;
  const [saying, setSaying] = useState(false);
  const [words, setWords] = useState('');
  const [heard, setHeard] = useState(false);
  const [sending, setSending] = useState(false);
  // Nothing that has stopped can hear anything, so the offer is not made.
  const canSay = onSay !== undefined && canHearYou(piece.state);

  /* The note follows the answer, never the press. Saying "it will hear that"
     on the way out put the sentence on screen beside a sheet saying it had not
     been heard, which is the one reading a person cannot resolve. */
  const say = (): void => {
    if (onSay === undefined || words.trim() === '') return;
    const said = words.trim();
    // The box stays open and stays full until the answer is in. Closing it on
    // the way out lost the sentence in exactly the case it was refused — and
    // the refusal says the words are still in the box.
    setSending(true);
    void onSay(piece.id, said, piece.where)
      .then((taken) => {
        if (!taken) return;
        setWords('');
        setSaying(false);
        setHeard(true);
      })
      .finally(() => setSending(false));
  };

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
        {piece.after == null || onStopWaiting === undefined ? null : (
          <button
            type="button"
            className="work__say"
            onClick={() => onStopWaiting(piece.id, piece.where)}
            aria-label={`${boardWords.stopWaiting} — ${piece.doing}`}
          >
            {boardWords.stopWaiting}
          </button>
        )}
        {piece.oneOf == null || onAgainst === undefined || !speaksHere ? null : (
          <button
            type="button"
            className="work__say"
            onClick={() => {
              if (piece.oneOf != null) onAgainst(piece.oneOf.named, piece.where);
            }}
            aria-label={`${boardWords.against} — ${piece.doing}`}
          >
            {boardWords.against}
          </button>
        )}
        {canSay ? (
          <button
            type="button"
            className="work__say"
            aria-expanded={saying}
            onClick={() => {
              setSaying((was) => !was);
              setHeard(false);
            }}
            aria-label={`${boardWords.say} — ${piece.doing}`}
          >
            {boardWords.say}
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

      {saying && canSay ? (
        <div className="work__aside">
          <input
            className="work__box"
            value={words}
            autoFocus
            placeholder={boardWords.sayPlaceholder}
            aria-label={`${boardWords.say} — ${piece.doing}`}
            onChange={(event) => setWords(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') say();
              if (event.key === 'Escape') setSaying(false);
            }}
          />
          <button
            type="button"
            className="work__send"
            disabled={words.trim() === '' || sending}
            onClick={say}
          >
            {sending ? boardWords.sending : boardWords.send}
          </button>
        </div>
      ) : null}
      {heard && canSay ? (
        <p className="work__heard" role="status">
          {boardWords.sent}
        </p>
      ) : null}
    </article>
  );
}

/**
 * The one press that takes everything finished, in the order it has to go in.
 *
 * On the band rather than on a card, because it is about the several of them
 * together and there is no card it belongs to. The order itself is behind it:
 * nobody has to open it to press, and anybody who wants to know what will
 * happen can see the whole thing without leaving the sheet.
 *
 * Offered only for one project at a time. A board can be showing several, and
 * work going into two projects is two acts however it is drawn.
 */
function TakeSet({
  pieces,
  onTakeAll,
}: {
  pieces: readonly BoardPiece[];
  onTakeAll: (ids: readonly string[], where?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ready = pieces.filter((one) => one.state === 'done');
  const wheres = new Set(ready.map((one) => one.where ?? ''));
  if (ready.length < 2 || wheres.size > 1) return null;

  const standing: Standing[] = ready.map((one) => ({
    id: one.id,
    doing: one.doing,
    at: one.at,
    ready: true,
    after: one.after?.id ?? null,
    touches: one.touches ?? null,
    ...(one.oneOf?.named == null ? {} : { ways: one.oneOf.named }),
  }));
  const planned = orderToTake(standing);
  const where = ready[0]?.where;

  // An order that cannot exist is a sentence, and the press is not offered
  // beside it — pressing it could only produce the same sentence again.
  if (!planned.ok) return <p className="board__cannot">{planned.because}</p>;

  const named = (id: string): string =>
    planned.order.find((one) => one.id === id)?.doing ?? id;

  return (
    <div className="board__set">
      <div className="board__set-row">
        <button
          type="button"
          className="board__take"
          onClick={() => onTakeAll(planned.order.map((one) => one.id), where)}
        >
          {stackWords.takeAll(planned.order.length)}
        </button>
        <button
          type="button"
          className="board__order-toggle"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? stackWords.hide : stackWords.show}
        </button>
      </div>
      <p className="board__set-what">{stackWords.what}</p>

      <div className={`board__order ${open ? 'board__order--open' : ''}`}>
        <div className="board__order-inner">
          <ol className="board__order-list">
            {planned.order.map((one, at) => (
              <li key={one.id} className="board__order-step">
                <span className="board__order-number" aria-hidden="true">
                  {at + 1}
                </span>
                <span className="board__order-doing">{one.doing}</span>
                <span className="board__order-note">
                  {one.after !== null && planned.order.some((other) => other.id === one.after)
                    ? stackWords.behind(named(one.after))
                    : stackWords.alone}
                </span>
              </li>
            ))}
          </ol>
          {planned.meetings.length === 0 ? null : (
            <div className="board__meets">
              {planned.meetings.map((meeting) => (
                <p key={`${meeting.one}\u0000${meeting.other}`} className="board__meets-line">
                  {stackWords.meets(named(meeting.one), named(meeting.other), meeting.files)}
                </p>
              ))}
              <p className="board__meets-what">{stackWords.meetsWhat}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Board({ pieces, now, onKeep, onDrop, onLook, onSay, onAgainst, onStopWaiting, onTakeAll, atOnce }: BoardProps) {
  const speaksFor = speaksForGroup(pieces);
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
          {band.key === 'finished' && onTakeAll !== undefined ? (
            <TakeSet pieces={band.items} onTakeAll={onTakeAll} />
          ) : null}
          <ul className="board__sheet">
            {/* Names are handed out per folder, so two projects both have a
                "work-1". On a board showing several, the id alone is not a name. */}
            {band.items.map((piece) => (
              <li key={`${piece.where ?? ''}\u0000${piece.id}`} className="board__cell">
                <Card piece={piece} now={now} onKeep={onKeep} onDrop={onDrop} onLook={onLook} onSay={onSay} onAgainst={onAgainst} onStopWaiting={onStopWaiting} speaksHere={speaksFor.has(piece.id)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
