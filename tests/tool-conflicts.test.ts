/** E09: one tool name, two providers.
 *
 * Graphe's own tools, an add-on somebody installed and a bridge an add-on
 * carries all register into the same registry. Pi keeps one definition per name
 * and says nothing, so the loser simply is not there — and the half of it that
 * matters is which one loses. The rule is in `tool-conflicts.ts`; what is here
 * is the rule, and then the registry itself, because a rule about a name is
 * only worth anything if the session that gets built agrees with it.
 *
 * The registry half loads the real SDK, exactly as `tests/adapter.test.ts`
 * does, so an upgrade that changes how a name is won fails here rather than in
 * front of somebody whose `bash` is no longer the guarded one.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { WORKING_TOOLS } from '../src/agent/pi/adapter';
import { GRAPHE_ONLY, apartTools, saysToolConflict, type AddonClaim } from '../src/agent/pi/tool-conflicts';

const made: string[] = [];

function scratch(what: string): string {
  const dir = mkdtempSync(join(tmpdir(), `graphe-${what}-`));
  made.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* The rule                                                                    */
/* -------------------------------------------------------------------------- */

describe('a name an add-on wants that Graphe also uses', () => {
  it('keeps the add-on’s, because installing it was the explicit act', () => {
    const apart = apartTools(['task', 'websearch'], [{ name: 'task', where: 'a-bridge' }]);

    expect(apart.mine).toEqual(['websearch']);
    expect(apart.theirs).toEqual(['task']);
    expect(apart.took).toEqual([]);
    expect(apart.conflicts).toEqual([
      { name: 'task', holder: 'a-bridge', leftOut: '', took: false },
    ]);
  });

  it('says which tool the person will actually get', () => {
    const [one] = apartTools(['task'], [{ name: 'task', where: 'a-bridge' }]).conflicts;
    expect(one === undefined ? '' : saysToolConflict(one)).toBe(
      "a-bridge also brings a tool called “task”, so this chat uses theirs and Graphe's own is left out. Turn that add-on off in Add-ons to get it back.",
    );
  });
});

describe('a name that carries the Guard', () => {
  it('stays Graphe’s, and comes off the add-on that wanted it', () => {
    const apart = apartTools(['read', 'bash', 'edit'], [
      { name: 'bash', where: 'a-bridge' },
      { name: 'read', where: 'a-bridge' },
    ]);

    expect(apart.mine).toEqual(['read', 'bash', 'edit']);
    expect(apart.theirs).toEqual([]);
    expect(apart.took).toEqual([
      { name: 'bash', where: 'a-bridge', at: 0 },
      { name: 'read', where: 'a-bridge', at: 1 },
    ]);
    expect(apart.conflicts.map((one) => one.holder)).toEqual(['', '']);
    expect(saysToolConflict(apart.conflicts[0]!)).toContain('Graphe guards itself');
  });
});

describe('names nobody wants twice', () => {
  it('are all kept, and nothing is said', () => {
    const apart = apartTools(['task', 'mcp'], [
      { name: 'browse', where: 'a-bridge' },
      { name: 'lsp', where: 'a-bridge' },
    ]);

    expect(apart.mine).toEqual(['task', 'mcp']);
    expect(apart.theirs).toEqual(['browse', 'lsp']);
    expect(apart.conflicts).toEqual([]);
  });

  it('are kept once when Graphe names one twice, which the build can do', () => {
    const apart = apartTools(['bash', 'bash', 'task'], []);
    expect(apart.mine).toEqual(['bash', 'task']);
  });

  it('are won by whichever add-on asked first, and said rather than left to load order', () => {
    const claims: AddonClaim[] = [
      { name: 'lsp', where: 'first-bridge' },
      { name: 'lsp', where: 'second-bridge' },
    ];
    const apart = apartTools([], claims);

    expect(apart.theirs).toEqual(['lsp']);
    expect(apart.took).toEqual([{ name: 'lsp', where: 'second-bridge', at: 1 }]);
    expect(apart.conflicts).toEqual([
      { name: 'lsp', holder: 'first-bridge', leftOut: 'second-bridge', took: true },
    ]);
    expect(saysToolConflict(apart.conflicts[0]!)).toContain('second-bridge');
  });

  it('are kept by the first of two add-ons that read the same on screen', () => {
    // A global `~/.pi/extensions/lsp` and a project-local one are both `lsp`,
    // so the display name cannot say which claim lost — only its position can.
    const claims: AddonClaim[] = [
      { name: 'lsp', where: 'lsp' },
      { name: 'lsp', where: 'lsp' },
    ];
    const apart = apartTools([], claims);

    expect(apart.theirs).toEqual(['lsp']);
    expect(apart.took).toEqual([{ name: 'lsp', where: 'lsp', at: 1 }]);
    expect(saysToolConflict(apart.conflicts[0]!)).toContain('Two add-ons both called');
  });
});

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

type OurTool = { name: string; label: string; description: string };

/** One add-on, as the loader reads one: a factory handed Pi's own API, and what
 *  that add-on is called on screen. Two of them can be called the same — a
 *  global `~/.pi/extensions/lsp` and a project-local one both read as `lsp` —
 *  which is the `where` the adapter takes off the loader. */
type Addon = { where: string; tools: readonly OurTool[] };

function bridgeAdding(addon: Addon): { name: string; factory: (api: unknown) => void } {
  return {
    name: addon.where,
    factory: (api) => {
      const register = (api as { registerTool?: (tool: unknown) => void }).registerTool;
      for (const tool of addon.tools) register?.call(api, tool);
    },
  };
}

/** The definitions the real session is built with, side by side, exactly as
 *  `createSession` hands them over. `decided: false` builds the session the way
 *  it was built before any of this: both providers offered, nobody choosing. */
async function sessionWith(options: {
  mine: readonly OurTool[];
  addons: readonly Addon[];
  decided?: boolean;
}): Promise<{
  descriptionOf: (name: string) => string | undefined;
  active: readonly string[];
  /** Each add-on's own registry, in the order the loader read them. */
  registries: readonly Map<string, unknown>[];
  dispose: () => void;
}> {
  const pi = await import('@earendil-works/pi-coding-agent');
  const cwd = scratch('tool-conflict');
  const agentDir = scratch('tool-conflict-agent');
  const loader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: false,
    noThemes: true,
    extensionFactories: options.addons.map(bridgeAdding) as never,
  });
  await loader.reload();

  const loaded = loader.getExtensions().extensions as unknown as {
    tools?: Map<string, unknown>;
  }[];
  const registries = loaded.map((one) =>
    one.tools instanceof Map ? one.tools : new Map<string, unknown>(),
  );
  /** Every name the add-ons asked for, in the order the loader read them and
   *  with the position each claim sits at — the list the adapter builds for
   *  itself, and the only thing its deletion can address by. */
  const claims: AddonClaim[] = [];
  const registryOf: Map<string, unknown>[] = [];
  registries.forEach((tools, group) => {
    for (const name of tools.keys()) {
      if (typeof name !== 'string' || name === '') continue;
      claims.push({ name, where: options.addons[group]?.where ?? '' });
      registryOf.push(tools);
    }
  });

  const apart = apartTools(
    options.mine.map((tool) => tool.name),
    claims,
  );
  const decided = options.decided !== false;
  if (decided) {
    // The resolution, applied the way the adapter applies it: the claim's own
    // position says which registry loses the name.
    for (const one of apart.took) registryOf[one.at]?.delete(one.name);
  }
  const kept = new Set(decided ? apart.mine : options.mine.map((tool) => tool.name));
  const customTools = options.mine.filter((tool) => kept.has(tool.name));

  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    tools: decided
      ? [...apart.mine, ...apart.theirs]
      : [...options.mine.map((tool) => tool.name), ...claims.map((one) => one.name)],
    customTools: customTools as never,
    sessionManager: pi.SessionManager.inMemory(cwd),
  });
  return {
    descriptionOf: (name) => session.getToolDefinition(name)?.description,
    active: session.getActiveToolNames(),
    registries,
    dispose: () => session.dispose(),
  };
}

const GRAPHE_TASK: OurTool = { name: 'task', label: 'Task', description: 'Graphe’s own task tool' };
const GRAPHE_READ: OurTool = { name: 'read', label: 'Read', description: 'Graphe’s own read tool' };
const THEIR_TASK: OurTool = { name: 'task', label: 'Task', description: 'the add-on’s task tool' };
const THEIR_READ: OurTool = { name: 'read', label: 'Read', description: 'the add-on’s read tool' };
const THEIR_LSP_FIRST: OurTool = { name: 'lsp', label: 'LSP', description: 'the first lsp tool' };
const THEIR_LSP_SECOND: OurTool = { name: 'lsp', label: 'LSP', description: 'the second lsp tool' };

describe('the registry both providers write into', () => {
  it('silently keeps Graphe’s when nobody has decided, which is the finding', async () => {
    const built = await sessionWith({
      mine: [GRAPHE_TASK, GRAPHE_READ],
      addons: [{ where: 'a-bridge', tools: [THEIR_TASK, THEIR_READ] }],
      decided: false,
    });
    try {
      // Both providers offered the name and neither of them was told: Graphe's
      // custom tools are registered last, so the installed add-on's tool is
      // simply not there — and nothing said so.
      expect(built.descriptionOf('task')).toBe('Graphe’s own task tool');
      expect(built.descriptionOf('read')).toBe('Graphe’s own read tool');
    } finally {
      built.dispose();
    }
  }, 30_000);

  it('runs the add-on’s, and not Graphe’s, for a name the person installed', async () => {
    const built = await sessionWith({
      mine: [GRAPHE_TASK, GRAPHE_READ],
      addons: [{ where: 'a-bridge', tools: [THEIR_TASK] }],
    });
    try {
      expect(built.descriptionOf('task')).toBe('the add-on’s task tool');
      expect(built.descriptionOf('read')).toBe('Graphe’s own read tool');
      expect(built.active).toContain('task');
    } finally {
      built.dispose();
    }
  }, 30_000);

  it('runs Graphe’s, and not the add-on’s, for a name that carries the Guard', async () => {
    const built = await sessionWith({
      mine: [GRAPHE_TASK, GRAPHE_READ],
      addons: [{ where: 'a-bridge', tools: [THEIR_READ, THEIR_TASK] }],
    });
    try {
      expect(built.descriptionOf('read')).toBe('Graphe’s own read tool');
      // And the one it kept is the add-on's, unchanged by that: taking a name
      // off one registry must not decide the other.
      expect(built.descriptionOf('task')).toBe('the add-on’s task tool');
    } finally {
      built.dispose();
    }
  }, 30_000);

  it('keeps a name an add-on loses out of the session altogether', async () => {
    const built = await sessionWith({
      mine: [GRAPHE_READ],
      addons: [{ where: 'a-bridge', tools: [THEIR_READ] }],
    });
    try {
      // Graphe's definition, and the add-on's name is not a second entry: a
      // transcript that names `read` reaches the guarded one, always.
      expect(built.descriptionOf('read')).toBe('Graphe’s own read tool');
      expect(built.active.filter((name) => name === 'read')).toHaveLength(1);
    } finally {
      built.dispose();
    }
  }, 30_000);

  it('empties the registry of the add-on that lost, not the one that kept', async () => {
    const built = await sessionWith({
      mine: [],
      addons: [
        { where: 'lsp', tools: [THEIR_LSP_FIRST] },
        { where: 'lsp', tools: [THEIR_LSP_SECOND] },
      ],
    });
    try {
      // Both read as `lsp` and neither name says who lost it: only the claim's
      // own position does. Emptying the winner's registry instead leaves the
      // second add-on's tool running under the name the first one asked for.
      expect(built.registries[0]?.has('lsp')).toBe(true);
      expect(built.registries[1]?.has('lsp')).toBe(false);
      expect(built.descriptionOf('lsp')).toBe('the first lsp tool');
      expect(built.active.filter((name) => name === 'lsp')).toHaveLength(1);
    } finally {
      built.dispose();
    }
  }, 30_000);
});

describe('the names Graphe keeps for itself', () => {
  it('are the ones the adapter registers, so a list cannot gain one the other did not', () => {
    expect([...WORKING_TOOLS]).toEqual([...GRAPHE_ONLY]);
  });

  it('are Graphe’s own definition in a session, whatever an add-on wants', async () => {
    const built = await sessionWith({
      mine: GRAPHE_ONLY.map((name) => ({
        name,
        label: name,
        description: `Graphe’s own ${name}`,
      })),
      addons: [
        {
          where: 'a-bridge',
          tools: GRAPHE_ONLY.map((name) => ({
            name,
            label: name,
            description: `the add-on’s ${name}`,
          })),
        },
      ],
    });
    try {
      for (const name of GRAPHE_ONLY) {
        expect(built.descriptionOf(name)).toBe(`Graphe’s own ${name}`);
        expect(built.active).toContain(name);
      }
    } finally {
      built.dispose();
    }
  }, 30_000);
});
