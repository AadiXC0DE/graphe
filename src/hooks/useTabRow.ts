/**
 * The row of tabs as it is drawn, published for the keyboard.
 *
 * ⌘1–9, ⌘W and ⌘⇧[ ] all act on the row somebody is looking at, but the
 * listener that answers them is subscribed once for the life of the window —
 * so it cannot close over a row that changes every time a turn moves. Each
 * render says what the row is now; the keys read it back.
 *
 * Nothing here decides anything. Going to a tab and putting one down are the
 * window's own, handed over the same way for the same reason.
 */

import { useRef } from 'react';

export type TabRow = {
  /** What the row is this render: every tab in order, which one is in front,
   *  and whichever has stopped to ask somebody. */
  drawn(open: readonly string[], at: string | null, wantsYou: string | undefined): void;
  /** How to go to one and how to put one down. */
  handles(goTo: (id: string) => Promise<void>, close: (id: string) => Promise<void>): void;
  /** The tab in front, or null. */
  at(): string | null;
  /** The nth tab, counting from one, or null when the row is shorter. */
  nth(n: number): string | null;
  /** One step along the row from the one in front, wrapping at both ends. Null
   *  when there is nowhere else to go. */
  along(step: number): string | null;
  /** Whichever tab is waiting on a person, or null. */
  wantsYou(): string | null;
  goTo(id: string): void;
  close(id: string): void;
};

export function useTabRow(): TabRow {
  const open = useRef<readonly string[]>([]);
  const at = useRef<string | null>(null);
  const wantsYou = useRef<string | undefined>(undefined);
  const goTo = useRef<(id: string) => Promise<void>>(async () => {});
  const close = useRef<(id: string) => Promise<void>>(async () => {});
  const held = useRef<TabRow | null>(null);

  held.current ??= {
    drawn(nowOpen, nowAt, nowWantsYou) {
      open.current = nowOpen;
      at.current = nowAt;
      wantsYou.current = nowWantsYou;
    },
    handles(nowGoTo, nowClose) {
      goTo.current = nowGoTo;
      close.current = nowClose;
    },
    at() {
      return at.current;
    },
    nth(n) {
      return open.current[n - 1] ?? null;
    },
    along(step) {
      const row = open.current;
      const here = row.indexOf(at.current ?? '');
      if (here === -1 || row.length < 2) return null;
      return row[(here + step + row.length) % row.length] ?? null;
    },
    wantsYou() {
      return wantsYou.current ?? null;
    },
    goTo(id) {
      void goTo.current(id);
    },
    close(id) {
      void close.current(id);
    },
  };

  return held.current;
}
