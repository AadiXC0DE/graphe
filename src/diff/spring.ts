/** A spring, for the one control in the app that is dragged.
 *
 * notes/strategy/UI-DESIGN.md: *"Drag the diff handle, drag the timeline —
 * springs, because they can be interrupted."* That is the whole argument. A
 * duration-based transition owns the next 200ms and finishes what it started;
 * grab the handle mid-flight and it either fights you or snaps. A spring has no
 * plan — it has a position, a velocity and somewhere it is heading, so moving
 * the target mid-gesture just bends the path it was already on.
 *
 * Critically damped, near enough. `bounce` on an everyday control is the
 * "playful once, irritating by the fiftieth time" row of the anti-patterns
 * table, and a wipe handle is touched constantly.
 *
 * Pure arithmetic, so the feel can be tested rather than felt at: settles,
 * never overshoots by more than a hair, and survives the target moving under it
 * — which is the property the whole choice was made for.
 */

export type Springing = {
  position: number;
  velocity: number;
};

export type SpringFeel = {
  /** How hard it pulls towards the target. */
  stiffness?: number;
  /** How much the movement is resisted. At `2 * sqrt(stiffness)` it settles
   *  without passing the target at all. */
  damping?: number;
};

/**
 * Stiff enough to feel attached to the finger, soft enough to be a spring.
 *
 * Tuned by dragging it. At a fifth of this it lagged the pointer by a fifth of
 * the screen, which does not read as springy — it reads as the app being slow.
 * The give is meant to be felt on release and on an arrow key, not as a gap
 * between where you are pointing and where the handle is.
 *
 * `2 * sqrt(700) ≈ 52.9`, and the damping is a shade over that, so it arrives
 * quietly rather than touching the far side first. It settles in about 200ms.
 */
const FEEL = {
  stiffness: 700,
  damping: 54,
} as const;

/** Longer than this and we have been away — a tab in the background, a window
 *  being dragged between monitors. Stepping the whole gap at once launches the
 *  handle across the screen; capping it just resumes. */
const LONGEST_STEP = 64;

/** Close enough, and slow enough, to stop pretending it is still moving. */
const SETTLED = 0.0005;

/**
 * One frame of it.
 *
 * `elapsed` is in milliseconds — whatever the browser handed us between frames,
 * capped, then integrated in small enough slices that a slow frame cannot make
 * the spring unstable. Semi-implicit Euler: velocity first, then position, which
 * is the ordering that stays stable at these stiffnesses.
 */
export function stepSpring(
  from: Springing,
  target: number,
  elapsed: number,
  feel: SpringFeel = {},
): Springing {
  const stiffness = feel.stiffness ?? FEEL.stiffness;
  const damping = feel.damping ?? FEEL.damping;

  const total = Math.min(Math.max(elapsed, 0), LONGEST_STEP);
  const slices = Math.max(1, Math.ceil(total / 8));
  const slice = total / slices / 1000;

  let { position, velocity } = from;
  for (let step = 0; step < slices; step += 1) {
    const pull = -stiffness * (position - target);
    const drag = -damping * velocity;
    velocity += (pull + drag) * slice;
    position += velocity * slice;
  }

  if (Math.abs(position - target) < SETTLED && Math.abs(velocity) < SETTLED * 60) {
    return { position: target, velocity: 0 };
  }
  return { position, velocity };
}

/** True once there is nothing left to draw. */
export function hasSettled(state: Springing, target: number): boolean {
  return state.position === target && state.velocity === 0;
}
