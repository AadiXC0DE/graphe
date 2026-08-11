/** The Guard's policy engine.
 *
 * Pi has no permission system by design (notes/strategy/ARCHITECTURE.md, decision 3), and
 * our users cannot judge whether a command is dangerous. Every tool call the
 * model wants to make passes through `evaluate` before anything runs.
 *
 * `evaluate` is a pure, synchronous function of its two arguments. No disk, no
 * network, no clock, no module state. That matters for three reasons: it can be
 * exhaustively tested, it cannot itself be the thing that breaks mid-operation,
 * and the same call always gets the same answer no matter what the model said
 * around it. Prompt injection (S-20, S-21) is defeated mechanically rather than
 * by persuasion, because nothing the model writes is an input here.
 *
 * ## Deny-by-default
 *
 * The single most important rule in this file: **when we cannot confidently work
 * out what something does, the answer is `confirm` or `deny`, never `allow`.**
 * Shell is an unbounded language and we are not writing a shell. Every unknown
 * command, every unparsed quote, every substitution we cannot see through falls
 * through to a question or a refusal. The cost of being wrong in that direction
 * is one extra question. The cost of being wrong in the other direction is a
 * designer's project, and there is a shipped product incident behind that
 * sentence: Replit's agent wiped a production database during a code freeze,
 * with no way back.
 *
 * ## Why confirmations are rare
 *
 * Confirmation fatigue is what created "Accept All" (research/03 §7). Reading,
 * searching and editing a project file are silent, so the questions that do
 * appear are rare enough to be read rather than dismissed. There is deliberately
 * no "pre-approved" or "always allow" field on `GuardFacts`: a `confirm` cannot
 * be switched off, by the user or by the model.
 */

import type { GuardContext, ToolCall, Verdict } from '../types';
import {
  containsPath,
  isCredentialPath,
  isProjectRoot,
  shipsToBrowser,
  toPosix,
} from './paths';

/**
 * Optional facts the app can hand the Guard on top of the project folder.
 *
 * All optional, so a plain `GuardContext` is still a valid argument and
 * `src/agent/types.ts` stays untouched. These exist because two Tier 1 cases
 * cannot be answered from the tool call alone: S-02 needs the standing "ask me
 * first" instruction to live outside the conversation, and S-05 needs a row
 * count to say "this deletes the 1,240 rows in it" instead of something vague.
 */
export type GuardFacts = GuardContext & {
  /**
   * The user said something like "don't change anything without asking".
   * Stored by the app, outside the chat transcript, for the whole session, so
   * that a later turn cannot talk the model out of remembering it. While it is
   * on, every change asks first. This is the exact Replit failure (S-02).
   */
  askBeforeEveryChange?: boolean;
  /** Rows currently in each table, so a confirmation can name a real number. */
  rowCounts?: Readonly<Record<string, number>>;
  /** The user's real secret values, so we can spot one being pasted somewhere public. */
  knownSecretValues?: readonly string[];
};

/** Five files changed at once stops being an edit and starts being a sweep. */
const MASS_CHANGE_FILES = 5;

type Judgement = {
  verdict: Verdict;
  /** Save a restore point before running this, whatever the user answers. */
  snapshot: boolean;
  /** Does this change anything at all? Reads are exempt from "ask me first". */
  mutates: boolean;
};

const STRICTNESS: Record<Verdict['kind'], number> = {
  allow: 0,
  'snapshot-first': 1,
  confirm: 2,
  deny: 3,
};

function allow(mutates = false): Judgement {
  return { verdict: { kind: 'allow' }, snapshot: false, mutates };
}

function deny(reason: string): Judgement {
  return { verdict: { kind: 'deny', reason }, snapshot: false, mutates: false };
}

function snapshotFirst(reason: string): Judgement {
  return { verdict: { kind: 'snapshot-first', reason }, snapshot: true, mutates: true };
}

function ask(
  question: string,
  detail: string,
  consequence: string,
  options: { snapshot?: boolean; mutates?: boolean } = {},
): Judgement {
  return {
    verdict: { kind: 'confirm', question, detail, consequence },
    snapshot: options.snapshot ?? false,
    mutates: options.mutates ?? true,
  };
}

/** Combine two judgements: the stricter verdict wins, and any reason to take a
 *  restore point survives. That is how a call ends up both confirmed *and*
 *  snapshotted, which is what S-01 and S-05 require. */
function strictest(a: Judgement, b: Judgement): Judgement {
  const winner = STRICTNESS[b.verdict.kind] > STRICTNESS[a.verdict.kind] ? b : a;
  return {
    verdict: winner.verdict,
    snapshot: a.snapshot || b.snapshot,
    mutates: a.mutates || b.mutates,
  };
}

/* -------------------------------------------------------------------------- */
/* What the user reads                                                         */
/* -------------------------------------------------------------------------- */

/** Plain language only. No word from the retired list in research/03: no commit,
 *  push, repo, deploy, terminal, migration, rollback, stack trace. Nothing here
 *  ever echoes a raw command back either, so a key inside one cannot leak into
 *  the activity feed (S-13). The app still has the full tool call for its
 *  subordinated "technical details" view. */
const SAY = {
  outsideProject:
    "This would reach a file outside your project folder, and I only work inside your project. I've stopped it.",
  wipe:
    "This would delete a whole folder and everything inside it, with nothing left to bring back. I've stopped it.",
  wipeDisk:
    "This would erase the drive your work is stored on. I've stopped it.",
  credentials:
    "This would open a file that holds your keys and passwords. I never read those. I've stopped it.",
  environment:
    "This would list the private keys your project runs with. I never read those. I've stopped it.",
  downloadAndRun:
    "This would fetch a program from the internet and run it straight away, with neither of us seeing what is inside it. I've stopped it.",
  unreadable:
    "I could not work out what this would actually do, so I did not run it. Tell me what you want in your own words and I will do it a way we can both see.",
  fullControl:
    "This asks for control of your whole computer, not just your project. I've stopped it.",
  remoteControl:
    "This would open a connection that lets another machine run things here. I've stopped it.",
  guardOff:
    "This would switch off the checks that keep your project safe. Those stay on. I've stopped it.",
  deleteProject:
    "This would delete your entire project folder. I've stopped it.",
  keyInBrowserFile:
    "This would put a private key into a file that gets sent to everyone who opens your site, so anyone could copy it and run up charges on your account. I've stopped it. Save it as a project secret and I will read it from there.",
  sendKeyOut:
    "This would send one of your private keys out to another website. I've stopped it.",
  restorePoint: 'I will save a restore point first, so you can put this back the way it was.',
} as const;

/* -------------------------------------------------------------------------- */
/* Tool names                                                                  */
/* -------------------------------------------------------------------------- */

/** These three sets meet at one branch in `judgeCall` and all come out `allow()`.
 *  Three rather than one so a name sits with what it resembles, in case the
 *  branches ever part company. A read left out of them falls to the
 *  deny-by-default floor and starts asking permission, which is how `find`
 *  behaved until it was listed here. */
const READ_TOOLS = new Set(['read', 'readfile', 'view', 'viewfile', 'open', 'openfile', 'cat']);
/** Pi's `find` is `glob` under another name: it runs `fd` and returns file names
 *  without opening any of them. The shell command of the same word is a
 *  different program entirely — see `judgeFind`. */
const LIST_TOOLS = new Set(['list', 'listfiles', 'listdir', 'ls', 'glob', 'tree', 'find']);
const SEARCH_TOOLS = new Set(['search', 'grep', 'ripgrep', 'findfiles', 'codebasesearch']);
const WRITE_TOOLS = new Set([
  'write',
  'writefile',
  'createfile',
  'create',
  'edit',
  'editfile',
  'strreplace',
  'strreplaceeditor',
  'applypatch',
  'multiedit',
  'replace',
  'insert',
  'append',
  'mkdir',
  'move',
  'rename',
  'copy',
]);
const DELETE_TOOLS = new Set(['delete', 'deletefile', 'remove', 'removefile', 'rm', 'rmdir', 'trash']);
const SHELL_TOOLS = new Set(['bash', 'shell', 'sh', 'terminal', 'exec', 'execute', 'runcommand', 'command', 'run']);
const SQL_TOOLS = new Set(['sql', 'query', 'dbquery', 'runsql', 'executesql', 'database', 'db', 'migrate']);
const NETWORK_TOOLS = new Set(['fetch', 'http', 'httprequest', 'request', 'webfetch', 'download', 'upload', 'post', 'apicall']);
/** Search engines. Their whole job is sending words out and bringing the
 *  answer back, so the question is always about reaching the internet and
 *  never about anything on this machine. */
const WEB_TOOLS = new Set(['websearch', 'searchweb', 'googlesearch', 'ddgsearch', 'websearchlite']);
/** Delegating a piece of work to a helper agent. Graphe's own helper is
 *  read-only and cannot ask questions, but the model should not start helpers
 *  without the person knowing — this is the one tool that spends money on
 *  another context window. */
const TASK_TOOLS = new Set(['task', 'subagent', 'delegate', 'handoff']);
const PUBLISH_TOOLS = new Set(['deploy', 'publish', 'release', 'ship']);
const SESSION_EXPORT_TOOLS = new Set(['export', 'exportsession', 'share', 'sharesession', 'sendlog', 'uploadlogs']);
/** Our own design tools. Read-only by construction, so they stay silent. */
const DESIGN_READ_TOOLS = new Set([
  'figmaread',
  'readfigma',
  'figmafile',
  'screenshot',
  'visualdiff',
  'extracttokens',
  'getdesigntokens',
  'listroutes',
  'inspectelement',
]);
/** Anything that sounds like it is reaching for the Guard's own switches. */
const GUARD_SWITCH = /(permission|policy|guard|approval|approve|allowlist|whitelist|yolo|autorun|bypass|unsafe|disablesafety)/;

/* -------------------------------------------------------------------------- */
/* Shell commands                                                              */
/* -------------------------------------------------------------------------- */

const ELEVATION = new Set(['sudo', 'sudoedit', 'su', 'doas', 'runas', 'pkexec']);

/** Interpreters that will run whatever text they are handed. */
const INTERPRETERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'csh',
  'fish',
  'node',
  'deno',
  'bun',
  'python',
  'python2',
  'python3',
  'perl',
  'ruby',
  'php',
  'osascript',
  'powershell',
  'pwsh',
  'cmd',
]);

const INLINE_CODE_FLAGS = new Set(['-c', '-e', '--eval', '-E', '--command', '-p', '--exec']);

const DOWNLOADERS = new Set(['curl', 'wget', 'fetch', 'aria2c', 'httpie', 'http']);

/** Erases storage rather than files. None of these has a use in a design project. */
const DISK_TOOLS = new Set([
  'dd',
  'shred',
  'srm',
  'wipefs',
  'fdisk',
  'parted',
  'diskutil',
  'hdparm',
  'format',
  'newfs',
]);

const DECODERS = new Set(['base64', 'xxd', 'uudecode', 'openssl', 'basenc', 'b64decode']);

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx', 'pip', 'pip3', 'brew', 'gem', 'cargo', 'composer', 'apt', 'apt-get', 'yum', 'dnf', 'pacman']);
const PACKAGE_INSTALL_VERBS = new Set(['install', 'i', 'add', 'ci', 'create', 'dlx', 'exec', 'uninstall', 'remove', 'rm', 'un', 'update', 'upgrade', 'link']);

const PUBLISH_CLIS = new Set(['vercel', 'netlify', 'wrangler', 'gh', 'firebase', 'surge', 'aws', 'gcloud', 'heroku', 'flyctl', 'fly', 'railway', 'docker', 'kubectl', 'terraform']);

const DATABASE_CLIS = new Set(['psql', 'mysql', 'sqlite3', 'mongo', 'mongosh', 'redis-cli', 'prisma', 'drizzle-kit', 'supabase', 'sequelize', 'knex']);

/** Reading, looking, counting. Nothing here changes a file. */
const READ_ONLY_COMMANDS = new Set([
  'ls',
  'pwd',
  'cat',
  'bat',
  'head',
  'tail',
  'wc',
  'echo',
  'printf',
  'grep',
  'rg',
  'ag',
  'ack',
  'fd',
  'file',
  'stat',
  'du',
  'df',
  'tree',
  'sort',
  'uniq',
  'cut',
  'diff',
  'basename',
  'dirname',
  'date',
  'which',
  'whoami',
  'hostname',
  'uname',
  'jq',
  'column',
  'less',
  'more',
  'nl',
  'realpath',
  'true',
  'sleep',
]);

/** Creates something, changes nothing that existed. */
const HARMLESS_WRITE_COMMANDS = new Set(['mkdir', 'touch']);

/** Never useful here, and each one is a known way to lose a machine. */
const ALWAYS_DENY_COMMANDS = new Set([
  'ssh',
  'scp',
  'sftp',
  'telnet',
  'nc',
  'netcat',
  'ncat',
  'socat',
  'crontab',
  'at',
  'launchctl',
  'systemctl',
  'systemsetup',
  'networksetup',
  'defaults',
  'softwareupdate',
  'csrutil',
  'spctl',
  'osascript',
  'eval',
  'source',
  'exec',
  'env',
  'printenv',
  'export',
  'set',
  'history',
  'mount',
  'umount',
  'chroot',
  'nvram',
]);

/** Scripts we know the shape of, because we wrote the project. */
const KNOWN_SCRIPTS = new Set(['build', 'dev', 'start', 'test', 'lint', 'format', 'typecheck', 'check', 'preview', 'shot']);
/** Local tools the build loop leans on constantly. Confirming these would be noise. */
const LOCAL_DEV_BINARIES = new Set(['vitest', 'jest', 'tsc', 'eslint', 'prettier', 'vite', 'playwright', 'tsx', 'esbuild']);

/* -------------------------------------------------------------------------- */
/* Secrets                                                                     */
/* -------------------------------------------------------------------------- */

const SECRET_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'sign-in key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: 'payment key', pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { name: 'storage key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'code hosting key', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'maps key', pattern: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: 'chat key', pattern: /\bxox[abopsr]-[A-Za-z0-9-]{10,}/ },
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'sign-in ticket', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/ },
  { name: 'full-access database key', pattern: /\bservice_role\b/ },
  {
    name: 'key',
    pattern: /\b(?:api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key|private[_-]?key)\b\s*[:=]\s*['"`][^'"`\s]{12,}['"`]/i,
  },
];

/** Names whose value is sent to the browser on purpose. A real key in one of
 *  these is the "public-prefixed variable" case in S-11. */
const PUBLIC_NAME =
  /\b(?:NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_|GATSBY_|EXPO_PUBLIC_|NUXT_PUBLIC_)([A-Z0-9_]*)\s*[:=]\s*['"`]?([^\s'"`,;]+)/g;
/** Names that are never safe in the browser, whatever the value looks like. */
const NEVER_PUBLIC_NAME = /(SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|_PWD)/;

function findSecret(text: string): string | null {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

function findPublicSecret(text: string): string | null {
  PUBLIC_NAME.lastIndex = 0;
  let match = PUBLIC_NAME.exec(text);
  while (match !== null) {
    const name = match[1] ?? '';
    const value = match[2] ?? '';
    if (NEVER_PUBLIC_NAME.test(name)) return 'key';
    const secret = findSecret(value);
    if (secret !== null) return secret;
    match = PUBLIC_NAME.exec(text);
  }
  return null;
}

function findKnownSecret(text: string, ctx: GuardFacts): boolean {
  const known = ctx.knownSecretValues ?? [];
  return known.some((value) => value.length >= 8 && text.includes(value));
}

/* -------------------------------------------------------------------------- */
/* Reading a tool call's input                                                 */
/* -------------------------------------------------------------------------- */

const PATH_KEYS = [
  'path',
  'file',
  'file_path',
  'filePath',
  'filename',
  'fileName',
  'target',
  'targetFile',
  'dir',
  'directory',
  'folder',
  'destination',
  'dest',
  'source',
  'src',
  'to',
  'from',
  'cwd',
  'old_path',
  'new_path',
];
const PATH_LIST_KEYS = ['paths', 'files', 'targets', 'sources'];
const CONTENT_KEYS = [
  'content',
  'contents',
  'text',
  'body',
  'data',
  'new_string',
  'newString',
  'new_str',
  'newText',
  'replacement',
  'patch',
  'diff',
  'value',
  'code',
  'file_text',
  'fileText',
];
const COMMAND_KEYS = ['command', 'cmd', 'script', 'commandLine', 'input'];
const SQL_KEYS = ['sql', 'query', 'statement', 'statements'];
const URL_KEYS = ['url', 'uri', 'endpoint', 'href'];

function readString(input: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

/** A location field that is present but blank is not the same as one that was
 *  never given. The first is something we could not make sense of, and gets
 *  refused; the second means the project folder, which is fine. */
function collectPaths(input: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === 'string') found.push(value);
  }
  for (const key of PATH_LIST_KEYS) {
    const value = input[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === 'string') found.push(entry);
      else if (entry !== null && typeof entry === 'object') {
        const nested = collectPaths(entry as Record<string, unknown>);
        found.push(...nested);
      }
    }
  }
  return found;
}

function countChangeTargets(input: Record<string, unknown>): number {
  let count = 0;
  for (const key of [...PATH_LIST_KEYS, 'edits', 'changes', 'operations', 'replacements']) {
    const value = input[key];
    if (Array.isArray(value)) count += value.length;
  }
  return count;
}

/** Everything in the input that could carry a key, flattened to one string. */
function collectText(input: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 4) return;
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const entry of Object.values(value)) walk(entry, depth + 1);
    }
  };
  for (const key of CONTENT_KEYS) walk(input[key], 0);
  return parts.join('\n');
}

/** Keys that name the payload a tool actually ships elsewhere. `query` asks the
 *  web, `task` briefs the helper — a key hiding in either travels exactly as
 *  far as one hiding in file contents, so both are worth the same look. */
const OUTGOING_KEYS = ['query', 'question', 'q', 'task', 'instructions', 'prompt', 'description', 'message'];

function payloadText(input: Record<string, unknown>): string {
  const payload = readString(input, OUTGOING_KEYS);
  const collected = collectText(input);
  if (payload === null || payload === '') return collected;
  return collected === '' ? payload : `${collected}\n${payload}`;
}

/* -------------------------------------------------------------------------- */
/* Shell parsing                                                               */
/* -------------------------------------------------------------------------- */

type Token = { text: string };

type Parse =
  | {
      ok: true;
      segments: Token[][];
      /** A `$VAR` the shell would swap out. We cannot see the result, so we do not run it. */
      expansion: boolean;
      /** A `$(...)` or backtick: a command hidden inside a command. */
      substitution: boolean;
      /** A subshell. Same problem. */
      grouping: boolean;
    }
  | { ok: false };

/**
 * A small, deliberately unambitious shell reader.
 *
 * It is not a shell. It removes quoting and escaping so that `rm -r'f' x` and
 * `r\m -rf x` both arrive as the tokens a policy check can reason about, splits
 * on the operators that chain commands together, and raises a hand the moment it
 * meets something it cannot account for. Everything it raises a hand about ends
 * up denied, which is the whole point: an unreadable command is a refused one.
 */
function parseCommand(command: string): Parse {
  const segments: Token[][] = [];
  let tokens: Token[] = [];
  let current = '';
  let started = false;
  let expansion = false;
  let substitution = false;
  let grouping = false;

  const endToken = (): void => {
    if (started) {
      tokens.push({ text: current });
      current = '';
      started = false;
    }
  };
  const endSegment = (): void => {
    endToken();
    if (tokens.length > 0) {
      segments.push(tokens);
      tokens = [];
    }
  };

  for (let index = 0; index < command.length; index++) {
    const character = command[index] ?? '';

    if (character === '\\') {
      const next = command[index + 1];
      if (next === undefined) break;
      index += 1;
      if (next === '\n') continue;
      current += next;
      started = true;
      continue;
    }

    if (character === "'") {
      const end = command.indexOf("'", index + 1);
      if (end === -1) return { ok: false };
      current += command.slice(index + 1, end);
      started = true;
      index = end;
      continue;
    }

    if (character === '"') {
      let cursor = index + 1;
      let closed = false;
      while (cursor < command.length) {
        const inner = command[cursor] ?? '';
        if (inner === '\\') {
          const next = command[cursor + 1];
          if (next !== undefined) {
            current += next;
            cursor += 2;
            continue;
          }
          cursor += 1;
          continue;
        }
        if (inner === '"') {
          closed = true;
          break;
        }
        if (inner === '$') {
          expansion = true;
          if (command[cursor + 1] === '(') substitution = true;
        }
        if (inner === '`') substitution = true;
        current += inner;
        cursor += 1;
      }
      if (!closed) return { ok: false };
      started = true;
      index = cursor;
      continue;
    }

    if (character === '$') {
      expansion = true;
      if (command[index + 1] === '(') substitution = true;
      current += character;
      started = true;
      continue;
    }

    if (character === '`') {
      substitution = true;
      current += character;
      started = true;
      continue;
    }

    if (character === '(' || character === ')') {
      grouping = true;
      endToken();
      continue;
    }

    if (character === ';' || character === '\n' || character === '&' || character === '|') {
      endSegment();
      const next = command[index + 1];
      if ((character === '&' || character === '|') && next === character) index += 1;
      continue;
    }

    if (character === '>' || character === '<') {
      endToken();
      let operator = character;
      if (character === '>' && command[index + 1] === '>') {
        operator = '>>';
        index += 1;
      }
      tokens.push({ text: operator });
      continue;
    }

    if (character === ' ' || character === '\t' || character === '\r') {
      endToken();
      continue;
    }

    current += character;
    started = true;
  }

  endSegment();
  return { ok: true, segments, expansion, substitution, grouping };
}

function baseName(command: string): string {
  const posix = toPosix(command);
  const parts = posix.split('/');
  return (parts[parts.length - 1] ?? posix).toLowerCase();
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Flags in any order and any spelling: `-rf`, `-fr`, `-r -f`, `--recursive --force`. */
function flagsOf(tokens: Token[]): Set<string> {
  const flags = new Set<string>();
  for (const token of tokens) {
    const text = token.text;
    if (text === '--' || !text.startsWith('-') || text.length < 2) continue;
    if (text.startsWith('--')) {
      flags.add(text.slice(2).split('=')[0]?.toLowerCase() ?? '');
      continue;
    }
    for (const letter of text.slice(1)) flags.add(letter);
  }
  return flags;
}

function hasFlag(flags: Set<string>, ...names: string[]): boolean {
  return names.some((name) => flags.has(name));
}

function isRedirect(text: string): boolean {
  return text === '>' || text === '>>' || text === '<';
}

/** Devices that swallow output harmlessly. Everything else under /dev is storage. */
const SAFE_DEVICES = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty', '/dev/zero']);

function looksLikeLocation(text: string): boolean {
  if (text === '') return false;
  if (text.includes('://')) return false;
  if (text.startsWith('-')) return false;
  return (
    text.includes('/') ||
    text.includes('\\') ||
    text.startsWith('.') ||
    text.startsWith('~') ||
    /^[A-Za-z]:/.test(text)
  );
}

/** Every location a command mentions has to stay inside the project. */
function judgeSegmentPaths(tokens: Token[], ctx: GuardFacts): Judgement {
  let judgement = allow();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) continue;
    const previous = tokens[index - 1];
    const isWriteTarget = previous !== undefined && (previous.text === '>' || previous.text === '>>');
    if (isRedirect(token.text)) continue;

    let text = token.text;
    if (text.startsWith('-')) {
      const equals = text.indexOf('=');
      if (equals === -1) continue;
      text = text.slice(equals + 1);
    }
    if (text.includes('://')) continue;
    if (SAFE_DEVICES.has(text)) continue;
    if (text.startsWith('/dev/')) return deny(SAY.wipeDisk);
    if (!looksLikeLocation(text) && !isCredentialPath(text)) continue;

    const check = containsPath(ctx.projectRoot, text);
    if (!check.inside) return deny(check.reason ?? SAY.outsideProject);
    if (check.resolved !== null && isCredentialPath(check.resolved)) return deny(SAY.credentials);
    if (isWriteTarget) {
      judgement = strictest(judgement, snapshotFirst('Writing over a file in your project.'));
    }
  }
  return judgement;
}

/* -------------------------------------------------------------------------- */
/* Command-by-command                                                          */
/* -------------------------------------------------------------------------- */

const UNKNOWN_COMMAND = (): Judgement =>
  ask(
    'Run an instruction I do not fully recognise?',
    "I can see roughly what it is meant to do, but not well enough to promise it is safe. You can see the exact wording under technical details.",
    'If you are not sure, say no and tell me in your own words what you want instead.',
  );

function judgeRemove(tokens: Token[]): Judgement {
  const flags = flagsOf(tokens);
  const recursive = hasFlag(flags, 'r', 'R', 'recursive');
  const force = hasFlag(flags, 'f', 'force');
  // The one rule with no exceptions: a recursive forced delete never runs (S-03).
  if (recursive && force) return deny(SAY.wipe);
  if (recursive) return snapshotFirst('Deleting a folder and everything in it.');
  return snapshotFirst('Deleting files from your project.');
}

/** The shell's `find`, which is not the tool called `find`. This one runs what
 *  it is handed on everything it meets, which is how `find . -delete` empties a
 *  project (S-03). Nothing joins the two paths: this is keyed on the first word
 *  of a parsed command line and never reads the tool-name sets, so listing a
 *  word up there cannot loosen anything down here. */
function judgeFind(tokens: Token[]): Judgement {
  const texts = tokens.map((token) => token.text);
  if (texts.includes('-delete')) return deny(SAY.wipe);
  if (texts.some((text) => text === '-exec' || text === '-execdir' || text === '-ok' || text === '-okdir')) {
    if (texts.some((text) => baseName(text) === 'rm')) return deny(SAY.wipe);
    return ask(
      'Run the same instruction over every file it finds?',
      'This applies one change to a whole set of files at once.',
      `Some of those files may not be ones you expected. ${SAY.restorePoint}`,
      { snapshot: true },
    );
  }
  return allow();
}

function judgeGit(tokens: Token[]): Judgement {
  const sub = (tokens[1]?.text ?? '').toLowerCase();
  const texts = tokens.map((token) => token.text.toLowerCase());

  if (['status', 'log', 'diff', 'show', 'branch', 'remote', 'rev-parse', 'ls-files', 'blame'].includes(sub)) {
    return allow();
  }
  if (sub === 'add' || sub === 'commit' || sub === 'stash' || sub === 'switch' || sub === 'init') {
    return allow(true);
  }
  if (sub === 'push') {
    const forced = texts.includes('--force') || texts.includes('-f') || texts.includes('--force-with-lease');
    if (forced) {
      return ask(
        'Replace the online copy of your project with this one?',
        'Anything saved online that is not in this version would be written over.',
        'If someone else has saved work there, it would be lost.',
        { snapshot: true },
      );
    }
    return ask(
      'Send your saved work to the online copy of your project?',
      'This makes your latest saves visible to anyone with access to that copy.',
      'Nothing on your own machine changes.',
    );
  }
  if (['reset', 'restore', 'checkout', 'clean', 'revert'].includes(sub)) {
    return snapshotFirst('Putting files back to an earlier state, which drops anything unsaved.');
  }
  if (['filter-branch', 'gc', 'reflog', 'update-ref', 'prune'].includes(sub)) {
    return deny(
      "This would erase your project's saved history, including versions you might want to go back to. I've stopped it.",
    );
  }
  return UNKNOWN_COMMAND();
}

function judgePackageManager(tokens: Token[]): Judgement {
  const name = baseName(tokens[0]?.text ?? '');
  const verb = (tokens[1]?.text ?? '').toLowerCase();
  const args = tokens.slice(2).filter((token) => !token.text.startsWith('-'));

  if (name === 'npx' || name === 'pnpx' || name === 'bunx') {
    const binary = baseName(tokens[1]?.text ?? '');
    if (LOCAL_DEV_BINARIES.has(binary)) return allow(true);
    return ask(
      `Fetch and run "${tokens[1]?.text ?? 'a tool'}"?`,
      'This downloads a tool from the internet and runs it against your project right away.',
      'It can read and change any file in your project while it runs.',
      { snapshot: true },
    );
  }

  if (verb === 'run' || verb === 'run-script') {
    const script = (tokens[2]?.text ?? '').toLowerCase();
    if (KNOWN_SCRIPTS.has(script)) return allow(true);
    return UNKNOWN_COMMAND();
  }
  if (['test', 'build', 'start', 'lint'].includes(verb)) return allow(true);

  if (verb === 'publish') {
    return ask(
      'Share this project publicly, for anyone to download?',
      'It goes up under this name and cannot be fully taken back afterwards.',
      'Everything currently in the folder goes with it, so check nothing private is in there.',
    );
  }

  if (PACKAGE_INSTALL_VERBS.has(verb)) {
    const what = args[0]?.text;
    const removing = verb === 'uninstall' || verb === 'remove' || verb === 'rm' || verb === 'un';
    if (removing) {
      return ask(
        what === undefined ? 'Take building blocks out of your project?' : `Take "${what}" out of your project?`,
        'Anything in your project that relies on it would stop working until it is put back.',
        SAY.restorePoint,
        { snapshot: true },
      );
    }
    return ask(
      what === undefined ? 'Add new building blocks to your project?' : `Add "${what}" to your project?`,
      'This comes from the internet, and pieces like this are allowed to run their own setup steps the moment they arrive.',
      'That setup can read and change files in your project, so only say yes to names you recognise.',
      { snapshot: true },
    );
  }
  return UNKNOWN_COMMAND();
}

function judgeDatabaseCli(tokens: Token[], ctx: GuardFacts): Judgement {
  const texts = tokens.map((token) => token.text.toLowerCase());
  if (texts.includes('reset') || texts.some((text) => text.includes('force-reset'))) {
    return ask(
      'Empty your project data and start it over?',
      'Every table goes back to being blank.',
      `Everything currently stored in them is deleted. ${SAY.restorePoint}`,
      { snapshot: true },
    );
  }
  const statement = tokens.find((token) => /\b(select|insert|update|delete|drop|alter|truncate|create|grant)\b/i.test(token.text));
  if (statement !== undefined) return judgeSql(statement.text, ctx);
  return ask(
    'Let me work directly on your stored data?',
    'This reaches your saved information rather than the look of your site.',
    `Changes to stored information are the hardest kind to undo. ${SAY.restorePoint}`,
    { snapshot: true },
  );
}

/** Commands whose real job is to run another command. `xargs rm -rf` has to be
 *  judged as `rm -rf`, not as a friendly-looking `xargs`. */
const WRAPPER_COMMANDS = new Set(['xargs', 'time', 'nohup', 'nice', 'timeout', 'watch', 'command', 'builtin', 'stdbuf']);

function judgeShellSegment(tokens: Token[], ctx: GuardFacts, depth = 0): Judgement {
  const meaningful = tokens.filter((token) => !ASSIGNMENT.test(token.text));
  const first = meaningful[0];
  if (first === undefined) return allow();

  const name = baseName(first.text);

  if (WRAPPER_COMMANDS.has(name)) {
    if (depth >= 3) return deny(SAY.unreadable);
    // Drop only the wrapper's own options, never the wrapped command's. Getting
    // this wrong turns `xargs rm -rf` into a harmless-looking `rm`.
    const rest = meaningful.slice(1);
    let start = 0;
    while (start < rest.length) {
      const text = rest[start]?.text ?? '';
      if (!text.startsWith('-') && !/^\d+[smhd]?$/.test(text)) break;
      start += 1;
    }
    const inner = rest.slice(start);
    if (inner.length === 0) return UNKNOWN_COMMAND();
    return judgeShellSegment(inner, ctx, depth + 1);
  }
  const flags = flagsOf(meaningful);
  const paths = judgeSegmentPaths(meaningful, ctx);
  const decide = (judgement: Judgement): Judgement => strictest(paths, judgement);

  if (ELEVATION.has(name)) return deny(SAY.fullControl);
  if (ALWAYS_DENY_COMMANDS.has(name)) {
    if (name === 'env' || name === 'printenv' || name === 'export' || name === 'set') {
      return deny(SAY.environment);
    }
    if (name === 'ssh' || name === 'scp' || name === 'sftp' || name === 'telnet') {
      return deny(SAY.remoteControl);
    }
    return deny(SAY.unreadable);
  }
  if (DISK_TOOLS.has(name) || name.startsWith('mkfs')) return deny(SAY.wipeDisk);
  if (DECODERS.has(name)) {
    const decoding = hasFlag(flags, 'd', 'D', 'decode', 'r') || meaningful.some((token) => token.text === 'enc');
    if (decoding) return deny(SAY.unreadable);
    return decide(UNKNOWN_COMMAND());
  }
  if (INTERPRETERS.has(name)) {
    const inline = meaningful.some((token) => INLINE_CODE_FLAGS.has(token.text));
    if (inline) return deny(SAY.unreadable);
    return decide(
      ask(
        'Run a small program inside your project?',
        'It can read and change any file in your project while it runs.',
        `If you did not ask for this, say no. ${SAY.restorePoint}`,
        { snapshot: true },
      ),
    );
  }
  if (name === 'rm' || name === 'rmdir') return decide(judgeRemove(meaningful));
  if (name === 'find') return decide(judgeFind(meaningful));
  if (name === 'git') return decide(judgeGit(meaningful));
  if (PACKAGE_MANAGERS.has(name)) return decide(judgePackageManager(meaningful));
  if (DATABASE_CLIS.has(name)) return decide(judgeDatabaseCli(meaningful, ctx));
  if (DOWNLOADERS.has(name)) {
    return decide(
      ask(
        'Let me reach out to the internet?',
        'This sends a request to another website and brings back whatever it answers with.',
        'What comes back is not something I can check beforehand.',
        { mutates: false },
      ),
    );
  }
  if (PUBLISH_CLIS.has(name)) {
    return decide(
      ask(
        'Publish your project so it is live on the internet?',
        'Anyone with the link would be able to see it.',
        'You can take it down again afterwards.',
      ),
    );
  }
  if (name === 'ln') {
    return decide(
      ask(
        'Create a shortcut to another folder?',
        'Shortcuts let work in one place quietly change files somewhere else.',
        'I keep everything inside your project folder unless you say otherwise.',
      ),
    );
  }
  if (name === 'chmod' || name === 'chown') {
    const recursive = hasFlag(flags, 'r', 'R', 'recursive');
    const wideOpen = meaningful.some((token) => /^[0-7]?777$/.test(token.text) || token.text.includes('o+w'));
    if (recursive && wideOpen) {
      return deny(
        "This would let any program on your computer change these files. I've stopped it.",
      );
    }
    return decide(
      ask(
        'Change who is allowed to open these files?',
        'This decides which programs on your computer can read and change them.',
        'Opening this up more than needed is hard to notice later.',
      ),
    );
  }
  if (name === 'sed' || name === 'awk' || name === 'perl') {
    if (hasFlag(flags, 'i', 'in-place')) {
      return decide(snapshotFirst('Changing the contents of files in place.'));
    }
    return decide(allow());
  }
  if (name === 'mv' || name === 'cp' || name === 'rsync' || name === 'install') {
    if (name === 'rsync' && meaningful.some((token) => token.text === '--delete')) {
      return deny(SAY.wipe);
    }
    return decide(snapshotFirst('Moving or writing over files in your project.'));
  }
  if (HARMLESS_WRITE_COMMANDS.has(name)) return decide(allow(true));
  if (name === 'kill' || name === 'killall' || name === 'pkill' || name === 'open' || name === 'ps') {
    return decide(UNKNOWN_COMMAND());
  }
  if (READ_ONLY_COMMANDS.has(name)) return decide(allow());

  // Deny-by-default lands here: an unrecognised command is never silent.
  return decide(UNKNOWN_COMMAND());
}

/** Was somebody trying to hide a destructive verb from us? Runs over the raw
 *  text, before any parsing, so it catches shapes the reader would choke on. */
function looksObfuscated(command: string): boolean {
  // A function that calls itself forever, the classic one-line way to freeze a machine.
  if (/[\w:]*\(\)\s*\{[^}]*[|&]/.test(command)) return true;
  // Text being reassembled character by character to dodge a word match.
  if (/\\x[0-9a-f]{2}\\x[0-9a-f]{2}/i.test(command)) return true;
  if (/\$\{[^}]*[:#%/][^}]*\}/.test(command)) return true;
  return false;
}

/** Words worth naming plainly even when the rest of the command is unreadable. */
const DESTRUCTIVE_WORDS = /\b(rm|rmdir|shred|mkfs|dd|unlink|del|drop|truncate|destroy)\b/i;

function redirectTargets(segments: Token[][]): string[] {
  const targets: string[] = [];
  for (const segment of segments) {
    for (let index = 0; index < segment.length; index++) {
      const token = segment[index];
      if (token === undefined) continue;
      if (token.text !== '>' && token.text !== '>>') continue;
      const target = segment[index + 1];
      if (target !== undefined) targets.push(target.text);
    }
  }
  return targets;
}

function judgeShellCommand(command: string, ctx: GuardFacts): Judgement {
  if (command.trim() === '') return UNKNOWN_COMMAND();
  const hidingSomethingDestructive = DESTRUCTIVE_WORDS.test(command);
  if (looksObfuscated(command)) {
    return deny(hidingSomethingDestructive ? SAY.wipe : SAY.unreadable);
  }

  const parsed = parseCommand(command);
  // Quotes that never close, brackets that never balance: we do not guess.
  if (!parsed.ok) return deny(hidingSomethingDestructive ? SAY.wipe : SAY.unreadable);
  // `$(...)`, backticks and subshells are a command hidden inside a command.
  // `rm -$FLAGS "$TARGET"` reads as harmless and is not. If we cannot see the
  // final command, we do not run the command.
  if (parsed.substitution || parsed.grouping || parsed.expansion) {
    return deny(hidingSomethingDestructive ? SAY.wipe : SAY.unreadable);
  }

  const names = parsed.segments.map((segment) => {
    const meaningful = segment.filter((token) => !ASSIGNMENT.test(token.text));
    return baseName(meaningful[0]?.text ?? '');
  });
  const downloads = names.some((name) => DOWNLOADERS.has(name));
  const interprets = names.some((name) => INTERPRETERS.has(name) || DECODERS.has(name));
  if (downloads && interprets) return deny(SAY.downloadAndRun);
  // `echo <something> | sh` and `printf ... | bash` hand an interpreter a script
  // we never get to look at. Anything downstream of a pipe that can run code is
  // refused on sight.
  const fedByPipe = names.some((name, index) => index > 0 && INTERPRETERS.has(name));
  if (fedByPipe) return deny(hidingSomethingDestructive ? SAY.wipe : SAY.unreadable);

  let judgement = allow();
  for (const segment of parsed.segments) {
    judgement = strictest(judgement, judgeShellSegment(segment, ctx));
  }

  const secret = findSecret(command) ?? (findKnownSecret(command, ctx) ? 'key' : null);
  if (secret !== null) {
    const toBrowser = redirectTargets(parsed.segments).some((target) => shipsToBrowser(target));
    if (toBrowser) {
      judgement = strictest(judgement, deny(SAY.keyInBrowserFile));
    } else if (command.includes('://') || downloads) {
      judgement = strictest(judgement, deny(SAY.sendKeyOut));
    } else {
      judgement = strictest(
        judgement,
        ask(
          'Use one of your private keys here?',
          'Keys typed straight into an instruction can end up saved in places you would not expect.',
          'Saving it as a project secret keeps it out of your files and out of what you share.',
        ),
      );
    }
  }
  return judgement;
}

/* -------------------------------------------------------------------------- */
/* Stored data                                                                 */
/* -------------------------------------------------------------------------- */

function cleanIdentifier(raw: string): string {
  const bare = raw.replace(/["`[\]]/g, '');
  const parts = bare.split('.');
  return parts[parts.length - 1] ?? bare;
}

function rowsIn(table: string, ctx: GuardFacts): number | null {
  const counts = ctx.rowCounts;
  if (counts === undefined) return null;
  const direct = counts[table];
  if (typeof direct === 'number') return direct;
  const bare = cleanIdentifier(table);
  const fallback = counts[bare];
  return typeof fallback === 'number' ? fallback : null;
}

function rowPhrase(table: string, ctx: GuardFacts): string {
  const rows = rowsIn(table, ctx);
  if (rows === null) return 'everything stored in it';
  if (rows === 1) return 'the 1 row in it';
  return `the ${rows.toLocaleString('en-US')} rows in it`;
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const WRITES_DATA = /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|REPLACE|MERGE|COPY|VACUUM)\b/i;
const READS_ONLY = /^\s*(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE|DESC|TABLE)\b/i;

function judgeStatement(statement: string, ctx: GuardFacts): Judgement {
  const sql = stripSqlComments(statement);
  if (sql === '') return allow();

  const opensToEveryone =
    /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(sql) ||
    /\bGRANT\b[\s\S]*\bTO\s+(PUBLIC|anon|authenticated)\b/i.test(sql) ||
    /\bUSING\s*\(\s*true\s*\)/i.test(sql);
  if (opensToEveryone) {
    return ask(
      'Let anyone on the internet read and change this information?',
      'Right now only you can see it. This would remove that.',
      'Anyone who finds your site could read every name, address and message you have stored, and change them.',
      { snapshot: true },
    );
  }

  const dropTable = /\bDROP\s+(TABLE|DATABASE|SCHEMA)\s+(?:IF\s+EXISTS\s+)?([\w."`[\]]+)/i.exec(sql);
  if (dropTable !== null) {
    const table = cleanIdentifier(dropTable[2] ?? '');
    return ask(
      `Delete "${table}" and everything in it?`,
      `This removes the whole ${table} table from your project.`,
      `It deletes ${rowPhrase(table, ctx)}. ${SAY.restorePoint}`,
      { snapshot: true },
    );
  }

  const dropColumn = /\bALTER\s+TABLE\s+([\w."`[\]]+)\s+DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?([\w."`[\]]+)/i.exec(sql);
  if (dropColumn !== null) {
    const table = cleanIdentifier(dropColumn[1] ?? '');
    const column = cleanIdentifier(dropColumn[2] ?? '');
    return ask(
      `Delete the "${column}" information from "${table}"?`,
      `Every entry in ${table} would lose its ${column}.`,
      `This deletes the ${column} column and ${rowPhrase(table, ctx)}. ${SAY.restorePoint}`,
      { snapshot: true },
    );
  }

  const truncate = /\bTRUNCATE\s+(?:TABLE\s+)?([\w."`[\]]+)/i.exec(sql);
  if (truncate !== null) {
    const table = cleanIdentifier(truncate[1] ?? '');
    return ask(
      `Empty "${table}"?`,
      `The ${table} table stays, but everything saved in it goes.`,
      `That is ${rowPhrase(table, ctx)}. ${SAY.restorePoint}`,
      { snapshot: true },
    );
  }

  const remove = /\bDELETE\s+FROM\s+([\w."`[\]]+)/i.exec(sql);
  if (remove !== null) {
    const table = cleanIdentifier(remove[1] ?? '');
    const everything = !/\bWHERE\b/i.test(sql);
    return ask(
      everything ? `Delete everything in "${table}"?` : `Delete some entries from "${table}"?`,
      everything
        ? `Nothing in ${table} is being kept back.`
        : `Only the entries that match are removed from ${table}.`,
      everything
        ? `That is ${rowPhrase(table, ctx)}. ${SAY.restorePoint}`
        : `Deleted entries do not come back on their own. ${SAY.restorePoint}`,
      { snapshot: true },
    );
  }

  const update = /\bUPDATE\s+([\w."`[\]]+)\s+SET\b/i.exec(sql);
  if (update !== null) {
    const table = cleanIdentifier(update[1] ?? '');
    const everything = !/\bWHERE\b/i.test(sql);
    return ask(
      everything ? `Change every entry in "${table}"?` : `Change some entries in "${table}"?`,
      everything ? `This writes over ${rowPhrase(table, ctx)}.` : `Only matching entries change.`,
      `The old values are not kept. ${SAY.restorePoint}`,
      { snapshot: true },
    );
  }

  if (WRITES_DATA.test(sql)) {
    return ask(
      'Change how your information is stored?',
      'This changes the shape of your saved information, not just how the site looks.',
      `Changes to stored information are the hardest kind to undo. ${SAY.restorePoint}`,
      { snapshot: true },
    );
  }

  if (READS_ONLY.test(sql)) return allow();
  return UNKNOWN_COMMAND();
}

function judgeSql(sql: string, ctx: GuardFacts): Judgement {
  const statements = stripSqlComments(sql)
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
  if (statements.length === 0) return UNKNOWN_COMMAND();
  let judgement = allow();
  for (const statement of statements) {
    judgement = strictest(judgement, judgeStatement(statement, ctx));
  }
  return judgement;
}

/* -------------------------------------------------------------------------- */
/* Files                                                                       */
/* -------------------------------------------------------------------------- */

function judgeWrittenText(text: string, targets: string[], ctx: GuardFacts): Judgement {
  if (text === '') return allow(true);

  const publicSecret = findPublicSecret(text);
  if (publicSecret !== null) return deny(SAY.keyInBrowserFile);

  const secret = findSecret(text);
  const known = findKnownSecret(text, ctx);
  if (secret === null && !known) return allow(true);

  const reachesBrowser = targets.some((target) => shipsToBrowser(target));
  if (reachesBrowser) return deny(SAY.keyInBrowserFile);

  return ask(
    'Save a private key inside a project file?',
    'Keys kept in ordinary files travel with the project, including anywhere it gets copied or shared.',
    'I can hold it as a project secret instead, where it stays out of your files and out of anything you share.',
  );
}

function judgeFileTargets(
  call: ToolCall,
  ctx: GuardFacts,
  base: Judgement,
): Judgement {
  const paths = collectPaths(call.input);
  if (paths.length === 0) {
    return strictest(base, UNKNOWN_COMMAND());
  }
  let judgement = base;
  const resolved: string[] = [];
  for (const path of paths) {
    const check = containsPath(ctx.projectRoot, path);
    if (!check.inside) return deny(check.reason ?? SAY.outsideProject);
    if (check.resolved !== null) resolved.push(check.resolved);
  }
  for (const path of resolved) {
    if (isCredentialPath(path)) {
      judgement = strictest(
        judgement,
        ask(
          'Save this as a project secret?',
          'Keys and passwords live in one protected place, not in ordinary project files.',
          'Kept there, they never show up in what you share or publish.',
        ),
      );
    }
  }
  const targets = Math.max(paths.length, countChangeTargets(call.input));
  if (targets >= MASS_CHANGE_FILES) {
    judgement = strictest(
      judgement,
      snapshotFirst(`Changing ${targets} files in one go.`),
    );
  }
  const text = collectText(call.input);
  if (text !== '') {
    judgement = strictest(judgement, judgeWrittenText(text, resolved, ctx));
  }
  return judgement;
}

/* -------------------------------------------------------------------------- */
/* The entry point                                                             */
/* -------------------------------------------------------------------------- */

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function judgeCall(call: ToolCall, ctx: GuardFacts): Judgement {
  const name = normalizeToolName(call.name);
  const input = call.input ?? {};

  // Nothing gets to turn the Guard off, however politely it asks.
  if (GUARD_SWITCH.test(name)) return deny(SAY.guardOff);

  if (SHELL_TOOLS.has(name)) {
    // A command's relative locations are only safe if the folder it starts from
    // is. `cwd: '../..'` would quietly move the whole command out of the project.
    for (const key of ['cwd', 'dir', 'directory', 'workingDirectory', 'working_dir']) {
      const where = input[key];
      if (typeof where !== 'string') continue;
      const check = containsPath(ctx.projectRoot, where);
      if (!check.inside) return deny(check.reason ?? SAY.outsideProject);
    }
    const command = readString(input, COMMAND_KEYS);
    if (command === null) return UNKNOWN_COMMAND();
    return judgeShellCommand(command, ctx);
  }

  if (SQL_TOOLS.has(name)) {
    const sql = readString(input, SQL_KEYS) ?? readString(input, CONTENT_KEYS);
    if (sql === null) return UNKNOWN_COMMAND();
    return judgeSql(sql, ctx);
  }

  if (READ_TOOLS.has(name) || LIST_TOOLS.has(name) || SEARCH_TOOLS.has(name)) {
    // "Read" pointed at a web address is not a read of the project at all.
    const address = readString(input, URL_KEYS);
    if (address !== null && address.includes('://')) {
      return ask(
        'Let me look something up on the internet?',
        'This asks another website for information and brings back its answer.',
        'What comes back is not something I can check beforehand.',
        { mutates: false },
      );
    }
    // No location given means the project folder, which is always fine to read.
    for (const path of collectPaths(input)) {
      const check = containsPath(ctx.projectRoot, path);
      if (!check.inside) return deny(check.reason ?? SAY.outsideProject);
      if (check.resolved !== null && isCredentialPath(check.resolved)) return deny(SAY.credentials);
    }
    return allow();
  }

  if (DELETE_TOOLS.has(name)) {
    const paths = collectPaths(input);
    if (paths.length === 0) return UNKNOWN_COMMAND();
    for (const path of paths) {
      if (isProjectRoot(ctx.projectRoot, path)) return deny(SAY.deleteProject);
      const check = containsPath(ctx.projectRoot, path);
      if (!check.inside) return deny(check.reason ?? SAY.outsideProject);
    }
    const targets = Math.max(paths.length, countChangeTargets(input));
    return snapshotFirst(
      targets >= MASS_CHANGE_FILES
        ? `Deleting ${targets} files from your project.`
        : 'Deleting files from your project.',
    );
  }

  if (WRITE_TOOLS.has(name)) {
    return judgeFileTargets(call, ctx, allow(true));
  }

  if (NETWORK_TOOLS.has(name)) {
    const url = readString(input, URL_KEYS) ?? '';
    const text = collectText(input);
    if (findSecret(text) !== null || findKnownSecret(text, ctx) || findKnownSecret(url, ctx)) {
      return deny(SAY.sendKeyOut);
    }
    const sending = text !== '' || /\b(post|put|patch|delete)\b/i.test(readString(input, ['method']) ?? '');
    return ask(
      sending ? 'Send this out to another website?' : 'Let me look something up on the internet?',
      sending
        ? 'Once it leaves your machine, you cannot take it back.'
        : 'This asks another website for information and brings back its answer.',
      sending
        ? 'Only send things you are happy for that website to keep.'
        : 'What comes back is not something I can check beforehand.',
      { mutates: sending },
    );
  }

  if (WEB_TOOLS.has(name)) {
    const where = readString(input, ['cwd', 'dir', 'directory', 'workingDirectory']);
    if (where !== null) {
      const check = containsPath(ctx.projectRoot, where);
      if (!check.inside) return deny(check.reason ?? SAY.outsideProject);
    }
    // The whole point of the tool is sending words out. A key in the question
    // is a key sent to a stranger.
    const outbound = payloadText(input);
    if (findSecret(outbound) !== null || findKnownSecret(outbound, ctx)) return deny(SAY.sendKeyOut);
    return ask(
      'Look something up on the internet?',
      'I will send your question to a search provider and bring back what it finds.',
      'The question itself is sent out, so keep keys and private details out of it.',
      { mutates: false },
    );
  }

  if (TASK_TOOLS.has(name)) {
    const where = readString(input, ['cwd', 'dir', 'directory', 'workingDirectory']);
    if (where !== null) {
      const check = containsPath(ctx.projectRoot, where);
      if (!check.inside) return deny(check.reason ?? SAY.outsideProject);
    }
    // The task text travels to a fresh process and, through it, maybe the web.
    const outbound = payloadText(input);
    if (findSecret(outbound) !== null || findKnownSecret(outbound, ctx)) return deny(SAY.sendKeyOut);
    return ask(
      'Send a piece of work to a helper?',
      'I start a fresh helper with its own clean memory. It can read the project and search the web, and it cannot change anything.',
      'It costs a little more, and its findings come back to this conversation.',
      { mutates: false },
    );
  }

  if (PUBLISH_TOOLS.has(name)) {
    const text = collectText(input);
    if (findPublicSecret(text) !== null) return deny(SAY.keyInBrowserFile);
    return ask(
      'Publish your project so it is live on the internet?',
      'Anyone with the link would be able to see it.',
      'I check first that none of your keys are in anything the browser can read.',
    );
  }

  if (SESSION_EXPORT_TOOLS.has(name)) {
    const text = `${collectText(input)}\n${JSON.stringify(input)}`;
    if (findSecret(text) !== null || findKnownSecret(text, ctx)) {
      return deny(
        "This copy of your session still has one of your private keys in it. I've stopped it. I can share it with the keys taken out instead.",
      );
    }
    return ask(
      'Share a copy of this session?',
      'It includes what you asked for and what I did about it.',
      'Your keys and passwords are taken out before it leaves your machine.',
      { mutates: false },
    );
  }

  if (DESIGN_READ_TOOLS.has(name)) return allow();

  // An unfamiliar tool is never silent. This is the deny-by-default floor.
  return UNKNOWN_COMMAND();
}

/**
 * A standing "ask me first" instruction outranks anything decided above.
 *
 * The user said it once, out loud, and the app stored it outside the
 * conversation. It holds for the whole session, and no later turn, and no
 * amount of model confidence, relaxes it. This is the exact failure behind the
 * Replit incident: a code freeze the agent talked itself past.
 */
function applyStandingInstruction(judgement: Judgement, ctx: GuardFacts): Judgement {
  if (ctx.askBeforeEveryChange !== true) return judgement;
  if (!judgement.mutates) return judgement;
  if (judgement.verdict.kind === 'deny' || judgement.verdict.kind === 'confirm') return judgement;
  return {
    verdict: {
      kind: 'confirm',
      question: 'Go ahead with this change?',
      detail: 'You asked me to check with you before changing anything, so I am checking.',
      consequence:
        judgement.verdict.kind === 'snapshot-first'
          ? `${judgement.verdict.reason} ${SAY.restorePoint}`
          : 'This changes files in your project.',
    },
    snapshot: judgement.snapshot,
    mutates: true,
  };
}

function judge(call: ToolCall, ctx: GuardFacts): Judgement {
  return applyStandingInstruction(judgeCall(call, ctx), ctx);
}

/**
 * Decide what happens to one tool call.
 *
 * Pure and synchronous. Given the same call and the same context it always
 * returns the same verdict, and it never reads anything the model wrote *about*
 * the call: extra fields such as `approved: true` or a reassuring `reason` are
 * simply not consulted. That is what makes the Guard proof against a file, a
 * Figma comment or a dependency telling the model to ignore its instructions.
 */
export function evaluate(call: ToolCall, ctx: GuardFacts): Verdict {
  return judge(call, ctx).verdict;
}

/**
 * Should a restore point be saved before this runs?
 *
 * Separate from the verdict on purpose. A destructive change needs *both* a
 * restore point and a question (S-01, S-05), and `Verdict` can only carry one
 * of the two. The runtime calls this before executing anything the user has
 * approved, so approval never costs the user their way back.
 */
export function requiresSnapshot(call: ToolCall, ctx: GuardFacts): boolean {
  return judge(call, ctx).snapshot;
}

/**
 * Does this call change anything? Reads and searches do not, so they stay
 * silent even while a standing "ask me first" instruction is in force.
 */
export function changesAnything(call: ToolCall, ctx: GuardFacts): boolean {
  return judge(call, ctx).mutates;
}
