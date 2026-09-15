import type { AppNotice } from '../lib/ipc';
import ErrorCard from './ErrorCard';
import './AppWide.css';

export const APPWIDE_WORDS = {
  /** The one press: read, and out of the way. Nothing here is an action the
   *  window can take on somebody's behalf — installing git is theirs. */
  putAway: 'Got it',
} as const;

type Props = {
  /** What this machine is missing, in the order it was found. */
  notices: readonly AppNotice[];
  onPutAway: (id: string) => void;
};

/**
 * What is true of the machine rather than of the conversation.
 *
 * Drawn above everything in the column, so it is there whether a project is
 * open or not, and whether or not anybody has said anything yet. That is the
 * whole reason it exists apart from the thread: a first launch on a Mac with no
 * command line tools has no conversation to put a sentence in, and the sentence
 * used to be sent into one anyway and dropped on the floor.
 *
 * A recovery note rather than a banner: it says what is missing, what to do
 * about it, and goes away when it has been read.
 */
export default function AppWide({ notices, onPutAway }: Props) {
  if (notices.length === 0) return null;
  return (
    <div className="appwide">
      {notices.map((one) => (
        <ErrorCard
          key={one.id}
          what={one.what}
          because={one.because}
          actionLabel={APPWIDE_WORDS.putAway}
          onAction={() => onPutAway(one.id)}
        />
      ))}
    </div>
  );
}
