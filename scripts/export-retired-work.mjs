#!/usr/bin/env node
// Export the stores phase 8 retires, before their UI goes.
//
// Nothing here deletes or moves anything: every retired screen owned a file on
// disk, and the plan requires a recovery route for each of them. This reads
// those files, writes a readable archive somewhere else, and says where it put
// it. Run it against the real profile by default, or against a named one:
//
//   node scripts/export-retired-work.mjs
//   node scripts/export-retired-work.mjs --profile "/path/to/profile" --out ./archive
//   node scripts/export-retired-work.mjs --project "/path/to/project"
//
// The profile is the same folder the app calls `app.getPath('userData')`, which
// is what `GRAPHE_PROFILE` moves. `--project` is optional and only adds the
// before/after shots the automatic capture wrote inside a project's own git
// folder.
//
// What is archived, and which retirement each belongs to:
//
//   followed.json   Figma-following: the designs each project was kept in step
//                   with, and what had moved on since the work was built.
//   flows/          Canvas: every saved flow, with its blocks and their wiring.
//   work/           Away work: the notes for each queued, running or finished
//                   piece, including the unmerged variants it produced.
//   copies/         Away work and variations: the per-piece git worktrees. Only
//                   a manifest is written, never a copy of the tree, because
//                   those folders are real worktrees with a branch behind them
//                   and the honest recovery is the folder itself.
//   standing.json   The repeats the away band scheduled.
//   agreed/         The baselines the automatic visual capture compared against.
//   shots/          Only with --project: the before/after pictures the
//                   automatic capture wrote under the project's .git folder.
//
// Walkthrough recordings are not here because they were never written to disk:
// the recorder coalesced them in the window's own memory for as long as the tab
// was open. There is nothing left to export once that UI is gone.

import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const spawn = promisify(execFile)

const USAGE = `Usage: node scripts/export-retired-work.mjs [options]

  --profile <dir>  The app profile to read. Defaults to GRAPHE_PROFILE, then to
                   the app's own userData folder for this platform.
  --project <dir>  A project folder, to include its automatic capture shots.
  --out <dir>      Where to write the archive. Defaults to
                   ./retired-work-export-<yyyy-mm-dd>.
  --help           This.`

function argsFrom(argv) {
  const found = { profile: '', project: '', out: '' }
  for (let at = 0; at < argv.length; at += 1) {
    const one = argv[at]
    if (one === '--help' || one === '-h') return null
    if (one === '--profile' || one === '--project' || one === '--out') {
      const value = argv[at + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${one} needs a folder after it`)
      }
      found[one.slice(2)] = value
      at += 1
      continue
    }
    throw new Error(`I do not know the option ${one}`)
  }
  return found
}

/** The folder the app would call `app.getPath('userData')` with nothing set.
 *  Electron takes the product name, and this app ships two spellings of it. */
function defaultProfile() {
  const name = 'Graphe'
  if (process.platform === 'darwin') {
    const support = join(homedir(), 'Library', 'Application Support')
    // Both spellings are in the wild: the build sets productName, the package
    // name is lower case, and Electron uses whichever it finds.
    const shipped = join(support, name)
    return existsSync(shipped) ? shipped : join(support, name.toLowerCase())
  }
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), name)
  }
  return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), name.toLowerCase())
}

function profileFrom(named) {
  if (named !== '') return resolve(named)
  const fromEnv = (process.env['GRAPHE_PROFILE'] ?? '').trim()
  return resolve(fromEnv === '' ? defaultProfile() : fromEnv)
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function entriesIn(folder) {
  return readdir(folder, { withFileTypes: true }).catch(() => [])
}

async function copyInto(from, to) {
  await mkdir(to, { recursive: true })
  if (!existsSync(from)) return 0
  await cp(from, to, { recursive: true })
  const found = await entriesIn(from)
  return found.length
}

/** The lines of a markdown table, or a plain sentence when there is nothing in
 *  it. A row of dashes reads like data nobody filled in. */
function table(header, rows, empty) {
  if (rows.length === 0) return `${empty}\n`
  const line = (cells) => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line), ''].join('\n')
}

function says(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

/* ========================================================================== */

const naming = argsFrom(process.argv.slice(2))
if (naming === null) {
  console.log(USAGE)
  process.exit(0)
}

const profile = profileFrom(naming.profile)
const stamp = new Date().toISOString().slice(0, 10)
const out = resolve(naming.out === '' ? `retired-work-export-${stamp}` : naming.out)
const project = naming.project === '' ? '' : resolve(naming.project)

if (!existsSync(profile)) {
  console.error(`There is no profile at ${profile}. Nothing has been read or written.`)
  process.exit(1)
}

await mkdir(out, { recursive: true })

const written = []
const missing = []

/* Figma-following: which file each project was kept in step with. */

const followed = await readJson(join(profile, 'followed.json'))
if (followed === null) {
  missing.push('followed.json')
} else {
  await writeFile(join(out, 'followed.json'), `${JSON.stringify(followed, null, 2)}\n`)
  written.push('followed.json')
  const rows = (Array.isArray(followed.followed) ? followed.followed : []).map((row) => [
    says(row?.project),
    says(row?.held?.name),
    says(row?.held?.url),
    row?.held?.readAt === undefined ? '-' : new Date(row.held.readAt).toISOString(),
    row?.held?.design === undefined && row?.held?.latest === undefined ? '-' : 'read',
  ])
  const notes = [
    '# Figma designs each project was following',
    '',
    'The whole comparison was kept, not just the address, so the design the work',
    'was built from can still be read next to the one that had moved on.',
    '',
    table(
      ['project', 'design', 'address', 'last read', 'findings'],
      rows,
      'No project was following a Figma file, so there is nothing to recover here.',
    ),
  ].join('\n')
  await writeFile(join(out, 'followed.md'), notes)
  written.push('followed.md')
}

/* Canvas: the saved flows, with their blocks. */

const flowsIn = join(profile, 'flows')
if (!existsSync(flowsIn)) {
  missing.push('flows/')
} else {
  const count = await copyInto(flowsIn, join(out, 'flows'))
  written.push(`flows/ (${String(count)} file${count === 1 ? '' : 's'})`)
  const lines = ['# Saved canvases', '', 'One row per canvas, in the project whose file it came from.', '']
  for (const one of await entriesIn(flowsIn)) {
    if (!one.isFile() || !one.name.endsWith('.json')) continue
    const held = await readJson(join(flowsIn, one.name))
    const list = Array.isArray(held?.flows) ? held.flows : Array.isArray(held) ? held : []
    lines.push(`## ${one.name}`, '')
    if (list.length === 0) {
      lines.push('No canvas was saved in this project.', '')
      continue
    }
    lines.push(
      table(
        ['canvas', 'blocks', 'ended'],
        list.map((flow) => [
          says(flow?.name),
          Array.isArray(flow?.blocks) ? String(flow.blocks.length) : '0',
          says(flow?.ended),
        ]),
      ),
    )
  }
  await writeFile(join(out, 'canvases.md'), lines.join('\n'))
  written.push('canvases.md')
}

/* Away work: the notes for every queued, running and finished piece. */

const workIn = join(profile, 'work')
if (!existsSync(workIn)) {
  missing.push('work/')
} else {
  const count = await copyInto(workIn, join(out, 'work'))
  written.push(`work/ (${String(count)} project${count === 1 ? '' : 's'})`)
  const lines = [
    '# Work the away board was holding',
    '',
    'Every note the board wrote: what each piece was doing, what it cost, where its',
    'copy is, and whether it finished. Pieces whose state is not `done` are the ones',
    'still owed somebody.',
    '',
  ]
  for (const folder of await entriesIn(workIn)) {
    if (!folder.isDirectory()) continue
    const notes = []
    for (const one of await entriesIn(join(workIn, folder.name))) {
      if (!one.isFile() || !one.name.endsWith('.json')) continue
      const held = await readJson(join(workIn, folder.name, one.name))
      const work = held?.work ?? held
      if (work === null || typeof work !== 'object') continue
      notes.push([
        says(work.doing ?? work.name),
        says(work.state),
        says(work.folder),
        says(work.trouble),
        work.at === undefined ? '-' : new Date(work.at).toISOString(),
      ])
    }
    lines.push(`## ${folder.name}`, '')
    lines.push(
      table(
        ['what it was doing', 'state', 'its copy', 'trouble', 'when'],
        notes,
        'The notes for this project have already been reaped, so there is nothing left to read.',
      ),
    )
  }
  await writeFile(join(out, 'away-work.md'), lines.join('\n'))
  written.push('away-work.md')
}

/* Copies: real worktrees with real branches. A manifest, never a copy. */

const copiesIn = join(profile, 'copies')
if (!existsSync(copiesIn)) {
  missing.push('copies/')
} else {
  const lines = [
    '# The copies away work and unmerged variants were made in',
    '',
    'Nothing was copied. Each folder below is a git worktree with a branch behind',
    'it, so the folder itself is the work: open it, or land the branch. Only the',
    'manifest is archived here. Copies holding uncommitted work are marked, because',
    'those are the ones that would be lost if the folder were thrown away.',
    '',
  ]
  const rows = []
  for (const folder of await entriesIn(copiesIn)) {
    if (!folder.isDirectory()) continue
    for (const one of await entriesIn(join(copiesIn, folder.name))) {
      const where = join(copiesIn, folder.name, one.name)
      let branch = '-'
      let dirty = 'no'
      try {
        const found = await spawn('git', ['-C', where, 'rev-parse', '--abbrev-ref', 'HEAD'], {
          encoding: 'utf8',
        })
        branch = found.stdout.trim() || '-'
        const status = await spawn('git', ['-C', where, 'status', '--porcelain'], { encoding: 'utf8' })
        dirty = status.stdout.trim() === '' ? 'no' : 'yes'
      } catch {
        // Git cannot read it, so its branch is unknown. Whether it holds files
        // is still worth saying: the folder may be the only copy of the work.
        branch = 'not readable'
        const contents = await entriesIn(where)
        dirty = contents.length === 0 ? 'no, and empty' : `unknown, holds ${String(contents.length)} entries`
      }
      rows.push([folder.name, one.name, branch, dirty, where])
    }
  }
  lines.push(
    table(
      ['project key', 'piece', 'branch', 'holds uncommitted work', 'folder'],
      rows,
      'No per-piece copy is on disk, so no unmerged variant or queued piece is waiting in one.',
    ),
  )
  await writeFile(join(out, 'copies.md'), lines.join('\n'))
  written.push('copies.md')
}

/* Repeats: the schedules the away band kept. */

const standing = await readJson(join(profile, 'standing.json'))
if (standing === null) {
  missing.push('standing.json')
} else {
  await writeFile(join(out, 'standing.json'), `${JSON.stringify(standing, null, 2)}\n`)
  written.push('standing.json')
  const list = Array.isArray(standing) ? standing : Array.isArray(standing?.standing) ? standing.standing : []
  const rows = list.map((one) => [
    says(one?.doing),
    says(one?.every),
    says(one?.at?.hour) === '-' ? '-' : `${String(one.at.hour)}:${String(one.at.minute).padStart(2, '0')}`,
    one?.on === false ? 'off' : 'on',
  ])
  await writeFile(
    join(out, 'repeats.md'),
    [
      '# Work that was asked for again and again',
      '',
      'Nothing schedules these any more. They are written down so the request behind',
      'each one can be read and asked for again deliberately.',
      '',
      table(
        ['what it was doing', 'how often', 'when', 'switched'],
        rows,
        'Nothing was being asked for over and over.',
      ),
    ].join('\n'),
  )
  written.push('repeats.md')
}

/* Agreement: the baselines the automatic capture compared against. */

const agreed = join(profile, 'agreed')
if (!existsSync(agreed)) {
  missing.push('agreed/')
} else {
  const count = await copyInto(agreed, join(out, 'agreed'))
  written.push(`agreed/ (${String(count)} project${count === 1 ? '' : 's'})`)
}

/* Shots, only when a project was named: the automatic before/after pictures. */

if (project !== '') {
  const shots = join(project, '.git', 'graphe', 'shots')
  if (!existsSync(shots)) {
    missing.push(`${shots}`)
  } else {
    const count = await copyInto(shots, join(out, 'shots'))
    written.push(`shots/ (${String(count)} picture${count === 1 ? '' : 's'})`)
  }
}

/* ========================================================================== */

const report = [
  `Profile read:    ${profile}`,
  `Archive written: ${out}`,
  project === '' ? '' : `Project read:    ${project}`,
  '',
  'Archived:',
  ...(written.length === 0 ? ['  (nothing found)'] : written.map((one) => `  ${one}`)),
  '',
  'Not found, so nothing was archived for it:',
  ...(missing.length === 0 ? ['  (nothing missing)'] : missing.map((one) => `  ${one}`)),
  '',
  'Nothing in the profile or the project was moved, changed or deleted.',
]
console.log(report.filter((line) => line !== undefined).join('\n'))
