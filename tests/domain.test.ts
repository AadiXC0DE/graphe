/** The vocabulary the ownership contract rests on, before any of it is wired up.
 *
 * Nothing here starts a runtime or touches a disk. The claims are the ones the
 * later phases lean on: an id cannot be swapped for a raw string, a sequence
 * only means something inside its own generation, a failure cannot be read as a
 * success, a restart cannot report a dead process as running, and verification
 * cannot call a broken workspace ready. */

import { describe, expect, it } from 'vitest';

import {
  canTransition,
  isTerminal,
  recoverAfterRestart,
  SESSION_STATES,
  TRANSITIONS,
  type DurableFacts,
  type RuntimeState,
  type SessionState,
} from '../src/domain/conversations';
import {
  conversationOwner,
  isSameOwner,
  isStale,
  newerThan,
  owned,
  runOwner,
  workspaceOwner,
  type EnvelopeInput,
  type OwnerEnvelope,
} from '../src/domain/events';
import {
  describeFailure,
  isPartialFailure,
  type FailureKind,
  type NotFoundFailure,
  type OperationCancelledFailure,
  type OperationFailure,
  type PartialEffects,
  type PartialFailure,
  type StaleOwnerFailure,
  type WorkspaceUnavailableFailure,
} from '../src/domain/failures';
import {
  asConversationId,
  asEventId,
  asProjectId,
  asRequestId,
  asRunId,
  asRuntimeEpoch,
  asViewId,
  asWorkspaceId,
  newConversationId,
  newEventId,
  newId,
  newProjectId,
  newRequestId,
  newRunId,
  newViewId,
  newWorkspaceId,
  nextRuntimeEpoch,
  sequenceFor,
  type ConversationId,
  type EventId,
  type Id,
  type ProjectId,
  type RequestId,
  type RunId,
  type ViewId,
  type WorkspaceId,
} from '../src/domain/identity';
import {
  bindConversation,
  emptyIndex,
  indexWorkspace,
  verify,
  workspaceFor,
  type FailedVerification,
  type Verification,
  type Verified,
  type WorkspaceHead,
  type WorkspaceIndex,
  type WorkspaceKind,
  type WorkspaceObservation,
  type WorkspaceRecord,
  type WorkspaceState,
} from '../src/domain/workspaces';

function acceptsProject(_id: ProjectId): void {}

describe('D-01 an id is generated, not inferred', () => {
  it('gives every kind its own identity and reads it back unchanged', () => {
    const project: ProjectId = newProjectId();
    const workspace: WorkspaceId = newWorkspaceId();
    const conversation: ConversationId = newConversationId();
    const view: ViewId = newViewId();
    const run: RunId = newRunId();
    const request: RequestId = newRequestId();
    const event: EventId = newEventId();
    const made = { project, workspace, conversation, view, run, request, event };

    expect(new Set(Object.values(made)).size).toBe(7);
    expect({
      project: asProjectId(made.project),
      workspace: asWorkspaceId(made.workspace),
      conversation: asConversationId(made.conversation),
      view: asViewId(made.view),
      run: asRunId(made.run),
      request: asRequestId(made.request),
      event: asEventId(made.event),
    }).toEqual(made);
  });

  it('refuses a blank id and passes a legacy one through untouched', () => {
    const parsers = [asProjectId, asWorkspaceId, asConversationId, asViewId, asRunId, asRequestId, asEventId];
    for (const parse of parsers) {
      expect(() => parse('')).toThrow(TypeError);
      expect(() => parse('  \t\n ')).toThrow(TypeError);
    }
    expect(asRunId('legacy-run-1')).toBe('legacy-run-1');
  });

  it('keeps a raw string out, and one kind out of another', () => {
    acceptsProject(newProjectId());

    type CustomId = Id<'CustomId'>;
    const custom: CustomId = newId<'CustomId'>();
    expect(String(custom)).toHaveLength(36);

    // @ts-expect-error a raw string is not a project id
    acceptsProject('conversation-1');
    // @ts-expect-error a view id is not a project id
    acceptsProject(newViewId());
    // @ts-expect-error another kind of id does not become a project id
    acceptsProject(custom);
  });
});

describe('D-02 a sequence belongs to one generation', () => {
  it('orders generations and counts up inside one', () => {
    const first = nextRuntimeEpoch(null);
    const second = nextRuntimeEpoch(first);
    expect(second).toBeGreaterThan(first);

    const counter = sequenceFor(second);
    expect(counter.currentSequence()).toBe(0);
    expect(counter.nextSequence()).toBe(1);
    expect(counter.nextSequence()).toBe(2);
    expect(counter.currentSequence()).toBe(2);

    // The next generation starts at 1 again, which is why a bare number never
    // says which of two events came later.
    expect(sequenceFor(nextRuntimeEpoch(second)).nextSequence()).toBe(1);
  });

  it('refuses a generation that is not a whole number of one or more', () => {
    expect(asRuntimeEpoch(4)).toBe(4);
    expect(() => asRuntimeEpoch(0)).toThrow(TypeError);
    expect(() => asRuntimeEpoch(1.5)).toThrow(TypeError);
  });
});

describe('D-03 a failure is words a person can act on', () => {
  const kinds: FailureKind[] = [
    'not-found',
    'stale-owner',
    'workspace-unavailable',
    'operation-cancelled',
    'partial-failure',
  ];
  const notFound: NotFoundFailure = {
    kind: 'not-found',
    entity: 'conversation',
    id: 'gone',
    detail: 'no record',
  };
  const stale: StaleOwnerFailure = {
    kind: 'stale-owner',
    ownerId: conversationOwner(newConversationId()),
    epoch: asRuntimeEpoch(3),
    currentEpoch: asRuntimeEpoch(4),
    detail: 'an older run asked',
  };
  const unavailable: WorkspaceUnavailableFailure = {
    kind: 'workspace-unavailable',
    workspaceId: newWorkspaceId(),
    detail: 'the folder is gone',
  };
  const stopped: OperationCancelledFailure = {
    kind: 'operation-cancelled',
    operationId: 'op-1',
    detail: 'stopped',
  };
  const effects: PartialEffects = { happened: ['wrote the file'], unknown: ['committed'] };
  const partial: PartialFailure = {
    kind: 'partial-failure',
    effects,
    detail: 'the commit never reported',
  };
  const failures: OperationFailure[] = [notFound, stale, unavailable, stopped, partial];

  it('describes every kind as plain words', () => {
    expect(failures.map((failure) => failure.kind).sort()).toEqual([...kinds].sort());
    for (const failure of failures) {
      const said = describeFailure(failure);
      expect(said.trim().length).toBeGreaterThan(0);
      expect(said).not.toContain('\u2014');
      expect(said).not.toContain(' \u2013 ');
    }
    expect(describeFailure(notFound)).toBe('There is no conversation with that id any more.');
    expect(describeFailure(partial)).toContain('may or may not have happened');
  });

  it('carries effects on the partial case alone', () => {
    expect(isPartialFailure(partial)).toBe(true);
    expect(failures.filter((failure) => !isPartialFailure(failure))).toHaveLength(4);
    expect(partial.effects.happened).toEqual(['wrote the file']);
    expect(partial.effects.unknown).toEqual(['committed']);
  });
});

describe('D-04 an envelope names its owner, its generation and its place', () => {
  const epoch = nextRuntimeEpoch(null);
  const chat = conversationOwner(newConversationId());

  it('takes the next position, its own id, and the clock it was handed', () => {
    const sequences = sequenceFor(epoch);
    const first: OwnerEnvelope<string> = owned({
      ownerId: chat,
      runtimeEpoch: epoch,
      sequences,
      payload: 'open',
      at: 1_700_000_000_000,
    });
    const second: OwnerEnvelope<string> = owned({
      ownerId: chat,
      runtimeEpoch: epoch,
      sequences,
      payload: 'send',
      at: 1_700_000_000_001,
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(first.eventId).not.toBe(second.eventId);
    expect(first.at).toBe(1_700_000_000_000);
    expect(second.payload).toBe('send');
    expect(first.ownerId).toEqual(chat);
  });

  it('refuses a counter borrowed from another generation', () => {
    const later = nextRuntimeEpoch(epoch);
    const borrowed: EnvelopeInput<string> = {
      ownerId: chat,
      runtimeEpoch: later,
      sequences: sequenceFor(epoch),
      payload: 'open',
    };
    expect(() => owned(borrowed)).toThrow(Error);
  });

  it('tells owners apart by kind, not by the text of an id', () => {
    const id = newConversationId();
    expect(isSameOwner(conversationOwner(id), conversationOwner(id))).toBe(true);
    expect(isSameOwner(conversationOwner(id), runOwner(asRunId(id)))).toBe(false);
    expect(isSameOwner(runOwner(newRunId()), workspaceOwner(newWorkspaceId()))).toBe(false);
  });

  it('stales an older generation and a lower place, and nothing else', () => {
    const sequences = sequenceFor(epoch);
    const older: OwnerEnvelope<string> = owned({ ownerId: chat, runtimeEpoch: epoch, sequences, payload: 'a', at: 2 });
    const newer: OwnerEnvelope<string> = owned({ ownerId: chat, runtimeEpoch: epoch, sequences, payload: 'b', at: 1 });

    expect(isStale(older, newer)).toBe(true);
    expect(isStale(newer, older)).toBe(false);
    expect(newerThan(newer, older)).toBe(true);
    expect(newerThan(older, newer)).toBe(false);
    // The same place is not staleness. That is the same event, told apart by id.
    expect(isStale(older, { ...older })).toBe(false);

    const later = nextRuntimeEpoch(epoch);
    const afterRestart = owned({ ownerId: chat, runtimeEpoch: later, sequences: sequenceFor(later), payload: 'c', at: 3 });
    expect(isStale(older, afterRestart)).toBe(true);
    expect(isStale(afterRestart, older)).toBe(false);

    const elsewhere = owned({ ownerId: workspaceOwner(newWorkspaceId()), runtimeEpoch: later, sequences: sequenceFor(later), payload: 'd', at: 4 });
    expect(isStale(elsewhere, newer)).toBe(false);
    expect(newerThan(afterRestart, elsewhere)).toBe(false);
  });
});

describe('D-05 a conversation has a state, and a restart has one rule', () => {
  it('has a row for every state and refuses the moves that would double a writer', () => {
    for (const state of SESSION_STATES) {
      expect(TRANSITIONS[state].length).toBeGreaterThan(0);
    }
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...SESSION_STATES].sort());

    expect(canTransition('idle', 'running')).toBe(true);
    expect(canTransition('running', 'waiting-input')).toBe(true);
    expect(canTransition('waiting-input', 'running')).toBe(true);
    // Opening again while one is in flight would be two writers, one transcript.
    expect(canTransition('opening', 'opening')).toBe(false);
    expect(canTransition('unloaded', 'running')).toBe(false);
    expect(canTransition('archived', 'running')).toBe(false);
    expect(canTransition('failed', 'running')).toBe(false);
  });

  it('calls an ended attempt terminal, and leaves unloaded out of it', () => {
    expect(SESSION_STATES.filter(isTerminal)).toEqual(['interrupted', 'failed', 'archived']);
    expect(isTerminal('unloaded')).toBe(false);
    expect(isTerminal('idle')).toBe(false);

    // Nothing leaves these but an open the user asked for.
    expect(TRANSITIONS['interrupted']).toEqual(['opening', 'archived']);
    expect(TRANSITIONS['failed']).toEqual(['opening', 'archived']);
    expect(TRANSITIONS['archived']).toEqual(['opening']);
  });

  it('interrupts work that was in flight and keeps what had already ended', () => {
    const facts = (status: SessionState): DurableFacts => ({
      conversationId: newConversationId(),
      workspaceId: newWorkspaceId(),
      status,
      ownerId: runOwner(newRunId()),
      runtimeEpoch: asRuntimeEpoch(4),
      writtenAt: 1_700_000_000_000,
    });

    for (const inFlight of ['opening', 'queued', 'running', 'waiting-input', 'compacting', 'stopping'] as const) {
      expect(recoverAfterRestart(facts(inFlight), false)).toEqual({
        state: 'interrupted',
        runtimeEpoch: null,
        ownerId: null,
      });
    }

    // Nothing was running, so the restart interrupted nothing.
    expect(recoverAfterRestart(facts('idle'), false).state).toBe('idle');
    expect(recoverAfterRestart(facts('unloaded'), false).state).toBe('unloaded');
    expect(recoverAfterRestart(facts('archived'), false).state).toBe('archived');
    expect(recoverAfterRestart(facts('failed'), false).state).toBe('failed');

    const running = facts('running');
    const reattached: RuntimeState = recoverAfterRestart(running, true);
    expect(reattached).toEqual({
      state: 'running',
      runtimeEpoch: asRuntimeEpoch(4),
      ownerId: running.ownerId,
    });
    // A generation is what makes "still alive" believable, so a claim of life
    // without one is not believed.
    expect(recoverAfterRestart({ ...running, runtimeEpoch: null }, true).state).toBe('interrupted');
  });
});

describe('D-06 verification never calls a broken workspace ready', () => {
  const REPO = '/Users/somebody/project/.git';

  function record(over: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
    const kind: WorkspaceKind = 'worktree';
    const state: WorkspaceState = 'creating';
    const head: WorkspaceHead | null = null;
    return {
      workspaceId: newWorkspaceId(),
      projectId: newProjectId(),
      kind,
      cwd: '/Users/somebody/worktrees/one',
      originalPath: '/Users/somebody/project',
      displayPath: 'project (isolated)',
      repositoryIdentity: REPO,
      managed: true,
      baseSha: 'a'.repeat(40),
      head,
      creationOperationId: 'op-create-1',
      state,
      ...over,
    };
  }

  function seen(over: Partial<WorkspaceObservation> = {}): WorkspaceObservation {
    return { exists: true, head: 'main', repositoryIdentity: REPO, ...over };
  }

  it('refuses ready when the folder is gone', () => {
    const checked: Verification = verify(record(), seen({ exists: false }));
    expect(checked.ok).toBe(false);
    if (checked.ok) throw new Error('a missing folder verified as ready');

    const refused: FailedVerification = checked;
    expect(refused.state).toBe('missing');
    expect(refused.failure).toMatchObject({ kind: 'workspace-unavailable' });

    /* The type is the second guard: a failed check cannot be written into the
       ready state at all, so no caller reads the state as one. */
    // @ts-expect-error a failed verification can never carry the ready state
    const claimed: 'ready' = refused.state;
    expect(String(claimed)).toBe('missing');
  });

  it('never stores the literal HEAD for a detached checkout', () => {
    const checked: Verification = verify(record(), seen({ head: 'HEAD' }));
    expect(checked.ok).toBe(false);
    if (checked.ok) throw new Error('an unresolved head verified as ready');
    expect(checked.state).toBe('recovery-required');
  });

  it('keeps the commit a detached checkout is on', () => {
    const sha = 'c'.repeat(40);
    const head: WorkspaceHead = { kind: 'detached', sha };
    const checked: Verification = verify(record({ state: 'ready' }), seen({ head: sha }));
    if (!checked.ok) throw new Error('a healthy worktree was refused');

    const verified: Verified = checked;
    expect(verified.state).toBe('ready');
    expect(verified.record.head).toEqual(head);
  });

  it('reads a branch as a branch', () => {
    const checked: Verification = verify(record(), seen({ head: 'fix/ownership-stabilization' }));
    if (!checked.ok) throw new Error('a checked out branch was refused');
    expect(checked.record.head).toEqual({ kind: 'branch', branch: 'fix/ownership-stabilization' });
  });

  it('sends a folder that is now another repository to recovery', () => {
    const checked: Verification = verify(record({ state: 'ready' }), seen({ repositoryIdentity: '/somewhere/else/.git' }));
    expect(checked.ok).toBe(false);
    if (checked.ok) throw new Error('a different repository verified as ready');
    expect(checked.state).toBe('recovery-required');
  });

  it('refuses a workspace that has already been removed', () => {
    const checked: Verification = verify(record({ state: 'deleted' }), seen());
    expect(checked.ok).toBe(false);
    if (checked.ok) throw new Error('a removed workspace verified as ready');
    expect(checked.state).toBe('deleted');
  });

  it('maps conversations to workspaces without asking a path', () => {
    const project = newProjectId();
    const first = record({ projectId: project });
    const second = record({ projectId: project });
    let index: WorkspaceIndex = indexWorkspace(indexWorkspace(emptyIndex(), first), second);
    expect(index.byProject.get(project)).toEqual([first.workspaceId, second.workspaceId]);

    const chat = newConversationId();
    index = bindConversation(index, chat, second.workspaceId);
    expect(workspaceFor(index, chat)).toBe(second.workspaceId);
    // A conversation the index does not know is answered as unknown, not guessed.
    expect(workspaceFor(index, newConversationId())).toBeNull();

    // Re-indexing one under another project moves it and leaves no duplicate.
    const elsewhere = newProjectId();
    index = indexWorkspace(index, { ...first, projectId: elsewhere });
    expect(index.byProject.get(elsewhere)).toEqual([first.workspaceId]);
    expect(index.byProject.get(project)).toEqual([second.workspaceId]);
    expect(workspaceFor(index, chat)).toBe(second.workspaceId);
  });
});
