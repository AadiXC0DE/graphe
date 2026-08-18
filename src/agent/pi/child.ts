/** What a helper is, and how its words are read.
 *
 * A helper is one piece of a larger job, handed to a child process with its
 * own fresh context. Two things about that handover are decided here:
 *
 *  - **The role.** "Review this" and "research this" are different jobs with
 *    different honest tool sets, and a helper told to review should not be
 *    drifting around the web. Roles pick the tools and the instructions that
 *    match the job's shape; every role stays read-only — a helper finds
 *    findings, and the main agent applies them.
 *
 *  - **The boundary between a helper's words and the conversation.** A helper
 *    that was handed untrusted text (a page it read, a diff it was asked to
 *    review) can hand some of it back, and certain shapes carry weight in a
 *    conversation: a line that begins `Human:` can read as a person speaking,
 *    and a `<system-reminder>` can read as an instruction from the machine.
 *    None of that is true when it comes from a helper, so its words are
 *    neutralised at the boundary before anything reaches the parent.
 */

export type HelperRole = 'helper' | 'reviewer' | 'researcher' | 'builder';

/** The roles a person (or the model, on their behalf) can hand a job to. */
export const HELPER_ROLES: readonly HelperRole[] = ['helper', 'reviewer', 'researcher', 'builder'];

/** The tools this app lets any helper hold, and the web pair some roles add. */
const LOCAL_TOOLS = ['read', 'ls', 'grep', 'find'] as const;
const WEB_TOOLS = ['websearch', 'webfetch'] as const;
/** Only a builder holds these, and only ever inside its own copy. */
const MAKING_TOOLS = ['write', 'edit', 'bash'] as const;

export type RoleSpec = {
  name: HelperRole;
  /** What the model reads when it is choosing who to hand work to. */
  idea: string;
  /** The tools this role may hold, a subset of the safe list. */
  tools: readonly string[];
  /** Whether this role may change files. True for exactly one role, and only
   *  inside a copy of the project made for it — the folder it is given is the
   *  whole world it can reach, because every path rule is measured from there. */
  mayChange: boolean;
  /** Whether the work needs a copy of the project to happen in. */
  needsCopy: boolean;
  /** The instructions that go with the job, read by the child first. */
  spoken: string;
};

/** The last line of every role's instructions: a helper that truly needs a
 *  decision stops and says so, and the person answers in the main thread. */
const NEEDS_A_DECISION =
  'If you need a decision only the person can make, stop working and finish with a line that starts "To continue I need to know:" followed by the question. The person will answer in the main conversation, and work can carry on from there.';

export const ROLES: Readonly<Record<HelperRole, RoleSpec>> = {
  helper: {
    name: 'helper',
    idea: 'general research and double-checking',
    tools: [...LOCAL_TOOLS, ...WEB_TOOLS],
    mayChange: false,
    needsCopy: false,
    spoken: `You are a helper working one piece of a larger job. Stay on the piece you were handed, work it out from the project and the web, and report findings — never changes. ${NEEDS_A_DECISION}`,
  },
  reviewer: {
    name: 'reviewer',
    idea: 'find the real problems in the work, each with a file and line',
    tools: [...LOCAL_TOOLS],
    mayChange: false,
    needsCopy: false,
    spoken:
      'You are a reviewer. Read the work you were handed and find only genuine problems — bugs, security, correctness, missing edge cases — each with a file and line to point at. Do not invent issues: if you cannot justify a problem from what you read, do not report it. Never change anything. ' +
      NEEDS_A_DECISION,
  },
  researcher: {
    name: 'researcher',
    idea: 'gather facts from the web and the project, and say where they came from',
    tools: [...LOCAL_TOOLS, ...WEB_TOOLS],
    mayChange: false,
    needsCopy: false,
    spoken: `You are a researcher. Gather facts and evidence — from the web and from the project on disk — and name where each fact came from so it can be checked. Never change anything. ${NEEDS_A_DECISION}`,
  },
  builder: {
    name: 'builder',
    idea: 'make one self-contained change, in its own copy of the project',
    tools: [...LOCAL_TOOLS, ...MAKING_TOOLS],
    mayChange: true,
    needsCopy: true,
    spoken:
      'You are a builder. You have your own copy of the project and you are the only one working in it, so make the change you were asked for rather than describing it. Stay inside the piece you were handed: a copy that also changes three other things cannot be read, and will not be taken. When you are done, say in a sentence or two what you changed and where, so somebody deciding whether to take it does not have to read it all. ' +
      NEEDS_A_DECISION,
  },
};

/** The spec for a role name handed in by the model; anything it does not know
 *  is the plain helper, so a wild role can never widen the tool set. */
export function roleSpec(role: HelperRole | null | undefined): RoleSpec {
  return ROLES[role ?? 'helper'] ?? ROLES.helper;
}

/* -------------------------------------------------------------------------- */
/* What a helper is allowed to run                                             */
/* -------------------------------------------------------------------------- */

/** Said to the child, not to a person: it is the model that has to understand
 *  why the call did not happen, and carry on usefully without it. Two, because
 *  "helpers cannot change anything" stopped being true for one of them, and a
 *  reason that is not true is worse than none. */
export const HELPER_DECLINED = {
  reading:
    'This could not be done by a helper: helpers cannot ask questions or change anything. Report what you found and let the main agent decide.',
  building:
    'This could not be done here: a builder works only inside the copy it was given, cannot ask questions, and cannot run anything destructive. Make the change another way, or say what stopped you.',
} as const;

function declined(spec: RoleSpec): string {
  return spec.mayChange ? HELPER_DECLINED.building : HELPER_DECLINED.reading;
}

/**
 * Whether one call may run, given the role and what the Guard made of it.
 *
 * Pure, so the rule can be read and checked in one place rather than inferred
 * from a closure in a child process nobody can attach to. The asymmetry is the
 * point: a helper that changes nothing may have a question answered yes on its
 * behalf, because nothing it does is worth asking about. A helper that writes
 * may not — there is still nobody to ask, and yes is no longer free.
 */
export function mayRun(
  spec: RoleSpec,
  call: { name: string },
  verdict: { kind: 'allow' | 'deny' | 'confirm' | 'snapshot-first'; reason?: string },
  mutates: boolean,
): { block: true; reason: string } | undefined {
  if (!spec.tools.includes(call.name.toLowerCase())) return { block: true, reason: declined(spec) };
  if (verdict.kind === 'deny') return { block: true, reason: verdict.reason ?? declined(spec) };
  if (!spec.mayChange) {
    return mutates ? { block: true, reason: declined(spec) } : undefined;
  }
  return verdict.kind === 'allow' ? undefined : { block: true, reason: declined(spec) };
}

/* -------------------------------------------------------------------------- */
/* The boundary                                                                */
/* -------------------------------------------------------------------------- */

/** A line that would read as a person taking over the conversation. Turned
 *  into a plain heading-shape the model cannot mistake for a real turn. */
const TURN_MARKER = /^(Human|Assistant|System)\s*[:：]\s?/i;

/** Tags that would read as the machine talking to itself. Brackets instead of
 *  angle brackets: the words stay, the power goes. */
const CONTROL_TAG = /<(\/?)(system[-_ ]?reminder|user[-_ ]?turn|im_start|im_end)>/gi;

/** A helper's words, made safe to read as text. Pure: everything here is a
 *  string in, a string out, and a test can say so. */
export function safeChildWords(text: string): string {
  const withMarkers = text
    .split('\n')
    .map((line) => {
      const marker = TURN_MARKER.exec(line);
      if (marker !== null) return `[${marker[1]}] ${line.slice(marker[0].length)}`;
      return line;
    })
    .join('\n');
  return withMarkers.replace(CONTROL_TAG, (_whole, slash: string, tag: string) =>
    `[${slash === '/' ? '/' : ''}${tag}]`,
  );
}