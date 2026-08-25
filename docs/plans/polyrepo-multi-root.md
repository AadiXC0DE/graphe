# Plan: Polyrepo / Multi-Root — Opening a Folder That Contains N Repos

> **Scope:** `origin/main@6b50811`. **Type:** plan-only — no behaviour changed in this PR.
> **Goal:** Opening `~/my-product/` that contains `backend/.git` + `frontend/.git` (+ optional third) works flawlessly in Graphe. Single-repo folders remain byte-identical. Nothing breaks.

---

## 1) Problem

Today Graphe assumes **one `.git` at the opened folder** (`open.path`).

- `electron/main.ts:1763 readGitStatus(parent)` spawns `git status --porcelain=v2 --branch` at `parent`. If `parent` has no `.git` (but `backend/.git` + `frontend/.git` do) → exit 128 → `resolve(null)` (`1788`). `readBranches` at `1801` returns `[]`. Handler `CHANNEL.overview` at `4918` does `git===null ? null : {…}` → `Overview.git === null`.
- `src/components/Overview.tsx:348` renders `Lines` only when `git !== null`; `History.tsx:105` hides branch list same condition. Result: **branch UI disappears**, indistinguishable from "new empty project".
- `src/history/repo.ts:238 isReady()` checks only `join(root,'.git')`; `Timeline.open()->prepare()` at `repo.ts:250` + `timeline.ts:109` silently **`git init -b main` at parent** and writes `parent/.gitignore` (`NEVER_SAVE`). Child histories never read; `parent` becomes empty repo with `backend/`+`frontend/` as gitlinks.
- `everythingIn()` walks children (so file tree looks combined) but `markChanged` is fed `git.files=[]` from parent → **no dirty markers**.
- Preview (`preview/detect.ts:138 readTheFolder`, `show.ts:lookAt`) reads only `parent/package.json` → `unsure: NOTHING_TO_OPEN` even though `backend/dist` exists.
- Agent session `projectRoot=open.path`; `branchSwitch`/`worktree`/`landing`/`share` all `gitRun(cwd=parent)` → mutate spurious parent, not child.

**User expectation** (from real world, validated competitively): open the root so the agent sees all sub-projects, and see `backend@main · 2 ahead`, `frontend@feature/x` — exactly like VS Code/Cursor/JetBrains do.

---

## 2) Competitive Evidence (what to copy)

| Editor | Detection | Branch UI | Git ops | Agent scope |
|---|---|---|---|---|
| **VS Code** | recursive scan for `.git`, depth via `git.repositoryScanMaxDepth` (default 1 → 4 for nested), `git.autoRepositoryDetection=subFolders/openEditors`, parent-folder opt-in `git.openRepositoryInParentFolders` | Status bar = active repo only; **Repositories view** lists each repo with branch+sync; `scm.repositories.selectionMode` single vs multi | Per-repo commit boxes; multi-select to commit to several | — |
| **Cursor 0.50+** | inherits VS Code; `.code-workspace {folders:[{path:"backend"},{path:"frontend"}]}` first-class. Bug today concatenates branches `a, b, main` — fix *in progress* is "scope to active repo" (`forum.cursor.com/161885`) | Same + per-repo `.cursor/rules` with globs | Same; `working_directory` shell bug noted | Indexed via `code-workspace` folders; `@` to reference cross-repo files |
| **Claude Code / Pi CLI** | no scan; cwd-driven. `claude --add-dir ../backend --add-dir ../shared`, `/add-dir` mid-session, `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` (`claudelog --add-dir`, `code.claude.com/large-codebases`). Issue `anthropics/claude-code#36949` requests `workingDirectory` for 40-repo parent. | `git branch --show-current` per repo — ground truth | per-repo | Root sees every file when started at root; sub-`cwd` scoped |
| **JetBrains** | *Directory Mappings* per module | Grouped by repo; optional *synchronous branch control* creates/checks out same branch on all roots | Commit/Push/Update on all roots at once; Log filtered by root | Attach Project |

**Consensus:** enumerate repos, scope operations per repo. Do not merge into synthetic parent commit. Copy VS Code's **per-repo Repositories view + active-repo status bar** and JetBrains' optional synchronous toggle.

---

## 3) Design Principles (nothing must break)

1. **Additive IPC only.** `Overview.git` stays `GitSnapshot|null` for every single-repo consumer. New field `Overview.repos?: RepoOverview[]` is optional; old renderers ignore it.
2. **Single-repo path unchanged.** If `repos===undefined` or `length<2`, render path is byte-identical to today (same `Lines`, same `Timeline`, same `readGitStatus` single call). Tests `tests/branches.test.ts`, `gitstatus.test.ts`, `branch-display.test.ts` keep passing without edit.
3. **No synthetic parent `.git`.** When `parent` contains ≥2 child repos, **do not `git init` parent**. Parent history disabled; plan surfaces banner instead.
4. **Depth-1, bounded, cheap.** Detection runs once on `openProject`, not on every `overview` poll. Cap 3 repos, <50 ms, no recursion into `node_modules/.git`.
5. **Disable → thread model.** Phase 0 disables mutating verbs for multi-root (returns calm `Trouble`) rather than mutating wrong repo. Phase 1 threads `Where.repo` to correct `cwd`. Phase 2 threads timelines likewise.
6. **`cwd=parent` for agent stays** (agent sees every file). Git/npm commands are cwd-scoped per child via `Where.repo` (like `--add-dir`).

---

## 4) Detection Model

**New helper `electron/childRepos.ts` (~40 LOC, only imported by `openProject` + `overview`):**

```ts
export type DetectedRepo = { name: string; path: string; rel: string } // rel = "backend", path = join(parent,rel)
export async function childRepos(parent: string, max = 3): Promise<DetectedRepo[]>
```

- `readdir(parent,{withFileTypes:true})` → for each `Dirent.isDirectory() && !name.startsWith('.') && !NEVER_OPENED.includes(name) && !isSymlink` → `stat(join(parent,name,'.git'))` exists → push.
- Stop after `max`. Do **not** recurse (depth=1 only). Covers `backend/.git` at depth 2 from `parent`.
- Rule: if `stat(join(parent,'.git'))` exists → treat as **single repo**, do not also scan children (prevents double-count when monorepo has both root and nested `.git`).
- Cache: store `DetectedRepo[]` in `Held.detectedRepos` for the `open.path`; invalidate on `readdir` mtime change or explicit refresh (future).
- Cost: O(N children) ≤20 entries, <10 ms even on HDD.

**Performance budget:** detection + `Promise.all(readGitStatus+readBranches)` per child ≤ `4s` timeout each (existing), but bounded to 3 children and run in parallel.

---

## 5) IPC — Minimal, Non-Breaking

**`src/lib/ipc.ts` (+ ~18 lines):**

```ts
export type RepoOverview = { path: string; name: string; git: GitSnapshot }
export type Overview = {
  git: GitSnapshot | null;                 // unchanged — single-repo primary (first child or parent)
  repos?: readonly RepoOverview[];         // NEW optional — present only when parent holds ≥2 child repos
  preview: string | null;
  artifacts: readonly Artifact[];
  swatches: readonly Swatch[];
  styles: { file: string; tokens: readonly StyleToken[]; text: string } | null;
};
```

- `git` kept for compat: for multi-root, `git = repos[0]?.git ?? null` (so old `view.overview.git?.branch` still shows first child, not null).
- No `CHANNEL` rename. Reuse `CHANNEL.overview`.

**`Where` extended additively (+ ~4 lines):**

```ts
export type Where = {
  project?: string;
  conversation?: string;
  repo?: string; // NEW optional — relative child name "backend" validated via containsPath
};
export function whereIn(...) { // accept repo
  if (keys.includes('repo')) where.repo = String(fields['repo']).trim().slice(0,80).replace(/[^a-zA-Z0-9._-]/g,'' ) ...
}
```

- `whereIn` still trailing-arg, shape-checked. Old calls without `repo` keep working.
- All other `GrapheApi` verbs already take `where?:Where` — no signature change for single-repo.

---

## 6) Electron Main — `electron/main.ts`

**`readGitStatus(cwd)` + `readBranches(cwd)` + parsers `src/lib/gitstatus.ts` + `branches.ts` unchanged.**

**`openTheProject(path)` / `Held`:**

- After `resolve(path)` and before `Timeline.open`, run `childRepos(path)`. If `≥2`, set `held.detectedRepos = repos` and **skip `Timeline.open(path)` / `ProjectHistory.prepare()` for parent** (guard: `if (repos.length>=2) held.timeline = null as unknown as Timeline` behind nullable type, or keep timeline but mark `isMultiRoot=true` and never snapshot). No `parent/.git` created. Keeps `parent/.gitignore` untouched.
- For single-repo (`repos.length<2`), existing `Timeline.open` path runs identically.

**`overview` handler `CHANNEL.overview` (~+45 lines inside existing handler, no new handler):**

```ts
const repos = held.detectedRepos ?? []
if (repos.length >= 2) {
  const built = await Promise.all(repos.map(async r => ({
    name: r.name, path: r.path,
    git: await readGitStatus(r.path).then(g => g ? {...g, branches: await readBranches(r.path)} : null)
  })))
  const present = built.filter(b => b.git) as RepoOverview[]
  return done({ git: present[0]?.git ?? null, repos: present, preview: held.serving?.address ?? null, ... })
}
// else single-repo existing return
```

- Single call site; old renderer ignores `repos`.

**`branchSwitch` / `branchCreate` (`CHANNEL.branchSwitch`, `CHANNEL.branchCreate`) (~+20 lines):**

```ts
const repoRel = where?.repo
const targetCwd = repoRel ? join(open.path, repoRel) : (checkoutEntryFor(open,where)?.folder ?? open.path)
if (repoRel && !containsPath(open.path, targetCwd)) return fail(...)
const git = await readGitStatus(targetCwd) // for validation
// existing gitRun(targetCwd, ['checkout', name]) / ['checkout','-b',name]
```

- `containsPath` from `src/agent/guard/paths.ts` already used for file guards.
- Multi-root switch via `bridge.branchSwitch(name,{project:parent, repo:"backend"})` now correct. Single-repo `where.repo===undefined` → existing `open.path` path.

**`versions`, `putBack`, `saveVersion`, `designCommit`, `githubRepo`, `landing`, `projectFiles`:** Phase 0 guard: if `held.detectedRepos?.length>=2` return `Trouble` ("Open backend directly…") or read-only variant (see §9). Phase 1/2 thread `Where.repo` similarly (details in Phases).

---

## 7) History — `src/history/repo.ts` + `timeline.ts`

- Phase 0: **do not `prepare()` multi parent**. No `parent/.git` side-effect. `isReady(parent)` stays `false` when multi, which is the correct signal for "not a repo, but container".
- Phase 1: no `ProjectHistory` change. For per-repo timelines, lazily open `new ProjectHistory(childPath)` on first per-repo `versions()`/`snapshot()` call. Cache in `Held.childTimelines: Map<string,Timeline>` (new field, not on single-repo). No cross-repo transaction; `snapshot/restoreTo/currentVersion/versions` stay per `ProjectHistory`.
- Phase 2: same; add `Held.childWaiting: Map<string,HeldWork>` if landing per-repo needed. No change to `ProjectHistory.attempt` `FORCED_SETTINGS`, `NEVER_SAVE`, `AUTOMATIC_IDENTITY`.
- `ProjectHistory.addWorkspace/removeWorkspace/workspaces` remain per-repo (`addWorkspace(at,from)` already takes `at` as absolute folder). Worktree folders keyed per `childPath` (see §8).

---

## 8) Components — `src/components/Overview.tsx` / `Lines.tsx` / `History.tsx`

- **Phase 0 (+ ~25 lines in `Overview.tsx`, 0 in `Lines.tsx`):**

```tsx
const repos = view.overview?.repos
if (repos && repos.length >= 2) {
  return <>
    <section className="overview__block">
      <h2>This folder holds {repos.length} repos</h2>
      <ul>{repos.map(r => <li key={r.path}>{r.name} • {r.git.branch ?? 'no commits'} {r.git.ahead?`· ${r.git.ahead} ahead`:''}</li>)}</ul>
      <p className="overview__quiet">Open one directly to switch lines / save versions.</p>
    </section>
    {/* optionally read-only Lines per repo disabled */}
  </>
}
// else existing single {git===null?null:<Lines …>}
```

- `Lines.tsx` **unchanged** — reused per repo in Phase 1 by mapping:

```tsx
repos.map(r => <section key={r.path}><h3>{r.name}</h3><Lines branches={r.git.branches} fallback={r.git.branch} onSwitch={n=>bridge.branchSwitch(n,{project:parent,repo:r.name})} /></section>)
```

- `History.tsx` similarly: Phase 0 hides branch list for multi (existing `git===null` guard suffices via `git=firstChildGit`); Phase 2 tabs per repo `view.repoVersions[repo]`.

**No CSS reflow beyond stacking two `lines__now` blocks.**

---

## 9) File Listing — `src/files/listing.ts` + `electron/main.ts projectFiles`

- `everythingIn(parent)` already walks into `childA/` + `childB/` (it only skips `.git`). No change.
- Phase 0 fix (+ ~12 lines handler): collect `changedByChild` via `readGitStatus` per child, prefix paths with `childName/` before `markChanged`, merge. So `childA/src/App.tsx` gets `changed:true` correctly.
- `markChanged` and `NEVER_OPENED`/`DEEPEST`/`MOST` unchanged.

---

## 10) Preview — `src/preview/detect.ts` / `show.ts`

- `detect.ts:readTheFolder` stays pure. No change.
- Phase 0: `overview.repos.length>=2` → disable "See it" for parent with tooltip "Open backend to preview"; or dropdown listing repos (disabled).
- Phase 1: add `<select>` above Preview button `repos.map(r=>r.name)` → `previewTarget` state; `onPreview` calls `bridge.show(at,point,{project: join(parent,target)})` or `bridge.show` with `Where.repo`. Backend uses `const folder = where?.repo ? join(open.path,where.repo) : open.path; const recipe=readTheFolder(await lookAt(folder))` (`lookAt` reads `readdir`+`package.json` already). `variationsServe` already per-`where`, reuse.

---

## 11) Worktree / Landing / Share

**Worktree (`src/history/worktree.ts`, `electron/main.ts:createWorktree/land/dropFolder`):**

- Phase 0/1 cheapest: guard `canLand = (held.detectedRepos?.length??0) < 2`. When multi, `worktreeLand/worktreeDrop` button disabled, tooltip "Worktrees disabled for parent folders — open backend directly". Returns `Trouble` with calm sentence (they already `Result<Trouble>`).
- Phase 2: thread `Where.repo`, key `worktreesFolder(childPath)` per child, `branchFor(${childLeaf}/${id})` to avoid name collision, `checkoutEntryFor` threaded.

**Landing (`electron/main.ts:landingNow/whatCanBeReached`, `src/components/Landing.tsx`):** `Held.waiting: HeldWork|null` single per `Held`. Phase 0: `if(multi) return landing with held:null` + message. Phase 2: `Map<repoPath,HeldWork>` + `photographHeld` per copy.

**Share — `handToDeveloper` (`share/developer.ts`) / `putOnline` (`share/publish.ts`):** Phase 0 disabled when multi (reuse `Landing.canHandOver/canPutOnline` guard). Phase 2 loop per repo or picker.

**No worktree key collision:** `workFolder()`, `keptCopyFolder(path)`, `awayFolder(path)` keyed by `parent`; Phase 0 keeps keyed by parent but grouped display in `Away`; Phase 2 key by `childPath`.

---

## 12) Agent Session

- **Phase 0:** keep `projectRoot=open.path` (parent). Agent sees every file in `backend/` + `frontend/` without extra grants (covers user's "open root so agent has access to all sub-projects"). Add tool-hint injection when `detectedRepos.length>=2`: `This folder holds 2 repos at child depth: backend (branch X), frontend (branch Y). Run git/npm commands with appropriate cwd.`
- Tool guard `containsPath` already handles per-child `Where.repo` when threaded in Phase 1.

---

## 13) Tests & Verification

**New tests (Phase 0):**

- `tests/childRepos.test.ts` — depth-1 only, skips dotdirs/NEVER_OPENED/symlink, cap 3, parent `.git` → single.
- `tests/multiroot-overview.test.ts` — `overview()` on parent with 2 children returns `repos.length===2`, `git===firstChild.git`, `gitStatus` per child mocked; single-repo still `repos===undefined`.

**Existing tests must stay green without edit (regression guard):**

- `tests/branches.test.ts`, `gitstatus.test.ts`, `branch-display.test.ts` — single-repo paths hit `where.repo===undefined` → existing `cwd=open.path`.
- `tests/worktree.test.ts`, `handover.test.ts`, `preview/detect.test.ts` — disabled paths for multi return `Trouble`, not crash.

**Manual checklist (implementer):**

- Open `~/parent` with 2 child `.git`s → `overview().repos.length===2`, banner shows `backend • main`, `frontend • feature/x`; no `parent/.git` created.
- Open single repo → `repos===undefined`, branch UI identical to before.
- Branch switch on `frontend` → `git rev-parse --abbrev-ref HEAD` in `frontend` changes, `backend` unchanged, `parent` untouched.
- File `backend/src/App.tsx` dirty → tree shows `backend/src/App.tsx` with `changed:true`, parent bag 0.
- Preview dropdown picks `backend` → serves `backend/dist` correctly.
- Worktree/Hand Over/Put Online on parent show calm tooltip, not crash.

**Performance:** `openProject` on 3-repo parent <100 ms added (`console.time('childRepos')`), `overview` poll does 2–3 parallel `git status` (already 4 s timeout each, bounded).

---

## 14) Rollout (all additive, no breaking change)

### Phase 0 — read-only detection (~130 lines, 1 new file, 3 modified) — *this PR's plan scope*

- Files: `electron/childRepos.ts` new 40, `src/lib/ipc.ts` +18, `electron/main.ts` +45, `src/components/Overview.tsx` +25, `tests/childRepos.test.ts` new.
- Behaviour: parent open succeeds with banner; no `git init`; mutating verbs guarded; single-repo untouched.

### Phase 1 — per-repo branch switch/preview (+ ~70 lines)

- `electron/main.ts` branchSwitch/create/show threaded `Where.repo` + `containsPath` check; `Overview.tsx` stacked `Lines` per repo; `App.tsx` `refreshOverview`.

### Phase 2 — full timeline per repo (+ ~370 lines)

- `src/lib/ipc.ts` `repoVersions?:Record<string,SavedVersion[]>`, `src/lib/projects.ts:Desk.repoVersions`, `electron/main.ts Held.childTimelines:Map`, per-repo `versions/putBack/saveVersion/landing/worktreesFolder`, `History` tabs, `share/*` per-repo.

Total from zero to perfect: ~570 lines.

---

## 15) Alternatives Rejected

- **Synthetic parent repo (auto `git init` parent spanning children)** — violates `FEATURES.md 4.10` "user never sees word git", creates commits spanning unrelated repos, breaks `handToDeveloper` (`origin` ambiguous), and treats `backend/.git` as gitlink. Rejected.
- **`.code-workspace` file parser** — heavier than bounded scan, less discoverable; scan already covers 3-repo parent.
- **Splitting `Desks.byPath` per child** — duplicates composer/thread state; single parent `Desk` keeps one chat about several repos (correct UX).
- **Changing `Overview.git` to `gits[]` (breaking)** — 80–120 lines + 6 test files vs additive optional `repos`.

---

## 16) Risks & Mitigations

- **False positive `parent/not-a-repo/node_modules/.git`** → mitigated by `NEVER_OPENED` skip + depth-1 + `isDirectory` check.
- **Parent with both root `.git` and child `.git`s** → rule "root `.git` wins, no child scan" avoids double count.
- **Old window on new shell** → old renderer ignores `repos`, sees `git=firstChild` (safe degraded).
- **Worktree key collision** → Phase 0 disabled; Phase 2 keys by `childPath`.

---

*Verified against `origin/main` files:* `electron/main.ts:172-1763-1801-4918-6438`, `src/lib/ipc.ts:89-986-1114`, `src/history/repo.ts:154-238-250`, `src/components/Overview.tsx:348`, `src/lib/gitstatus.ts:13`, `src/lib/branches.ts:1`, `src/preview/detect.ts:138`.
