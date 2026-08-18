import type { Helper } from '../lib/projects';

/** The state of a helper, as a shape rather than a colour: a ring that turns
 *  while it works, a tick when it is finished, a bar when it stopped. Nothing
 *  here depends on being able to tell red from green. */
export default function HelperMark({ state }: { state: Helper['state'] }) {
  if (state === 'running') {
    return <span className="helpermark helpermark--running" aria-hidden="true" />;
  }
  return (
    <span className="helpermark" aria-hidden="true">
      {state === 'done' ? (
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
          <path
            d="M2 6l3 3 5-5.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
          <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}
