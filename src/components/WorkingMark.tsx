import './WorkingMark.css';

/**
 * The quiet mark that says work is in hand.
 *
 * Shown in the silent moments of a run — the model thinking before its first
 * visible step — when there are no activity rows to carry the spinners. A
 * dither and three staggered dots, under one short sentence. The moment a step
 * appears the mark goes away and the step carries the motion, so the two never
 * speak at once.
 */
export default function WorkingMark() {
  return (
    <div className="workingmark" role="status" aria-label="Working on it">
      <span className="workingmark__dots" aria-hidden="true">
        <span className="workingmark__dot" />
        <span className="workingmark__dot" />
        <span className="workingmark__dot" />
      </span>
      <span className="workingmark__words">On it — working this through.</span>
    </div>
  );
}
