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
 * ## One agent, one folder
 *
 * `projectRoot` is not always the project on screen. When work is given its own
 * copy to make a mess in, that copy is the root this agent is judged against,
 * and the folder somebody is looking at is *outside* it like anywhere else on
 * the disk. Which means the escapes worth worrying about are the ones that never
 * look like a path: pointing the history tool at another copy, handing it a
 * setting on the way in, or stepping into another folder first. Anything of that
 * shape is refused rather than reasoned about — if we cannot say where a command
 * will write, it does not run.
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
import type { PathCheck } from './paths';
import {
  containsPath,
  isAgentFolder,
  isCredentialPath,
  isHistoryStore,
  isProjectRoot,
  isSignInStore,
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
/**
 * How far the agent may go before it stops and asks.
 *
 * A ladder rather than a switch. The first three rungs are ceilings on what
 * happens without a question. The final rung is deliberately different: it is
 * explicit full-computer access for the current sitting, equivalent to the
 * "dangerously skip permissions" modes in other coding agents. It removes the
 * Guard's project boundary as well as its questions and restore-point work.
 */
export type HowFar =
  /** Reads and reports. Anything that would change something is turned down. */
  | 'looking'
  /** Stops before anything risky and waits. The one it has always been. */
  | 'asking'
  /** Changes files without asking; still stops before running a command or
   *  reaching the internet. */
  | 'changing'
  /** Runs things too, with the person's full computer access for this sitting.
   *  This deliberately bypasses the Guard and its project boundary. */
  | 'doing';

export type GuardFacts = GuardContext & {
  /**
   * The user said something like "don't change anything without asking".
   * Stored by the app, outside the chat transcript, for the whole session, so
   * that a later turn cannot talk the model out of remembering it. While it is
   * on, every change asks first. This is the exact Replit failure (S-02).
   */
  askBeforeEveryChange?: boolean;
  /**
   * The user turned the questions off for this sitting.
   *
   * It stops the Guard *asking*. It does not stop the Guard: a denial is still
   * a denial — wiping a disk, reaching outside the project, reading somebody's
   * keys — and every restore point that would have been taken is still taken.
   * So the worst this can cost is one undo, which is the only version of this
   * switch worth shipping.
   *
   * Outranked by `askBeforeEveryChange`: that one was said out loud, about this
   * project, and a switch in a toolbar does not get to overrule it.
   */
  stopAsking?: boolean;
  /**
   * How far it may go on its own. Four rungs rather than a switch, because
   * "check with me" and "get on with it" are not the only two things anybody
   * ever wants — and because the difference between changing a file and running
   * a command is exactly the difference people care about.
   *
   * Left off, it is `asking`, which is what the app has always done.
   */
  howFar?: HowFar;
  /**
   * Where the agent's own skills, extensions and packages live.
   *
   * Those sit outside the project and have to be readable anyway: a feature
   * somebody installed cannot work if the thing it is made of is refused. Left
   * out, the usual folder is still recognised by its shape, so a caller that
   * never mentions it reads its own instructions too. Reading only — the agent
   * does not get to rewrite what it runs on.
   */
  agentFolder?: string;
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
  keyIntoPage:
    "This would type one of your private keys into the page you have open, and that page can keep it and pass it anywhere. I've stopped it. Save it as a project secret and I will read it from there.",
  notAWebAddress:
    "That is not a page on the web — it would open something on this computer in the browser and read it into our conversation. I've stopped it. Ask me to read the file instead and I will.",
  elsewhere:
    "This would work on another copy of your project instead of the one I'm in, and I can't tell what it would change over there. I've stopped it.",
  pointedElsewhere:
    'This would quietly point the work at somewhere else on your computer before it even starts. I\'ve stopped it.',
  wanderingOff:
    "This would step out of the folder I'm working in before doing anything else, so I couldn't tell where the rest of it would land. I've stopped it.",
  historyStore:
    "This reaches into the private record your project's history is kept in, which nothing should be writing to by hand. I've stopped it.",
  historyRules:
    "This would change the rules your project's history runs by, and those rules can quietly run things later on. I've stopped it.",
  ownInstructions:
    "This would rewrite the instructions I work from. I can read those, and I leave them exactly as you installed them. I've stopped it.",
  restorePoint: 'I will commit a checkpoint first, so this is one restore away.',
} as const;

/* -------------------------------------------------------------------------- */
/* Tool names                                                                  */
/* -------------------------------------------------------------------------- */

/** These three sets meet at one branch in `judgeCall` and all come out `allow()`.
 *  Three rather than one so a name sits with what it resembles, in case the
 *  branches ever part company. A read left out of them falls to the
 *  deny-by-default floor and starts asking permission, which is how `find`
 *  behaved until it was listed here. */
/* `readmap` and `runchecks` read the project and say what they found — a map of
   the folders, and the project's own standards read against a change. Both were
   falling through to the unknown-command question, so every review opened with
   "run an instruction I do not fully recognise?" about our own tool. */
/** The tool that stops to ask a person something before the work starts. */
const ASKING_TOOLS = new Set(['askfirst']);

const READ_TOOLS = new Set([
  'read', 'readfile', 'view', 'viewfile', 'open', 'openfile', 'cat', 'readdiff', 'readmap', 'runchecks',
]);
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
/** Anything that runs a command somebody typed. `keeprunning` starts one that
 *  stays up rather than one that finishes, which changes how long it lasts and
 *  nothing at all about what it is allowed to be. */
const SHELL_TOOLS = new Set([
  'bash',
  'shell',
  'sh',
  'terminal',
  'exec',
  'execute',
  'runcommand',
  'command',
  'run',
  'keeprunning',
]);

/** Asking after something already agreed to, and ending it. Neither runs
 *  anything new, and a stop is the one action nobody should have to ask for.
 *  `cancelbuild` is ours: taking the build checklist off the screen when the
 *  person says so — like `readmap` and `runchecks`, leaving it out meant the
 *  exact moment somebody said "cancel the todo list" opened with the
 *  unknown-command question about our own tool. */
const RUNNING_TOOLS = new Set(['running', 'stoprunning', 'cancelbuild']);

/** Our own bookkeeping, on screen rather than on disk: ticking one thing off
 *  the checklist somebody is watching, and choosing between answers already in
 *  hand. Neither reads a file, runs anything or reaches anywhere — and a
 *  question about either is a question in the middle of every turn. */
const OUR_OWN_TOOLS = new Set(['stepdone', 'scorecandidates']);
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

/** The project's own memory. It writes only to the app's own data folder — a
 *  note beside the conversation, never a file in the project — so it is silent
 *  like any read: the whole point of a memory is that it is written without
 *  ceremony. */
const MEMORY_TOOLS = new Set(['retain', 'remember', 'recall', 'reflect', 'memoryedit', 'memory', 'forget', 'updatenote', 'update']);
const PUBLISH_TOOLS = new Set(['deploy', 'publish', 'release', 'ship']);
const SESSION_EXPORT_TOOLS = new Set(['export', 'exportsession', 'share', 'sharesession', 'sendlog', 'uploadlogs']);
/** Our own design tools. Read-only by construction, so they stay silent.
 *
 *  The second group is the reading half of the tools somebody's other design
 *  work brings with it. Naming them is not a relaxation: a connection the user
 *  added deliberately would otherwise ask permission on every single read, and
 *  a question asked forty times is a question nobody reads by the fortieth.
 *  Only the reading half is here — anything that writes stays unknown, and
 *  unknown still asks. */
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
  'getdesigncontext',
  'getscreenshot',
  'getmetadata',
  'getvariabledefs',
  'getcodeconnectmap',
  'getfigjam',
  'searchdesignsystem',
  'getlibraries',
  'browsersnapshot',
  'browserconsolemessages',
]);

/** The reading half of a code-reading tool, on the same terms as the design
 *  reads above: somebody connected it deliberately, and a model asks these
 *  dozens of times to answer one question. Nothing here writes — a rename or a
 *  fix is not in this set, so it stays unknown, and unknown still asks. */
const CODE_READ_TOOLS = new Set([
  'getdefinition',
  'gettypedefinition',
  'getreferences',
  'getimplementations',
  'getcallhierarchy',
  'gettypehierarchy',
  'gethover',
  'getsignature',
  'getcompletions',
  'getsymbols',
  'getworkspacesymbols',
  'getoutline',
  'getimports',
  'getdiagnostics',
  'getalldiagnostics',
  'getmoduledependencies',
  'getcodefixes',
  'renamepreview',
  'analyzeposition',
  'batchanalyze',
  'calculatemetrics',
  'detectduplication',
  'findindirectionhotspots',
  'qualityreport',
]);
/**
 * Reading the page beside the conversation.
 *
 * Allowed, on the same terms as the design reads above and for a stronger
 * reason: the page is already loaded, already on screen, and already the
 * person's own. Nothing here sends a request, changes a pixel or touches a
 * file — it looks at what is in front of both of us. A question on every
 * reading would be a question during every glance at a page a model needs to
 * read a dozen times to fix one row of navigation.
 *
 * What it does do is bring the page's own words into the conversation, and a
 * page can say anything. That is the same footing as a fetched page or a file
 * in the project, and it is answered the same way: nothing the model reads is
 * an input to this file, so what a page says cannot change what is allowed.
 */
const PAGE_READ_TOOLS = new Set(['pageread', 'pagetrouble', 'pagepicture']);

/**
 * Scrolling that page.
 *
 * Not a read, and still silent. It moves what is in view and changes nothing
 * else: no data, no request anybody asked for, nothing that outlives scrolling
 * back. Reading a long page is many scrolls, and a question asked once per
 * screenful is the exact shape of the fatigue that created "Accept All".
 */
const PAGE_MOVE_TOOLS = new Set(['pagescroll']);

/**
 * Pressing and typing on that page.
 *
 * These always ask. The page is somebody's live site, not a copy: a press can
 * send an order, empty a basket or delete an account, and typing can put words
 * in front of a stranger. None of it is a file, so none of it is anything a
 * restore point can put back — which is exactly why the question is the whole
 * of the protection here, and why no rung of the ladder below `doing` is
 * allowed to skip it.
 */
const PAGE_ACT_TOOLS = new Set(['pageclick', 'pagetype']);

/**
 * Looking at the browser the work drives.
 *
 * A browser of its own is not the page beside the conversation, and the
 * difference matters in one direction only: getting it to a site is a reach out
 * to the internet and asks below, while looking at a page it is already on
 * changes nothing at all. Reading it, scrolling it, taking its picture, reading
 * what it complained about — none of that sends a request anybody has not
 * already agreed to, and a question per glance is a question during every look
 * at a page that takes a dozen looks to work through.
 *
 * Closing it is here for the reason a stop always is: nobody should have to ask
 * permission to put something down.
 */
const BROWSER_LOOK_TOOLS = new Set([
  'browserread',
  'browserpicture',
  'browsertrouble',
  'browsertrace',
  'browserscroll',
  'browserclose',
]);

/** Pointing that browser at an address. This is the moment the machine reaches
 *  out, and it is the moment worth naming — after it, a page is a page. */
const BROWSER_REACH_TOOLS = new Set(['browseropen']);

/** Pressing and typing in that browser. The same footing as the page beside the
 *  conversation and a longer reach: this one keeps logins, so a press can order
 *  something under somebody's own name. */
const BROWSER_ACT_TOOLS = new Set(['browserclick', 'browsertype']);

/** A run of steps in that browser, judged as the strictest step in it. Named
 *  here so every place that asks "is this one of ours" agrees. */
const BROWSER_STEPS = 'browsersteps';

/**
 * Looking at this computer's own screen.
 *
 * What is open is a list of names and nothing more, so it is silent. A picture
 * is not: the screen has everything else on it — somebody's mail, somebody's
 * messages, a password left showing — and the person sitting in front of it is
 * the one who decides that goes into a conversation.
 */
const DESKTOP_LOOK_TOOLS = new Set(['desktopapps', 'desktopread']);
const DESKTOP_PICTURE_TOOLS = new Set(['desktoppicture']);

/** Working this computer: pressing, typing, dragging, opening a program. None
 *  of it is a file, so none of it is anything a restore point can put back —
 *  which is why the question is the whole of the protection here. */
const DESKTOP_ACT_TOOLS = new Set(['desktopdo', 'desktopopen']);

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

/** The interpreters whose inline text we can actually read, because it is the
 *  same language this file already reads. Handed a script, they are judged as
 *  that script — which is stricter than the ask a script *file* gets, since we
 *  never see inside the file. Everything else in `INTERPRETERS` runs a language
 *  we cannot parse, and unreadable stays refused. */
const READABLE_INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

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
/** Verbs that mean "go and get somebody else's code". Any runtime that grew a
 *  package manager uses one of these words for it. */
const FETCHES_CODE = new Set(['add', 'install', 'i', 'get', 'fetch', 'upgrade', 'update']);

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

export function findSecret(text: string): string | null {
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
  // A run of moves on this computer carries its words under `keys` as well as
  // `text`. A field the secret scan cannot see is a field it cannot refuse.
  'keys',
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

/** Every string inside a value, however it is nested. Used where a tool's
 *  payload is a free-form bag rather than a named field. */
function asText(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  } catch {
    // Circular, or something that will not serialise. Nothing readable in it.
    return '';
  }
}

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
      /** For each segment, whether a `|` handed it the one before it. Only a
       *  real pipe counts: `&&`, `;` and `&` run a command, they do not feed it. */
      piped: boolean[];
      /** A `$VAR` the shell would swap out. We cannot see the result, so we do not run it. */
      expansion: boolean;
      /** A `$(...)` or backtick: a command hidden inside a command. */
      substitution: boolean;
      /** Plain `( … )`. Every word inside one is still right there to be read,
       *  so this is recorded rather than refused — unlike a substitution, which
       *  runs whatever its own output turns out to say. */
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
  const piped: boolean[] = [];
  let tokens: Token[] = [];
  let current = '';
  let started = false;
  let expansion = false;
  let substitution = false;
  let grouping = false;
  /** Whether the separator just read was a pipe, and so whether whatever comes
   *  next is being handed the output of what came before. */
  let fed = false;

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
      piped.push(fed);
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
      let feeds = false;
      if (character === '|') {
        // `||` is a choice between two commands. `|` and `|&` hand the first
        // one's output to the second, which is the only case that matters.
        if (next === '|') index += 1;
        else {
          if (next === '&') index += 1;
          feeds = true;
        }
      } else if (character === '&' && next === '&') {
        index += 1;
      }
      fed = feeds;
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
  return { ok: true, segments, piped, expansion, substitution, grouping };
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

/** A real web address, which is not a location on this computer. Anchored: a
 *  shell reads `../../out://x` as an ordinary relative path. */
const WEB_ADDRESS = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Devices that swallow output harmlessly. Everything else under /dev is storage. */
const SAFE_DEVICES = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty', '/dev/zero']);

function looksLikeLocation(text: string): boolean {
  if (text === '') return false;
  // A web address is not a location on this computer. Anchored, because a
  // shell reads `../../out://x` as an ordinary relative path and only the
  // start of a word can be a scheme.
  if (WEB_ADDRESS.test(text)) return false;
  if (text.startsWith('-')) return false;
  return (
    text.includes('/') ||
    text.includes('\\') ||
    text.startsWith('.') ||
    text.startsWith('~') ||
    /^[A-Za-z]:/.test(text)
  );
}

/**
 * The agent's own skills, extensions and packages: what it was installed with,
 * rather than anything of the user's.
 *
 * Reading these is the agent reading its own instructions, so it is allowed
 * however careful the settings are — a feature that was installed and then
 * silently does nothing is worse than a question. Only reading: the sign-ins
 * kept alongside them are not instructions, and neither is anybody's key.
 */
function readsOwnFolder(resolved: string | null, ctx: GuardFacts): boolean {
  if (resolved === null) return false;
  if (!isAgentFolder(resolved, ctx.agentFolder)) return false;
  return !isSignInStore(resolved) && !isCredentialPath(resolved) && !isHistoryStore(resolved);
}

/** Outside the project, in more than one way. Something we would have read
 *  happily, and something that holds keys, each deserve their own sentence
 *  rather than the one about the project folder. */
function refuseOutside(check: PathCheck, ctx: GuardFacts): Judgement {
  const resolved = check.resolved;
  if (resolved !== null && isAgentFolder(resolved, ctx.agentFolder)) {
    if (readsOwnFolder(resolved, ctx)) return deny(SAY.ownInstructions);
    if (isSignInStore(resolved) || isCredentialPath(resolved)) return deny(SAY.credentials);
  }
  return deny(check.reason ?? SAY.outsideProject);
}

/** Every location a command mentions has to stay inside the project, or be
 *  something the agent is only reading out of its own folder. */
function judgeSegmentPaths(tokens: Token[], ctx: GuardFacts, reading = false): Judgement {
  let judgement = allow();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) continue;
    const previous = tokens[index - 1];
    const isWriteTarget = previous !== undefined && (previous.text === '>' || previous.text === '>>');
    if (isRedirect(token.text)) continue;

    // Every way one word can carry a location. A word was checked only as
    // itself, so two ordinary spellings walked straight out of the project:
    // `sort -o../../out.txt`, where the option and its value are one word, and
    // anything holding `://`, which was taken for a web address when a shell
    // reads it as a folder called `x:`.
    for (const text of locationsIn(token.text)) {
      if (SAFE_DEVICES.has(text)) continue;
      if (text.startsWith('/dev/')) return deny(SAY.wipeDisk);
      if (!looksLikeLocation(text) && !isCredentialPath(text)) continue;

      const check = containsPath(ctx.projectRoot, text);
      if (!check.inside) {
        if (reading && !isWriteTarget && readsOwnFolder(check.resolved, ctx)) continue;
        return refuseOutside(check, ctx);
      }
      if (check.resolved !== null && isCredentialPath(check.resolved)) return deny(SAY.credentials);
      if (isHistoryStore(text)) return deny(SAY.historyStore);
      if (isWriteTarget) {
        judgement = strictest(judgement, snapshotFirst('Writing over a file in your project.'));
      }
    }
  }
  return judgement;
}

/**
 * Every location one word could be.
 *
 * Usually itself. An option carrying its value in the same word is the case
 * that matters — `-o../../out.txt`, `--exclude=../secrets` — because the value
 * is a location and the word is not, so checking the word alone found nothing
 * to refuse.
 */
function locationsIn(word: string): string[] {
  if (WEB_ADDRESS.test(word)) return [];
  if (!word.startsWith('-')) return [word];

  const found: string[] = [];
  const equals = word.indexOf('=');
  if (equals !== -1) found.push(word.slice(equals + 1));
  // `-o../../out.txt`: the dashes, then the option's letters, then the value.
  const attached = /^-{1,2}[A-Za-z]*(.+)$/.exec(word);
  if (attached?.[1] !== undefined) found.push(attached[1]);
  return found.filter((one) => one !== '' && !WEB_ADDRESS.test(one));
}

/* -------------------------------------------------------------------------- */
/* Command-by-command                                                          */
/* -------------------------------------------------------------------------- */

const UNKNOWN_COMMAND = (): Judgement =>
  ask(
    'Run an instruction I do not fully recognise?',
    'I can see roughly what it is meant to do, but not well enough to promise it is safe.',
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

/** The handful of options before a subcommand that cannot move anything: they
 *  change what gets printed and nothing else. Everything else in that position
 *  aims the tool at another copy, another record or another configuration, and
 *  none of it can be traced from the line alone. */
const HARMLESS_GIT_OPTIONS = new Set(['--no-pager', '--paginate', '--no-optional-locks', '--version', '--help']);

/** Verbs that only look. Every one of these is a read on the online copy. */
const GH_READS = new Set(['list', 'view', 'diff', 'status', 'checks']);

/** Anything on an `api` call that turns a look into a change. */
const GH_API_WRITES = new Set(['-x', '--method', '-f', '--field', '-F', '--raw-field', '--input']);

/**
 * `gh`, which is two different commands wearing one name.
 *
 * Reading what is on the online copy — the list of open work, one item, its
 * change — alters nothing and used to be met with "Publish your project so it
 * is live on the internet?", a question about something else entirely that a
 * person had to answer three or four times to read one page.
 */
function judgeGh(tokens: Token[]): Judgement {
  const texts = tokens.map((token) => token.text.toLowerCase());
  const words = texts.slice(1).filter((text) => !text.startsWith('-'));
  const group = words[0] ?? '';
  const verb = words[1] ?? '';

  if (group === 'api') {
    // A plain `api` call is a GET. A method or a field on it is a write, and
    // which one is not ours to guess.
    const writes = texts.some((text) => GH_API_WRITES.has(text) || text.startsWith('--method='));
    if (!writes) return allow();
  } else if (GH_READS.has(verb) || (group === 'repo' && verb === 'view')) {
    return allow();
  }

  return ask(
    'Put this on the online copy of your project?',
    'This writes to where your project lives online, where other people can see it.',
    'Nothing on your own machine changes.',
  );
}

function judgeGit(tokens: Token[]): Judgement {
  // Options come before the subcommand or they do not count, which is exactly
  // where `-C`, `--git-dir`, `--work-tree` and an inline `-c` setting sit.
  let at = 1;
  while (at < tokens.length && (tokens[at]?.text ?? '').startsWith('-')) {
    if (!HARMLESS_GIT_OPTIONS.has((tokens[at]?.text ?? '').toLowerCase())) return deny(SAY.elsewhere);
    at += 1;
  }
  const sub = (tokens[at]?.text ?? '').toLowerCase();
  const texts = tokens.map((token) => token.text.toLowerCase());

  // Making, moving or removing another copy of the project is ours to do, and
  // only ever from outside the copy the work is happening in.
  if (sub === 'worktree') return deny(SAY.elsewhere);
  if (sub === 'config') return deny(SAY.historyRules);

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

/** Names set in front of a command that move where it reads and writes: another
 *  history, another home, another set of programs. `GIT_DIR=… git save` is the
 *  whole reason this list exists — it reads as an ordinary save and is not one. */
const REDIRECTING_NAMES = new Set([
  'home',
  'path',
  'shell',
  'editor',
  'visual',
  'pager',
  'cdpath',
  'ifs',
  'env',
  'bash_env',
  'zdotdir',
  'tmpdir',
  'prefix',
  'manpath',
  'rubyopt',
  'node_options',
  'node_path',
  'node_extra_ca_certs',
]);
const REDIRECTING_PREFIXES = ['git_', 'xdg_', 'ld_', 'dyld_', 'npm_config_', 'yarn_', 'pnpm_', 'bun_', 'python', 'perl5'];

function redirectsWork(name: string): boolean {
  const lower = name.toLowerCase();
  return REDIRECTING_NAMES.has(lower) || REDIRECTING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Only a run of them at the very front is a setting; a `key=value` anywhere
 *  later is an argument, and the shell reads it the same way. */
function leadingAssignments(tokens: Token[]): Token[] {
  let at = 0;
  while (at < tokens.length && ASSIGNMENT.test(tokens[at]?.text ?? '')) at += 1;
  return tokens.slice(0, at);
}

function judgeAssignments(assignments: Token[], ctx: GuardFacts): Judgement {
  let judgement = allow();
  for (const token of assignments) {
    const split = token.text.indexOf('=');
    const name = token.text.slice(0, split);
    const value = token.text.slice(split + 1);
    if (redirectsWork(name)) return deny(SAY.pointedElsewhere);
    if (looksLikeLocation(value)) {
      const check = containsPath(ctx.projectRoot, value);
      if (!check.inside) return deny(check.reason ?? SAY.outsideProject);
    }
    // One we do not know the meaning of is not one we can promise anything about.
    judgement = strictest(judgement, UNKNOWN_COMMAND());
  }
  return judgement;
}

/** Stepping into another folder is safe only when we can see which one. A folder
 *  inside this one keeps every later location inside it too, because everything
 *  relative resolves deeper from there; anything else, or nothing at all, is the
 *  shell quietly going somewhere of its own choosing. */
function judgeCd(tokens: Token[], ctx: GuardFacts): Judgement {
  const where = tokens.slice(1).filter((token) => !token.text.startsWith('-'));
  if (where.length !== 1) return deny(SAY.wanderingOff);
  const check = containsPath(ctx.projectRoot, where[0]?.text ?? '');
  if (!check.inside) return deny(check.reason ?? SAY.outsideProject);
  return allow();
}

function judgeShellSegment(tokens: Token[], ctx: GuardFacts, depth = 0): Judgement {
  const assignments = leadingAssignments(tokens);
  const settings = judgeAssignments(assignments, ctx);
  const meaningful = tokens.slice(assignments.length);
  const first = meaningful[0];
  if (first === undefined) return settings;

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
    return strictest(settings, judgeShellSegment(inner, ctx, depth + 1));
  }
  const flags = flagsOf(meaningful);
  const paths = strictest(settings, judgeSegmentPaths(meaningful, ctx, READ_ONLY_COMMANDS.has(name)));
  const decide = (judgement: Judgement): Judgement => strictest(paths, judgement);

  if (name === 'cd' || name === 'chdir' || name === 'pushd' || name === 'popd') {
    return decide(judgeCd(meaningful, ctx));
  }

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
    const inline = meaningful.findIndex((token) => INLINE_CODE_FLAGS.has(token.text));
    if (inline !== -1) {
      const script = meaningful[inline + 1]?.text;
      if (READABLE_INTERPRETERS.has(name) && script !== undefined && depth < 3) {
        return decide(judgeShellCommand(script, ctx, depth + 1));
      }
      return deny(SAY.unreadable);
    }
    // A script that lives in the project is the project's own code. `npm run
    // dev` is allowed outright and runs exactly this file by another name, so
    // asking here and not there was the same risk judged two ways — and it is
    // the question people meet most, because every dev server is one of these.
    // It still takes a restore point: the project's own code can still write.
    // An interpreter that doubles as its own package manager — `bun add`,
    // `deno install`. Fetching somebody else's code is a different question
    // from running your own, and it is the one worth asking. Matched on the
    // verb rather than the tool: which runtimes also install things is a list
    // that grows, and what makes it worth asking is the fetching.
    const doing = (meaningful[1]?.text ?? '').toLowerCase();
    /* An installer reached through the runtime rather than by its own name —
       `python3 -m pip install requests`. The same fetching, the same question,
       and without this it read as running one of the project's own programs. */
    if (doing === '-m') {
      const module = (meaningful[2]?.text ?? '').toLowerCase();
      if (PACKAGE_MANAGERS.has(module) || module === 'ensurepip') {
        return decide(judgePackageManager(meaningful.slice(2)));
      }
    }
    if (FETCHES_CODE.has(doing)) {
      return decide(
        ask(
          'Add somebody else’s code to your project?',
          'This downloads a package from the internet and puts it in your project.',
          'Anything it brings with it runs the next time your project does.',
          { snapshot: true },
        ),
      );
    }
    if (PACKAGE_MANAGERS.has(name)) return decide(judgePackageManager(meaningful));

    /* A script rather than code typed into the command.
     *
     * Every location this names has already been walked and refused if it left
     * the project, so what is left is the project's own code — a file it wrote,
     * a module of the language's own, a task its own runner defines. `npm run
     * dev` is allowed outright and is one of these under another name.
     *
     * A restore point rather than a question: the risk that is actually left is
     * that it changes something, and being able to undo that is worth more than
     * a question about a filename nobody can judge from its spelling. */
    return decide(snapshotFirst('Running one of your project’s own programs.'));
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
  if (name === 'gh') return decide(judgeGh(meaningful));
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

  /* An instruction we have no rule for.
   *
   * It used to ask, every time, and that is where most of the questions in a
   * sitting came from: a project's own server, its task runner, a language
   * nobody thought of. Naming more shapes only ever moves the line — tomorrow
   * it is Rails, then Go, then something that does not exist yet.
   *
   * So the question is asked about what actually differs. Everything that
   * escapes has already been judged above and is not here: elevation, a path
   * outside the project, credentials, the history store, obfuscation, reaching
   * the internet, deleting. `judgeSegmentPaths` has walked every location this
   * command names and refused it if it left the folder. What is left is an
   * unfamiliar program, confined by the same boundary as every familiar one —
   * writes inside the project, nothing listening in from outside.
   *
   * It still takes a restore point, so an unfamiliar thing that changes
   * something is one press from undone. That is the honest protection here;
   * a question nobody can answer well is not.
   */
  return decide(snapshotFirst('Something I do not have a rule for, kept undoable.'));
}

/** Was somebody trying to hide a destructive verb from us? Runs over the raw
 *  text, before any parsing, so it catches shapes the reader would choke on. */
function looksObfuscated(command: string): boolean {
  /* These read the raw command, so their length is whatever somebody typed,
     and two of them used to cost the square of it: fifty thousand characters
     of `echo aaa…` took four and a half seconds of the one thread the window
     draws on. A long word is not a strange thing for an instruction to carry.
     The name in front of `()` was never needed to spot the shape, and the
     braces are walked rather than backtracked over. */
  // A function that calls itself forever, the classic one-line way to freeze a machine.
  if (/\(\)\s*\{[^}]*[|&]/.test(command)) return true;
  // Text being reassembled character by character to dodge a word match.
  if (/\\x[0-9a-f]{2}\\x[0-9a-f]{2}/i.test(command)) return true;
  if (hasTrickyExpansion(command)) return true;
  return false;
}

/** A `${…}` doing something to its value on the way out — the shape used to
 *  spell a word out of pieces. Walked rather than matched: the pattern for it
 *  had two open-ended runs before a closing brace, and an instruction with no
 *  closing brace at all cost seconds. */
function hasTrickyExpansion(command: string): boolean {
  for (let at = command.indexOf('${'); at !== -1; at = command.indexOf('${', at + 2)) {
    const end = command.indexOf('}', at + 2);
    if (end === -1) return false;
    if (/[:#%/]/.test(command.slice(at + 2, end))) return true;
  }
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

function judgeShellCommand(command: string, ctx: GuardFacts, depth = 0): Judgement {
  if (command.trim() === '') return UNKNOWN_COMMAND();
  const hidingSomethingDestructive = DESTRUCTIVE_WORDS.test(command);
  if (looksObfuscated(command)) {
    return deny(hidingSomethingDestructive ? SAY.wipe : SAY.unreadable);
  }

  const parsed = parseCommand(command);
  // Quotes that never close, brackets that never balance: we do not guess.
  if (!parsed.ok) return deny(hidingSomethingDestructive ? SAY.wipe : SAY.unreadable);
  // `$(...)` and backticks are a command hidden inside a command, and `$VAR`
  // is a word we never get to see. `rm -$FLAGS "$TARGET"` reads as harmless and
  // is not. If we cannot see the final command, we do not run the command.
  //
  // Plain `( … )` is not that. Every word inside one is in front of us and gets
  // judged like any other, so refusing it only cost people the ordinary way of
  // backgrounding something.
  if (parsed.substitution || parsed.expansion) {
    return deny(hidingSomethingDestructive ? SAY.wipe : SAY.unreadable);
  }

  const names = parsed.segments.map((segment) =>
    baseName(segment[leadingAssignments(segment).length]?.text ?? ''),
  );
  const downloads = names.some((name) => DOWNLOADERS.has(name));
  const interprets = names.some((name) => INTERPRETERS.has(name) || DECODERS.has(name));
  if (downloads && interprets) return deny(SAY.downloadAndRun);
  // `echo <something> | sh` and `printf ... | bash` hand an interpreter a script
  // we never get to look at. Anything downstream of a pipe that can run code is
  // refused on sight — but only downstream of a *pipe*: this used to refuse any
  // interpreter that was not the first command, which made `cd site && python3
  // -m http.server` unreadable when every word of it is right there.
  const fedByPipe = names.some((name, index) => parsed.piped[index] === true && INTERPRETERS.has(name));
  if (fedByPipe) return deny(hidingSomethingDestructive ? SAY.wipe : SAY.unreadable);

  let judgement = allow();
  for (const segment of parsed.segments) {
    judgement = strictest(judgement, judgeShellSegment(segment, ctx, depth));
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
    if (!check.inside) return refuseOutside(check, ctx);
    if (check.resolved !== null && isHistoryStore(check.resolved)) return deny(SAY.historyStore);
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

/** The words inside a run of steps, which is where a key would be hiding. */
function stepWords(input: Record<string, unknown>): string {
  const steps: unknown[] = Array.isArray(input['steps']) ? (input['steps'] as unknown[]) : [];
  return steps
    .map((step) =>
      typeof step === 'object' && step !== null ? collectText(step as Record<string, unknown>) : '',
    )
    .join('\n');
}

/** Pointing the browser at an address. The address itself travels, so a key in
 *  one is a key handed to a stranger. */
function judgeBrowserOpen(input: Record<string, unknown>, ctx: GuardFacts): Judgement {
  const url = readString(input, URL_KEYS) ?? readString(input, ['target']) ?? '';
  if (findSecret(url) !== null || findKnownSecret(url, ctx)) return deny(SAY.sendKeyOut);
  if (!onTheWeb(url)) return deny(SAY.notAWebAddress);
  const where = siteOf(url);
  return ask(
    where === null ? 'Open a page in a browser?' : `Open ${where} in a browser?`,
    'I open it in a browser of my own and read what is on it.',
    'The site sees the visit, and what comes back is not something I can check beforehand.',
    { mutates: false },
  );
}

/** Pressing or typing in that browser. */
function judgeBrowserAct(
  name: string,
  input: Record<string, unknown>,
  ctx: GuardFacts,
): Judgement {
  const typing = name === 'browsertype';
  if (typing) {
    const words = `${collectText(input)}\n${readString(input, ['target']) ?? ''}`;
    if (findSecret(words) !== null || findKnownSecret(words, ctx)) return deny(SAY.keyIntoPage);
  }
  if (!typing) {
    return ask(
      'Press this in the browser?',
      'I press it on the page the browser is on, and it behaves exactly as it would under your own finger.',
      'A press on a live page can send a form, buy something or delete something, and I cannot take that back.',
    );
  }
  const sending = input['submit'] === true;
  return ask(
    sending ? 'Type this into the page and send it?' : 'Type this into the page in the browser?',
    sending
      ? 'I put the words into the box and then send the form.'
      : 'I put the words into the box. Nothing is sent unless I am asked to send it.',
    sending
      ? 'Sending it can order something, sign you up or write to somebody, and I cannot take that back.'
      : 'The page sees every word as it goes in, and can act on it before anything is sent.',
  );
}

/** A browser is for the web. Anything else with a colon in it — a file on this
 *  computer, a page written into the address itself — is a way to read this
 *  machine into the conversation rather than a place to visit. */
export function onTheWeb(url: string): boolean {
  const asked = url.trim();
  if (asked === '') return false;
  // A place on this computer, not a place on the web.
  if (/^[/~.]/.test(asked) || /^[a-z]:[\\/]/i.test(asked)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(asked);
  if (scheme === null) return true;
  if (/^https?$/i.test(scheme[1] ?? '')) return true;
  // `localhost:3000` reads like a scheme and is a name and a port.
  return /^\d+(\/|$)/.test(scheme[2] ?? '');
}

/** The site an address belongs to, for a question that can name it. Null when
 *  the address is not one we can read, because a question naming nonsense is
 *  worse than a question naming nothing. */
function siteOf(url: string): string | null {
  const asked = url.trim();
  if (asked === '') return null;
  try {
    const whole = /^[a-z][a-z0-9+.-]*:/i.test(asked) ? asked : `https://${asked}`;
    const host = new URL(whole).hostname;
    return host === '' ? null : host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function judgeCall(call: ToolCall, ctx: GuardFacts): Judgement {
  const name = normalizeToolName(call.name);
  const input = call.input ?? {};

  // Nothing gets to turn the Guard off, however politely it asks.
  if (GUARD_SWITCH.test(name)) return deny(SAY.guardOff);

  if (RUNNING_TOOLS.has(name) || OUR_OWN_TOOLS.has(name)) return allow();

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
      if (!check.inside) {
        // The skills and extensions somebody installed are the agent's own, and
        // reading them is how they work at all.
        if (readsOwnFolder(check.resolved, ctx)) continue;
        return refuseOutside(check, ctx);
      }
      if (check.resolved !== null && isCredentialPath(check.resolved)) return deny(SAY.credentials);
      if (check.resolved !== null && isHistoryStore(check.resolved)) return deny(SAY.historyStore);
    }
    return allow();
  }

  if (DELETE_TOOLS.has(name)) {
    const paths = collectPaths(input);
    if (paths.length === 0) return UNKNOWN_COMMAND();
    for (const path of paths) {
      if (isProjectRoot(ctx.projectRoot, path)) return deny(SAY.deleteProject);
      const check = containsPath(ctx.projectRoot, path);
      if (!check.inside) return refuseOutside(check, ctx);
      if (check.resolved !== null && isHistoryStore(check.resolved)) return deny(SAY.historyStore);
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
    // A builder is the one helper that writes, and it writes only inside a copy
    // of the project made for it. Telling somebody it "cannot change anything"
    // was true of the other three and false of this one.
    const builds = (readString(input, ['role']) ?? '').trim().toLowerCase() === 'builder';
    if (builds) {
      return ask(
        'Send a piece of work to a helper that builds?',
        'I start a fresh helper with its own copy of the project. It makes the change there and hands back what it changed; your own files are untouched until you take it.',
        'It costs a little more, and nothing it does reaches your project on its own.',
        { mutates: false },
      );
    }
    return ask(
      'Send a piece of work to a helper?',
      'I start a fresh helper with its own clean memory. It can read the project and search the web, and it cannot change anything.',
      'It costs a little more, and its findings come back to this conversation.',
      { mutates: false },
    );
  }

  /* Putting work on the board. Nothing happens to the project here — each piece
     runs in a copy of its own and waits for somebody to take it — so this is one
     question about starting work, not one question per file it will touch. */
  if (name === 'setgoing') {
    return ask(
      'Set several pieces of work going at once?',
      'Each one gets its own copy of your project and its own agent. They run in the background, four at a time.',
      'Nothing reaches your own files until you take one.',
      { mutates: false },
    );
  }

  if (name === 'tryways') {
    return ask(
      'Make this two or three different ways?',
      'Each way is made in its own copy of your project, so they can be compared side by side.',
      'Keeping one throws the others away, and nothing reaches your own files until you keep one.',
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
        "This copy of our conversation still has one of your private keys in it. I've stopped it. I can share it with the keys taken out instead.",
      );
    }
    return ask(
      'Share a copy of this conversation?',
      'It includes what you asked for and what I did about it.',
      'Your keys and passwords are taken out before it leaves your machine.',
      { mutates: false },
    );
  }

  if (DESIGN_READ_TOOLS.has(name)) return allow();

  /* Putting a few questions on the screen and waiting for the answer. It reads
     nothing, writes nothing and reaches nowhere — and it has to be classed as
     changing nothing, or the look-around withholds it and the one moment worth
     asking at is the one moment it cannot. */
  if (ASKING_TOOLS.has(name)) return allow();

  /* The page beside the conversation. Reading and scrolling it are silent;
     pressing and typing in it are the one place in this file where the thing
     at risk is not a file at all. */
  if (PAGE_READ_TOOLS.has(name) || PAGE_MOVE_TOOLS.has(name)) return allow();

  if (PAGE_ACT_TOOLS.has(name)) {
    // Words typed into somebody's own site go wherever that site sends them,
    // and a page is the one place a key can leave without a request that looks
    // like one. Checked before the question, so this is a refusal rather than
    // something anybody can say yes to in a hurry.
    const typing = name === 'pagetype';
    if (typing) {
      const words = collectText(input);
      if (findSecret(words) !== null || findKnownSecret(words, ctx)) return deny(SAY.keyIntoPage);
    }
    const sending = input['submit'] === true;
    if (!typing) {
      return ask(
        'Press this on the page you are looking at?',
        'I press it on your own page, in the panel beside us, and it behaves exactly as it would under your own finger.',
        'A press on a live page can send a form, buy something or delete something, and I cannot take that back.',
      );
    }
    return ask(
      sending ? 'Type this into your page and send it?' : 'Type this into the page you are looking at?',
      sending
        ? 'I put the words into the box on your own page and then send the form, in the panel beside us.'
        : 'I put the words into the box on your own page, in the panel beside us. Nothing is sent unless I am asked to send it.',
      sending
        ? 'Sending it can order something, sign you up or write to somebody, and I cannot take that back.'
        : 'The page sees every word as it goes in, and can act on it before anything is sent.',
    );
  }

  /* A browser of its own. Looking is silent; getting it to an address, and
     pressing or typing once it is there, are the two moments worth a question. */
  if (BROWSER_LOOK_TOOLS.has(name)) return allow();

  if (BROWSER_REACH_TOOLS.has(name)) return judgeBrowserOpen(input, ctx);

  if (BROWSER_ACT_TOOLS.has(name)) return judgeBrowserAct(name, input, ctx);

  if (name === BROWSER_STEPS) {
    // Judged as the strictest step in it, so a run cannot carry a press past a
    // question by wrapping it in a list.
    const steps: unknown[] = Array.isArray(input['steps']) ? (input['steps'] as unknown[]) : [];
    let folded = allow();
    for (const step of steps) {
      if (typeof step !== 'object' || step === null) continue;
      const one = step as Record<string, unknown>;
      const kind = String(one['do'] ?? '').trim().toLowerCase();
      if (kind === 'open') folded = strictest(folded, judgeBrowserOpen(one, ctx));
      else if (kind === 'click' || kind === 'press') {
        folded = strictest(folded, judgeBrowserAct('browserclick', one, ctx));
      } else if (kind === 'type' || kind === 'fill') {
        folded = strictest(folded, judgeBrowserAct('browsertype', one, ctx));
      }
    }
    return folded;
  }

  /* This computer itself. A list of what is open is a read; a picture of the
     whole screen, and every move made on it, are not. */
  if (DESKTOP_LOOK_TOOLS.has(name)) return allow();

  if (DESKTOP_PICTURE_TOOLS.has(name)) {
    return ask(
      'Take a picture of your screen?',
      'It comes into this conversation, so whatever is on screen comes with it — other windows, other people\u2019s messages, anything left open.',
      'Close anything you would rather I did not see, and ask me again.',
      { mutates: false },
    );
  }

  if (DESKTOP_ACT_TOOLS.has(name)) {
    if (name === 'desktopopen') {
      const app = readString(input, ['app', 'name', 'program']) ?? 'a program';
      return ask(
        `Open ${app} on your computer?`,
        'I open it the way you would from the dock, and take a picture so I can see it.',
        'It comes to the front, over whatever you are looking at now.',
      );
    }
    // Words typed into a program on this computer go wherever that program
    // sends them, and there is no request to look inside on the way out.
    // Checked before the question, so this is a refusal rather than a yes
    // somebody gave in a hurry.
    const words = `${collectText(input)}\n${stepWords(input)}`;
    if (findSecret(words) !== null || findKnownSecret(words, ctx)) return deny(SAY.keyIntoPage);
    return ask(
      'Work your computer for you?',
      'I press, type and scroll on the screen exactly as you would, in whatever is in front.',
      'This is your real computer and not a copy, so what happens on it cannot be taken back.',
    );
  }

  if (MEMORY_TOOLS.has(name)) {
    // Memory takes ids and words, never paths, so there is nothing to check
    // outside the project for. It stays a read of the app's own notes.
    return allow();
  }

  /* Connecting another tool server is not writing a file. It is choosing a
   * program that will later run on this computer with this computer's powers,
   * on the strength of a name the model read somewhere. The line is quoted,
   * because the line is the whole decision. */
  if (name === 'connecttool') {
    const known = readString(input, ['known']);
    const where = readString(input, ['where']);
    const called = readString(input, ['name']) ?? known ?? 'a tool';
    const outbound = `${payloadText(input)}\n${where ?? ''}`;
    if (findSecret(outbound) !== null || findKnownSecret(outbound, ctx)) return deny(SAY.sendKeyOut);
    return ask(
      `Connect “${called}” so I can use its tools?`,
      where === null
        ? 'I add one we vouch for to this project’s own list of connected tools. Nothing starts now.'
        : `I write “${where}” into this project’s own list of connected tools. Nothing starts now.`,
      'Once it is on the list, that program can be started on this computer with the powers you have, and whatever it answers comes back to me as words.',
      { mutates: true },
    );
  }

  if (name === 'mcp') {
    const asked = input['tool'];
    const inner = readString(input, ['tool']);
    const server = readString(input, ['server']);

    // Asking what is connected starts nothing and reads no file. Tested on the
    // field being genuinely absent rather than on the name being unreadable: a
    // `tool` that is a blank string, a list or an object is a call with a name
    // nobody can check, and that is the opposite of nothing to check.
    if (asked === undefined || asked === null) return allow();
    if (inner === null) {
      return ask(
        'Let a connected tool do something I cannot name?',
        'The request did not say which tool to run, so I cannot tell you what it would do.',
        'A tool this app cannot name is one it cannot vouch for.',
        { mutates: true },
      );
    }

    const which = normalizeToolName(inner);

    // The switch check applies to the name that will really be run. On the way
    // in it only ever saw `mcp`, so a connected tool called `disable_safety`
    // earned a question somebody could say yes to instead of a refusal.
    if (GUARD_SWITCH.test(which)) return deny(SAY.guardOff);

    // The wrapper was hiding the name, so the reading half of a connected tool
    // asked on every call — the sets below were unreachable through it, and a
    // question asked forty times is a question nobody reads by the fortieth.
    // Whatever the model put in its arguments is about to leave this computer,
    // and a connected tool is somebody else's program. Swept for every one of
    // them, not only the read-shaped names: a tool that changes something is the
    // last one that should get a question where a read gets a refusal, and a
    // question is not a refusal at all on the rung where questions are answered
    // for you. What a connected tool is handed lives under `args`, which none of
    // the usual content keys name.
    const outbound = `${payloadText(input)}\n${asText(input['args'])}`;
    if (findSecret(outbound) !== null || findKnownSecret(outbound, ctx)) return deny(SAY.sendKeyOut);

    // A read-shaped name earns nothing further. The remote name is not proof of
    // capability: a project can put any executable behind `get_definition`, so
    // treating that spelling as a trusted read would let repository
    // configuration run local code without the connected-tool confirmation.

    // Every connected tool keeps its question, including read-like names whose
    // server is project configuration rather than code Graphe vouches for.
    const named = server === null ? 'the tool you connected' : server;
    return ask(
      `Let ${named} do this?`,
      `I ask ${named} to run “${inner}” and bring back what it answers.`,
      'The connected tool has its own powers, so this can change things on its side.',
      { mutates: true },
    );
  }

  if (name === 'debugattach') {
    return ask(
      'Attach to a running program and pause it?',
      'I start the debugger and take hold of the program so its frames and values can be read.',
      'The program is paused while it is attached, and letting it run on needs a detach.',
      { mutates: true },
    );
  }

  if (name === 'debugeval') {
    return ask(
      'Evaluate this in the paused program?',
      'I ask the debugger to run the expression inside the program, in the frame it is paused in.',
      'An expression can run code inside that program.',
      { mutates: true },
    );
  }

  // Stepping, reading frames and detaching work on a program the person has
  // already agreed to let us attach to, and change nothing the target did not
  // ask for — detach lets it run on. They are silent like reads.
  if (name === 'debugstep' || name === 'debugframes' || name === 'debugdetach') {
    return allow();
  }

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

/**
 * The questions turned off, and nothing else with them.
 *
 * A confirmation becomes a restore point where one was warranted and silence
 * where one was not. Denials are untouched, and `snapshot` survives whatever
 * happens to the verdict — the runtime reads it separately, so approval never
 * costs somebody their way back and neither does this.
 */
function withoutQuestions(judgement: Judgement, ctx: GuardFacts): Judgement {
  if (ctx.stopAsking !== true) return judgement;
  if (ctx.askBeforeEveryChange === true) return judgement;
  if (judgement.verdict.kind !== 'confirm') return judgement;
  return {
    verdict: judgement.snapshot
      ? { kind: 'snapshot-first', reason: judgement.verdict.question }
      : { kind: 'allow' },
    snapshot: judgement.snapshot,
    mutates: judgement.mutates,
  };
}

/** Reaching out or running something: the line the middle rung draws, and the
 *  one people actually feel. Changing a file is undoable; a command is not.
 *
 *  Pressing and typing on somebody's live page belong on this side of the line
 *  even though no command runs. A press is how a page reaches the internet, and
 *  what it does out there is as far past undoing as anything a shell can do. */
function leavesTheFiles(call: ToolCall): boolean {
  const name = normalizeToolName(call.name);
  // Writing down a program that will later run is on the far side of this line:
  // it is not undoable the way a file edit is.
  if (name === 'connecttool') return true;
  return (
    SHELL_TOOLS.has(name) ||
    NETWORK_TOOLS.has(name) ||
    WEB_TOOLS.has(name) ||
    PAGE_ACT_TOOLS.has(name) ||
    BROWSER_REACH_TOOLS.has(name) ||
    BROWSER_ACT_TOOLS.has(name) ||
    name === BROWSER_STEPS ||
    DESKTOP_PICTURE_TOOLS.has(name) ||
    DESKTOP_ACT_TOOLS.has(name)
  );
}

/** The refusals no rung reaches past: a key leaving the machine, and anything
 *  reaching for the Guard's own switches. */
function alwaysRefused(judgement: Judgement): boolean {
  if (judgement.verdict.kind !== 'deny') return false;
  return NEVER_ON_ANY_RUNG.has(judgement.verdict.reason);
}

const NEVER_ON_ANY_RUNG: ReadonlySet<string> = new Set([
  SAY.sendKeyOut,
  SAY.keyIntoPage,
  SAY.keyInBrowserFile,
  SAY.guardOff,
  // Reading this computer into the conversation through a browser is the same
  // shape of thing as a key leaving it, and the rung is about being asked.
  SAY.notAWebAddress,
]);

/**
 * How far it may go on its own.
 *
 * A ceiling, never a licence: this only ever makes a `confirm` quieter or a
 * change refused. `deny` is untouched on every rung, and `snapshot` survives
 * whatever happens to the verdict, so nobody loses their way back.
 *
 * A standing "ask me first" outranks the whole ladder — that one was said out
 * loud, and a control in a toolbar does not get to overrule it.
 */
function asFarAs(judgement: Judgement, ctx: GuardFacts): Judgement {
  const rung = ctx.howFar ?? 'asking';
  if (rung === 'asking' || ctx.askBeforeEveryChange === true) return judgement;
  if (judgement.verdict.kind === 'deny' || !judgement.mutates) return judgement;

  if (rung === 'looking') {
    return {
      verdict: {
        kind: 'deny',
        reason:
          'You asked me to look and not touch anything, so I have left it alone. Tell me to go further and I will.',
      },
      snapshot: false,
      mutates: false,
    };
  }

  return judgement;
}

function judge(call: ToolCall, ctx: GuardFacts): Judgement {
  const raw = judgeCall(call, ctx);
  // "Get on with it" is an explicit full-access choice, not merely fewer
  // questions. The terminal runner is widened for this same mode; leaving this
  // earlier policy gate in place was why harmless uses of /tmp were still
  // rejected before the shell ever saw them.
  //
  // The handful below are the exception, and they are not about scope: a person
  // saying "get on with it" is agreeing to work they cannot see, not to one of
  // their keys leaving the machine. Those refusals hold on every rung.
  if (ctx.howFar === 'doing') return alwaysRefused(raw) ? raw : allow(raw.mutates);

  const first = asFarAs(applyStandingInstruction(raw, ctx), ctx);
  return withoutQuestions(first, { ...ctx, stopAsking: quietFor(call, ctx) });
}

/** Whether the questions are off for *this* call. The top rung means all of
 *  them; the middle one means the ones that only touch files. */
function quietFor(call: ToolCall, ctx: GuardFacts): boolean {
  const rung = ctx.howFar ?? 'asking';
  if (rung === 'doing') return true;
  if (rung === 'changing') return !leavesTheFiles(call);
  return ctx.stopAsking === true;
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
/**
 * Whether this call works a screen the person is sitting in front of.
 *
 * It matters for one thing: whether the model may still put a question. The
 * usual rule is that once work has begun the moment for asking has passed,
 * because whoever asked for it may have walked away. That reasoning does not
 * hold here — pressing things in somebody's own applications only works while
 * they are there — and the question worth asking ("which file should I draw
 * this in?") is one nothing could have asked before it looked.
 */
export function worksAScreen(call: ToolCall): boolean {
  const name = normalizeToolName(call.name);
  return DESKTOP_ACT_TOOLS.has(name) || BROWSER_ACT_TOOLS.has(name) || name === BROWSER_STEPS;
}

export function changesAnything(call: ToolCall, ctx: GuardFacts): boolean {
  return judge(call, ctx).mutates;
}

/* -------------------------------------------------------------------------- */
/* What a second opinion may do to this one                                    */
/* -------------------------------------------------------------------------- */

/**
 * The one ordering of verdicts in the codebase.
 *
 * Anything that layers its own opinion on the Guard's folds the two through
 * here, so a layer can only ever tighten. On a tie the first argument keeps its
 * words, and the Guard is always the first argument — a refusal it wrote is the
 * refusal the user reads.
 */
export function stricter(first: Verdict, second: Verdict): Verdict {
  return STRICTNESS[second.kind] > STRICTNESS[first.kind] ? second : first;
}

/** What a call does, in the words a project writes its own rules in. */
export type CallDoes =
  | 'reads'
  | 'changes files'
  | 'deletes something'
  | 'runs a command'
  | 'reaches the internet'
  | 'something else';

/** One call, reduced to the three things a project rule can match on. */
export type CallShape = {
  does: CallDoes;
  /** Every location the call named, as it named it. */
  paths: readonly string[];
  /** The command, the query and anything being written, flattened for word matching. */
  text: string;
};

/**
 * Sort one call into the handful of kinds a person can hold an opinion about.
 *
 * Deliberately the Guard's own tool lists rather than a second set beside them:
 * a project rule about "anything that runs a command" has to mean the same
 * calls the Guard means by it, or the two drift and only one of them is tested.
 */
export function describeCall(call: ToolCall): CallShape {
  const name = normalizeToolName(call.name);
  const input = call.input ?? {};
  const command = readString(input, COMMAND_KEYS);
  const text = [command, readString(input, SQL_KEYS), readString(input, URL_KEYS), payloadText(input)]
    .filter((part): part is string => part !== null && part !== '')
    .join('\n');

  const does = ((): CallDoes => {
    // Sorted by what it leads to, not by the mechanism. A project rule saying
    // "ask me about anything that runs a command" ought to catch "write down a
    // program that will run"; calling it a file change would let it past.
    if (name === 'connecttool') return 'runs a command';
    if (SHELL_TOOLS.has(name) || SQL_TOOLS.has(name)) return 'runs a command';
    if (NETWORK_TOOLS.has(name) || WEB_TOOLS.has(name)) return 'reaches the internet';
    if (DELETE_TOOLS.has(name)) return 'deletes something';
    if (WRITE_TOOLS.has(name)) return 'changes files';
    if (ASKING_TOOLS.has(name)) return 'reads';
    if (READ_TOOLS.has(name) || LIST_TOOLS.has(name) || SEARCH_TOOLS.has(name)) return 'reads';
    if (DESIGN_READ_TOOLS.has(name) || CODE_READ_TOOLS.has(name) || PAGE_READ_TOOLS.has(name)) return 'reads';
    if (BROWSER_LOOK_TOOLS.has(name) || DESKTOP_LOOK_TOOLS.has(name)) return 'reads';
    if (BROWSER_REACH_TOOLS.has(name) || BROWSER_ACT_TOOLS.has(name) || name === BROWSER_STEPS) {
      return 'reaches the internet';
    }
    if (DESKTOP_ACT_TOOLS.has(name) || DESKTOP_PICTURE_TOOLS.has(name)) return 'runs a command';
    return 'something else';
  })();

  return { does, paths: collectPaths(input), text };
}
