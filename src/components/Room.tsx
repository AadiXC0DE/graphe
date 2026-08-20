import type { Room as RoomState } from '../lib/ipc';
import type { Turn } from '../lib/thread';
import { ROOM_WORDS } from '../lib/roomshare';
import RoomShare from './RoomShare';
import './Room.css';

type Props = {
  /** Null before the model has answered once, and for a moment after a tidy. */
  room: RoomState | null;
  /** True while the conversation is being shortened. */
  tidying: boolean;
  /** Shorten it now. Absent means the ring is a reading and nothing more. */
  onTidy?: () => void;
  /** Nothing can be asked for mid-reply. */
  busy?: boolean;
  /** The conversation, for the split behind the ring. Left off, the tip stays
   *  the two numbers it has always been. */
  turns?: readonly Turn[];
};

export const SAYS = {
  /** What the ring is, for anybody who has never met one. */
  what: 'How much of this conversation the model is still holding.',
  /** The same, plus the reason the size moves when nobody changed anything. */
  whatFull:
    'How much of this conversation the model is still holding — the model in use decides how much room there is.',
  tidy: 'Tidy up',
  tidying: 'Tidying…',
  tidyingWhat: 'Shortening this conversation now. The numbers settle when it is done.',
  tidyHint: 'Sums up what has been covered so far and keeps going with more room.',
  full: 'Nearly full — tidying now would give it room.',
} as const;

/** Past this it is worth saying so. Pi tidies by itself before it overflows;
 *  this is the point where somebody might want to choose the moment. */
const TIGHT = 0.75;

/** A whole number of thousands, which is the only precision worth showing. */
function thousands(count: number): string {
  return count >= 1000 ? `${Math.round(count / 1000).toLocaleString()}k` : String(count);
}

/**
 * The ring beside the box: how full this conversation is.
 *
 * A conversation that fills up is the one thing in this app that changes what
 * the agent can do without anybody touching a setting, and until now the only
 * sign of it was a sentence that appeared after it had already happened. It is
 * one small ring — no number in the resting state, because a number that moves
 * every turn is a number that gets watched instead of the work.
 */
export default function Room({ room, tidying, onTidy, busy, turns }: Props) {
  if (room === null && !tidying) return null;

  const part = tidying ? 0 : (room?.part ?? 0);
  const tight = part >= TIGHT;
  const said =
    room === null || room.used === null
      ? SAYS.what
      : `${thousands(room.used)} of ${thousands(room.total)} used · ${Math.round(part * 100)}%`;

  /* One ring, drawn as a dash pattern on a circle. r=6 puts the whole thing in
     16px, and the stroke is the same width as everything else here. */
  const circumference = 2 * Math.PI * 6;

  return (
    <span className="room" data-tight={tight ? 'yes' : 'no'}>
      <span
        className={`room__ring ${tidying ? 'room__ring--going' : ''}`}
        role="img"
        aria-label={tidying ? SAYS.tidying : `${said}. ${SAYS.whatFull}`}
        tabIndex={0}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle className="room__track" cx="8" cy="8" r="6" />
          <circle
            className="room__used"
            cx="8"
            cy="8"
            r="6"
            strokeDasharray={`${circumference * part} ${circumference}`}
          />
        </svg>

        {/* The numbers the ring cannot show. The ring's label carries the same
            information for anyone listening. */}
        <span className="room__tip" aria-hidden="true">
          <span className="room__tipcard">
            {tidying || room === null || room.used === null ? (
              <span className="room__tipwhat">
                {tidying ? SAYS.tidyingWhat : room?.used === null ? ROOM_WORDS.notKnown : SAYS.whatFull}
              </span>
            ) : turns === undefined ? (
              <span className="room__tipcount">
                <span className="room__tipfraction">
                  {room.used.toLocaleString()} of {room.total.toLocaleString()}
                </span>
                <span className="room__tippart">{Math.round(part * 100)}%</span>
              </span>
            ) : (
              /* The same two numbers, plus what is taking up the room. Behind
                 the ring rather than beside it: nobody needs the split on screen
                 every turn, and everybody has their hand on the ring already. */
              <RoomShare turns={turns} tokens={room.used} contextWindow={room.total} />
            )}
          </span>
        </span>
      </span>

      {onTidy === undefined ? null : (
        <button
          type="button"
          className="room__tidy"
          onClick={onTidy}
          disabled={busy === true || tidying || room === null || room.used === null}
          title={tight ? SAYS.full : SAYS.tidyHint}
        >
          {tidying ? SAYS.tidying : SAYS.tidy}
        </button>
      )}
    </span>
  );
}
