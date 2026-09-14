/** The conversation, drawn only where somebody can see it.
 *
 * A sitting open since Monday holds thousands of turns, and every one of them
 * in the document is a document the browser lays out again for every token that
 * arrives. So the rows on screen are drawn and the rest are two blocks of empty
 * room, which is all this is: the arithmetic lives in `lib/windowed.ts`.
 *
 * Rows are asked for by their own id rather than by their place, because the
 * list moves underneath: a turn arrives at the end while a reply is being
 * written, and "show earlier turns" puts five hundred rows above whatever
 * somebody was reading. Heights are kept per id, each drawn row is watched for
 * a change in size — a reply growing, a picture that was not there yet — and the
 * reader's own row is put back where it was on screen when the list moves.
 */

import { Fragment, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

import type { Row } from '../lib/steps';
import { useWindowed } from '../lib/windowed';

/** What one row is called. True of a message and of a run of steps drawn as one
 *  line, so a row keeps its identity — and its measured height — as the
 *  conversation grows under it. */
export function rowKey(row: Row): string {
  return row.kind === 'steps' ? row.id : row.turn.id;
}

export function ThreadRows(props: {
  /** The conversation, row by row, in the order it is read. */
  rows: readonly Row[];
  /** The scroller the band sits in: the window's own page, not the list. */
  scroller: RefObject<HTMLElement | null>;
  /** One row, drawn. `mark` goes on the element that is the row itself, so its
   *  height can be measured and watched. */
  draw: (row: Row, at: number, mark: (el: HTMLElement | null) => void) => ReactNode;
  /** Above the window: the press that reaches the rest of the conversation. */
  lead?: ReactNode;
  /** Below it: what the run is doing, and what the last one cost. */
  trail?: ReactNode;
  /** A row somebody has asked for by name — a search result, a turn the panel
   *  sent them to. Brought into view even when it has not been drawn yet. */
  bring?: string | null;
  hidden?: boolean;
  guess?: number;
  over?: number;
}): ReactNode {
  const { rows, scroller, draw, lead, trail, bring, hidden, guess, over } = props;
  const list = useRef<HTMLDivElement | null>(null);
  const keys = rows.map(rowKey);
  const { first, last, before, after, measure, sizes } = useWindowed(keys, {
    scroller,
    list,
    ...(guess === undefined ? {} : { guess }),
    ...(over === undefined ? {} : { over }),
  });

  /* A row nobody has drawn is not in the document to be scrolled to, so where
     it is comes from the arithmetic instead, and the window follows it in. */
  const brought = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (bring === null || bring === undefined || brought.current === bring) return;
    const pane = scroller.current;
    const band = list.current;
    const at = sizes.offsetOfKey(bring);
    if (pane === null || band === null || at === null) return;
    brought.current = bring;
    const bandAt =
      band.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
    pane.scrollTop = Math.max(0, bandAt + at - pane.clientHeight / 4);
    // `rows` is here rather than only `bring`: a turn far enough back that
    // nobody had drawn it is not in the list until the press that reaches it
    // has been made, and the row is only there to bring into view afterwards.
  }, [bring, rows, sizes, scroller]);

  return (
    <div className="thread" hidden={hidden} ref={list}>
      {lead}
      <div style={{ height: before }} aria-hidden="true" />
      {rows.slice(first, last).map((row, offset) => {
        const key = rowKey(row);
        return (
          // A fragment, so a row wrapper is the row the caller drew and the
          // spacing between turns is the spacing it has always been.
          <Fragment key={key}>
            {draw(row, first + offset, (el) => measure(key, el))}
          </Fragment>
        );
      })}
      <div style={{ height: after }} aria-hidden="true" />
      {trail}
    </div>
  );
}
