/** A time limit on what an extension may do while the turn waits for it.
 *
 * Pi awaits every `agent_end` handler before it settles, so one extension that
 * blocks there holds the whole conversation open and the window shows a run
 * that never ends. Lifecycle handlers get a budget; whatever is still running
 * when it expires is let go of and the event carries on.
 *
 * `tool_call` is deliberately not in the set: a handler there may be waiting on
 * a person to answer, and a person is allowed to take their time.
 */

/**
 * Long enough for a handler doing real work, short enough that a settle still
 * reaches the window inside two seconds of the model's last token — which is
 * the difference between an app that finished and an app that looks stopped.
 *
 * `GRAPHE_HOOK_BUDGET_MS` raises it for anybody who wants to give an add-on
 * more room.
 */
export const HOOK_BUDGET_MS = 1500;

export const BUDGETED_EVENTS: readonly string[] = [
  'agent_end',
  'agent_settled',
  'turn_end',
  'turn_start',
  'session_compact',
  'before_agent_start',
];

export type Overrun = { extension: string; event: string; ms: number };

export type Raced = { over: boolean; ms: number; value: unknown };

export function budgetMs(env: Record<string, string | undefined> = process.env): number {
  const given = env.GRAPHE_HOOK_BUDGET_MS;
  if (given === undefined) return HOOK_BUDGET_MS;
  const asked = Number(given.trim());
  if (!Number.isFinite(asked) || asked <= 0) return HOOK_BUDGET_MS;
  return Math.round(asked);
}

/**
 * Wait for `work`, but not past `ms`.
 *
 * Past the budget the caller is handed `{ over: true }` and the promise is
 * dropped: nothing awaits it again, and a rejection arriving afterwards is
 * already spoken for, so it cannot surface as an unhandled rejection and take
 * the process down. A failure *inside* the budget is rethrown, because Pi's own
 * emit reports extension errors and that reporting should keep working.
 */
export async function raceBudget(work: Promise<unknown>, ms: number): Promise<Raced> {
  const began = Date.now();
  const expired = Symbol('expired');
  const settled = work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const bell = new Promise<typeof expired>((resolve) => {
    timer = setTimeout(() => resolve(expired), Math.max(0, ms));
    // A pending budget is not a reason for the process to stay alive.
    (timer as unknown as { unref?: () => void }).unref?.();
  });

  const first = await Promise.race([settled, bell]);
  if (timer !== undefined) clearTimeout(timer);
  if (first === expired) return { over: true, ms: Date.now() - began, value: undefined };
  if (!first.ok) throw first.error;
  return { over: false, ms: Date.now() - began, value: first.value };
}

/* -------------------------------------------------------------------------- */
/* What went over, kept for "show me"                                          */
/* -------------------------------------------------------------------------- */

const RING = 20;
const gone: Overrun[] = [];

export function recentOverruns(): readonly Overrun[] {
  return gone.slice();
}

export function forgetOverruns(): void {
  gone.length = 0;
}

function remember(one: Overrun): void {
  gone.push(one);
  if (gone.length > RING) gone.splice(0, gone.length - RING);
}

/* -------------------------------------------------------------------------- */
/* Wrapping a runner                                                           */
/* -------------------------------------------------------------------------- */

type Handler = (...args: never[]) => unknown;

type Registered = {
  path?: string;
  resolvedPath?: string;
  handlers?: Map<string, Handler[]>;
};

/** Set on a handler we have already wrapped, so a second pass is a no-op. */
const BUDGETED = Symbol.for('graphe.hook-budget');

/** Set on a handler map already watching for late registrations. */
const WATCHED = Symbol.for('graphe.hook-budget.watched');

/** The folder an extension lives in, which is what its author called it. */
function nameOf(one: Registered): string {
  const where = one.resolvedPath ?? one.path ?? '';
  const parts = where.split(/[\\/]/).filter((part) => part !== '');
  const last = parts[parts.length - 1];
  if (last === undefined) return 'an add-on';
  const parent = parts[parts.length - 2];
  if (/^index\./.test(last) && parent !== undefined) return parent;
  return last.replace(/\.[^.]+$/, '');
}

function budgeted(
  handler: Handler,
  extension: string,
  event: string,
  ms: number,
  onOverrun: (o: Overrun) => void,
): Handler {
  const wrapped = async (...args: never[]): Promise<unknown> => {
    const raced = await raceBudget(Promise.resolve(handler(...args)), ms);
    if (!raced.over) return raced.value;
    const one: Overrun = { extension, event, ms: raced.ms };
    remember(one);
    onOverrun(one);
    // No opinion from a handler that ran out of time; the event moves on.
    return undefined;
  };
  Object.defineProperty(wrapped, BUDGETED, { value: true });
  return wrapped as Handler;
}

/**
 * Put a budget on every lifecycle handler the runner is holding.
 *
 * The handlers are wrapped where they sit rather than the emit loop being
 * rewritten, so Pi keeps its own error reporting and result semantics and the
 * only difference is that a handler which stops answering stops mattering.
 */
export function withHookBudget<T extends { extensions?: readonly unknown[] }>(
  runner: T,
  onOverrun: (o: Overrun) => void,
  ms: number = budgetMs(),
): T {
  const holding = runner as unknown as { extensions?: readonly Registered[] };
  for (const one of holding.extensions ?? []) {
    const handlers = one.handlers;
    if (!(handlers instanceof Map)) continue;
    const extension = nameOf(one);
    for (const event of BUDGETED_EVENTS) {
      const list = handlers.get(event);
      if (list === undefined || list.length === 0) continue;
      handlers.set(
        event,
        list.map((handler) =>
          BUDGETED in handler ? handler : budgeted(handler, extension, event, ms, onOverrun),
        ),
      );
    }
    watchForLateOnes(handlers, extension, ms, onOverrun);
  }
  return runner;
}

/**
 * An add-on that registers `agent_end` inside `session_start` registers it after
 * this has already been round once. Anything set from then on is wrapped as it
 * lands, so a late handler is budgeted like an early one.
 *
 * Re-running the sweep also catches the other way of registering, which is
 * pushing onto the list already there.
 */
function watchForLateOnes(
  handlers: Map<string, Handler[]>,
  extension: string,
  ms: number,
  onOverrun: (o: Overrun) => void,
): void {
  if (WATCHED in handlers) return;
  Object.defineProperty(handlers, WATCHED, { value: true });
  const set = handlers.set.bind(handlers);
  handlers.set = (event: string, list: Handler[]): Map<string, Handler[]> => {
    if (!BUDGETED_EVENTS.includes(event) || !Array.isArray(list)) return set(event, list);
    return set(
      event,
      list.map((handler) =>
        typeof handler === 'function' && !(BUDGETED in handler)
          ? budgeted(handler, extension, event, ms, onOverrun)
          : handler,
      ),
    );
  };
}
