/** One copy button's state, so the four that exist agree.
 *
 * A Copy that quietly does nothing leaves whatever was on the clipboard
 * before, which reads as having copied the wrong thing — so a refusal says the
 * key to press instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const HELD = 1600;
const HELD_AFTER_FAILING = 2600;

export const COPY = {
  idle: 'Copy',
  done: 'Copied',
  useKey: 'Press ⌘C',
} as const;

/** Put text on the clipboard, saying whether it landed. Never throws — a copy
 *  that fails has to be able to say so. */
export async function copyText(text: string): Promise<boolean> {
  if (text.trim() === '') return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type Copying = {
  /** What the button should read right now. */
  label: string;
  /** True while the clipboard has just been written, for a tick or a tint. */
  copied: boolean;
  failed: boolean;
  copy: (text: string) => void;
};

export function useCopying(words: { idle?: string } = {}): Copying {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const settle = useCallback((ok: boolean) => {
    setCopied(ok);
    setFailed(!ok);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        setCopied(false);
        setFailed(false);
      },
      ok ? HELD : HELD_AFTER_FAILING,
    );
  }, []);

  const copy = useCallback(
    (text: string) => {
      if (text.trim() === '') return;
      void copyText(text).then(settle);
    },
    [settle],
  );

  return {
    label: failed ? COPY.useKey : copied ? COPY.done : (words.idle ?? COPY.idle),
    copied,
    failed,
    copy,
  };
}
