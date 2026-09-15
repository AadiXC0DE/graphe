/** Stable identity for everything an operation can target.
 *
 * A path is an attribute, never a session identity. So is a display name, a tab
 * index and whatever the renderer has selected: identity is generated here and
 * never inferred from any of them. The brand is what makes that checkable, by
 * keeping a raw string from standing in for an id by accident.
 *
 * `globalThis.crypto` rather than `node:crypto`: this module is imported by the
 * window as well as by the shell — a native page's id is minted where the page
 * is drawn — and a `node:` import cannot be bundled for a renderer. Node 22 and
 * Chromium both have it, and both draw from the same source of randomness.
 */

declare const idBrand: unique symbol;

/** A string only the factories and parsers in this file can produce. Phantom: at
 *  runtime an id is the same UUID string it always was. */
export type Id<B extends string> = string & { readonly [idBrand]: B };

/** The one project a folder belongs to. Moving or renaming the folder does not
 *  change it, which is why nothing resolves a project by its display name. */
export type ProjectId = Id<'ProjectId'>;

/** One folder a conversation writes in. Two conversations may name the same
 *  folder and stay two workspaces, because the registry owns the relationship. */
export type WorkspaceId = Id<'WorkspaceId'>;

/** One chat: its transcript, drafts and queue. Not a tab, and not Pi's session
 *  file, both of which are recorded beside it. */
export type ConversationId = Id<'ConversationId'>;

/** One open tab or pane. Closing a view is not closing a conversation. */
export type ViewId = Id<'ViewId'>;

/** One execution of a conversation: the thing Stop acts on, and the thing a
 *  stale event from an older generation must not restart. */
export type RunId = Id<'RunId'>;

/** One question waiting for an answer. Answering it twice has to be harmless. */
export type RequestId = Id<'RequestId'>;

/** One event, so a repeat can be told from a new event at the same position. */
export type EventId = Id<'EventId'>;

/** A generation of the app runtime. Ordered on purpose: "older generation" has
 *  to be decidable before a late event can be dropped, and a UUID cannot be
 *  ordered. The supervisor persists the counter so a restart never reuses one. */
export type RuntimeEpoch = number & { readonly [idBrand]: 'RuntimeEpoch' };

/** A position in one owner's stream. Only comparable inside one epoch. */
export type Sequence = number & { readonly [idBrand]: 'Sequence' };

/* ---------------------------------------------------------------- making */

/** A fresh id. Generated, never derived from a path, a name or a selection. */
export function newId<B extends string>(): Id<B> {
  const raw: string = globalThis.crypto.randomUUID();
  return raw as Id<B>;
}

/** A new project id, for a folder a person just chose. */
export function newProjectId(): ProjectId {
  return newId<'ProjectId'>();
}

/** A new workspace id, whether the folder is shared or made for one chat. */
export function newWorkspaceId(): WorkspaceId {
  return newId<'WorkspaceId'>();
}

/** A new conversation id. A draft gets one before it has sent anything. */
export function newConversationId(): ConversationId {
  return newId<'ConversationId'>();
}

/** A new view id, for a tab or pane that shows a conversation. */
export function newViewId(): ViewId {
  return newId<'ViewId'>();
}

/** A new run id, for one execution that a Stop and a cancellation epoch name. */
export function newRunId(): RunId {
  return newId<'RunId'>();
}

/** A new request id, so two identical questions are still two requests. */
export function newRequestId(): RequestId {
  return newId<'RequestId'>();
}

/** A new event id, kept when a recorded event is replayed. */
export function newEventId(): EventId {
  return newId<'EventId'>();
}

/** The next runtime generation. Takes the last one written down, so a restart
 *  cannot hand out a generation an old event still names. */
export function nextRuntimeEpoch(previous: RuntimeEpoch | null): RuntimeEpoch {
  const from = previous === null ? 0 : previous;
  return (from + 1) as RuntimeEpoch;
}

/** A generation that came from storage or from another process. */
export function asRuntimeEpoch(raw: number): RuntimeEpoch {
  if (!Number.isInteger(raw) || raw < 1) {
    throw new TypeError('A runtime generation is a whole number of 1 or more.');
  }
  return raw as RuntimeEpoch;
}

/* --------------------------------------------------------------- reading */

/** Shape is not checked: legacy ids are still in flight during the migration,
 *  and the brand is what keeps new code from making one up. Blank is refused
 *  because a blank id used to mean "whichever one is open". */
function parsed<B extends string>(what: string, raw: string): Id<B> {
  if (raw.trim() === '') throw new TypeError(`A ${what} cannot be blank.`);
  return raw as Id<B>;
}

/** Read a project id that came from storage, IPC or a record on disk. */
export function asProjectId(raw: string): ProjectId {
  return parsed('project id', raw);
}

/** Read a workspace id that came from outside this process. */
export function asWorkspaceId(raw: string): WorkspaceId {
  return parsed('workspace id', raw);
}

/** Read a conversation id that came from outside this process. */
export function asConversationId(raw: string): ConversationId {
  return parsed('conversation id', raw);
}

/** Read a view id that came from outside this process. */
export function asViewId(raw: string): ViewId {
  return parsed('view id', raw);
}

/** Read a run id that came from outside this process. */
export function asRunId(raw: string): RunId {
  return parsed('run id', raw);
}

/** Read a request id that came from outside this process. */
export function asRequestId(raw: string): RequestId {
  return parsed('request id', raw);
}

/** Read an event id that came from outside this process. */
export function asEventId(raw: string): EventId {
  return parsed('event id', raw);
}

/* -------------------------------------------------------------- counting */

/** Positions handed out by one runtime for one owner. Monotonic within one
 *  epoch only: a new epoch starts again at 1, so a number from generation 4
 *  says nothing about a number from generation 3. */
export interface SequenceSource {
  readonly epoch: RuntimeEpoch;
  /** The next position for this epoch. One higher every call. */
  nextSequence(): Sequence;
  /** The highest position handed out; zero before the first call. */
  currentSequence(): Sequence;
}

/** A counter for one generation. Two counters made for the same epoch are two
 *  separate streams, so a reattaching runtime can never take up another's. */
export function sequenceFor(epoch: RuntimeEpoch): SequenceSource {
  let handed = 0;
  return {
    epoch,
    nextSequence(): Sequence {
      handed += 1;
      return handed as Sequence;
    },
    currentSequence(): Sequence {
      return handed as Sequence;
    },
  };
}
