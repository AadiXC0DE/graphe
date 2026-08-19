import type { CSSProperties } from 'react';

import type { Turn } from '../lib/thread';
import { ROOM_WORDS, saysRoom, sharesOf } from '../lib/roomshare';
import './RoomShare.css';

type Props = {
  /** The conversation, read for the split. */
  turns: readonly Turn[];
  /** The model's own count, or null when it has none to give. */
  tokens: number | null;
  contextWindow: number;
};

function percent(part: number): string {
  /* Never rounded down to nothing: a slice that is drawn has to be a slice you
     can read in the legend beside it. */
  return `${Math.max(1, Math.round(part * 100))}%`;
}

/**
 * The bar beside the ring: what is taking up the room.
 *
 * The ring says how full the conversation is; this says what filled it. Two
 * different questions, so two different shapes — a second ring next to the
 * first would read as a rival reading of the same thing.
 *
 * The split is ours and the total is the model's, and the interface never lets
 * those two blur: the counted figure sits above the bar, the note under it says
 * in words that everything between them is an estimate, and no band ever
 * carries a size — only a share.
 */
export default function RoomShare({ turns, tokens, contextWindow }: Props) {
  const said = saysRoom(tokens, contextWindow);

  if (tokens === null) {
    return (
      <section className="roomshare" aria-label={ROOM_WORDS.heading}>
        <h3 className="roomshare__heading">{ROOM_WORDS.heading}</h3>
        <p className="roomshare__note">{ROOM_WORDS.notKnown}</p>
      </section>
    );
  }

  const shares = sharesOf(turns);

  let along = 0;
  const bands = shares.map((share) => {
    const from = along;
    along += share.part;
    return { share, from };
  });

  const spoken = shares.map((share) => `${share.label} ${percent(share.part)}`).join(', ');

  return (
    <section className="roomshare" aria-label={ROOM_WORDS.heading}>
      <h3 className="roomshare__heading">{ROOM_WORDS.heading}</h3>
      <p className="roomshare__total">{said}</p>

      {shares.length === 0 ? (
        <p className="roomshare__note">{ROOM_WORDS.empty}</p>
      ) : (
        <>
          {/* One bar, read by the legend under it. The bands are told apart by
              tone and by name, never by tone alone. */}
          <div className="roomshare__bar" role="img" aria-label={`${spoken}. ${ROOM_WORDS.estimated}`}>
            {bands.map(({ share, from }) => (
              <span
                key={share.kind}
                className="roomshare__band"
                data-kind={share.kind}
                style={
                  {
                    '--from': from,
                    '--part': share.part,
                  } as CSSProperties
                }
              />
            ))}
          </div>

          <ul className="roomshare__legend">
            {shares.map((share) => (
              <li className="roomshare__row" key={share.kind}>
                <span className="roomshare__swatch" data-kind={share.kind} aria-hidden="true" />
                <span className="roomshare__name">{share.label}</span>
                <span className="roomshare__part">{percent(share.part)}</span>
              </li>
            ))}
          </ul>

          <p className="roomshare__note">{ROOM_WORDS.estimated}</p>
        </>
      )}
    </section>
  );
}
