import type { WorkspaceTrouble } from '../lib/ipc';
import { RECOVERY_WORDS } from '../work/recovery';
import './Recovery.css';

type Props = {
  /** What the shell found about the folder this conversation recorded. */
  trouble: WorkspaceTrouble;
  /** Choose the folder this conversation should work in from now on. Left out
   *  where the window cannot offer it, and then only the continuation shows. */
  onRelink?: () => void;
  /** Start somewhere new, carrying a note about what was said here. */
  onContinue: () => void;
  /** True while the folder is being chosen. */
  choosing?: boolean;
};

/**
 * A conversation whose folder is gone, opened read-only.
 *
 * This is the whole surface for the plan's read-only case, and it is a band
 * rather than a card because the conversation below it is still readable: the
 * transcript is there, the box is not. Both ways forward are real operations on
 * the same conversation — relink points this one at the folder its work is in
 * now, continuing starts a new chat in the project — and neither pretends the
 * missing files were recovered.
 *
 * Drawn above the thread rather than in it, so it cannot be mistaken for
 * something the agent said. A read-only fact belongs to the view, not to the
 * conversation.
 */
export default function Recovery({
  trouble,
  onRelink,
  onContinue,
  choosing = false,
}: Props) {
  return (
    <section
      className="recovery"
      role="status"
      aria-label={RECOVERY_WORDS.heading}
    >
      <div className="recovery__head">
        <span className="recovery__mark" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
            <path
              d="M2.5 5.2 8 2.4l5.5 2.8v5.6L8 13.6l-5.5-2.8z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <path
              d="M2.8 5.4 8 8.1l5.2-2.7M8 8.1v5.2"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
        </span>
        <h2 className="recovery__heading">{RECOVERY_WORDS.heading}</h2>
      </div>

      <p className="recovery__because">{trouble.because}</p>

      <div className="recovery__acts">
        {onRelink === undefined ? null : (
          <button
            type="button"
            className="recovery__act recovery__act--first"
            title={RECOVERY_WORDS.relinkHint}
            onClick={onRelink}
            disabled={choosing}
          >
            {choosing ? RECOVERY_WORDS.choosing : RECOVERY_WORDS.relink}
          </button>
        )}
        <button
          type="button"
          className="recovery__act"
          title={RECOVERY_WORDS.continueHint}
          onClick={onContinue}
        >
          {RECOVERY_WORDS.continueHere}
        </button>
      </div>
    </section>
  );
}
