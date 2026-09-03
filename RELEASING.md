# Releasing Graphe

macOS only, for now. Two architectures, a disk image and a zip for each, and a Homebrew cask that
points at the zips.

Everything below runs on a Mac. There is nothing to sign up for and nothing to pay: the build is
ad-hoc signed, which costs nothing and is what makes the Homebrew route work. Read
[the distribution section of ARCHITECTURE](notes/strategy/ARCHITECTURE.md) once before your first
release — the reasoning is short and it explains why several of these steps look odd.

---

## The short version

```bash
npm version patch --no-git-tag-version   # bump, commit
git tag v<version> && git push origin v<version>
```

The tag is the whole instruction. `.github/workflows/release.yml` packages on a macOS runner,
verifies the bundles, uploads the four artifacts and their checksums to the GitHub release, and
opens the cask pull request against the tap. Everything below is what that workflow does, in order,
and how to do it by hand when you need to.

Write `notes/releases/<version>.md` before you tag. That file becomes the release body — for people
who are about to install this, not for people reading the log. Without it the release carries a list
of commit subjects, which is honest and useless.

Building locally is still how you look at the app before tagging:

```bash
npm run check            # typecheck and tests
npm run package          # builds, licences, packages, and verifies
```

---

## 1. Decide the version

`package.json` is the only place the version lives. Bump it there, and nowhere else — the disk
image, the zip, the cask URL and the tag all read from it.

```bash
npm version patch --no-git-tag-version    # or minor / major
```

Pre-1.0, and honestly so. `0.x` communicates something true.

## 2. Build

```bash
npm run package
```

That is `scripts/package-app.mjs`, and it runs five things in an order that matters:

| Step | What | Why it is before the next one |
| --- | --- | --- |
| 1 | `tsc --noEmit` | A packaged type error is a packaged bug |
| 2 | `vite build` → `dist/` | electron-builder ships whatever is on disk, including last month's |
| 3 | `build-electron.mjs` → `dist-electron/` | Same |
| 4 | `third-party-licenses.mjs` → `THIRD-PARTY-LICENSES.md` | The manifest has to describe the tree being packaged |
| 5 | `electron-builder` → `release/` | |
| 6 | `verify-package.mjs` | Opens what was built and checks it is what we meant |

Roughly ten minutes cold, three warm. It produces:

```
release/Graphe-<version>-arm64.dmg     ~112 MB
release/Graphe-<version>-arm64.zip     ~113 MB
release/Graphe-<version>-x64.dmg       ~128 MB
release/Graphe-<version>-x64.zip       ~129 MB
```

Most of that is Electron and the agent runtime. Both are load-bearing, and neither is going to
get much smaller.

**If verification fails, do not release the build.** It checks the two things that break silently:
that the agent runtime actually made it into the bundle and can be loaded from where it now lives,
and that the app carries a valid ad-hoc signature. Both failures look like something else entirely
by the time a user hits them.

### Building for one architecture only

```bash
npm run package:quick        # arm64, verified
node scripts/package-app.mjs --dir    # unpacked .app, no disk image, fastest
```

## 3. Look at it

Automated checks do not tell you whether the app works.

```bash
open release/Graphe-<version>-arm64.dmg
```

Drag it to Applications, open it from there, and:

- the window draws, in the right theme, with the traffic lights where they should be;
- opening a folder works, and the version rail appears once there are two versions;
- "See it" builds something and opens it in a browser;
- quitting and reopening remembers the project.

Then throw that copy away, because it is not the one anybody else will install.

**Once per release, the Intel bundle too.** `verify-package.mjs` proves both are there and signed;
nothing proves the x64 one launches. On Apple silicon, Rosetta is enough:

```bash
open release/Graphe-<version>-x64.dmg
arch -x86_64 open /Volumes/Graphe\ <version>-x64/Graphe.app
```

Record it here, with the version and the date, before publishing. An empty row
is not a pass — it is a release nobody has launched on half the machines it is
offered to.

| Version | Checked on | By |
| --- | --- | --- |
| — | — | — |

## 4. Tag and publish

```bash
git tag v<version>
git push origin v<version>
```

That is it. The release workflow refuses a tag that does not match `package.json`, runs the
typecheck and the tests, packages both architectures, verifies them, writes
`Graphe-<version>-checksums.txt`, keeps this build's source maps as a workflow artifact, and creates
the release with all five files on it.

**If you have to do it by hand** — the workflow is down, or you are publishing from a machine
without a runner:

```bash
gh release create v<version> \
  release/Graphe-<version>-arm64.dmg \
  release/Graphe-<version>-arm64.zip \
  release/Graphe-<version>-x64.dmg \
  release/Graphe-<version>-x64.zip \
  --title "Graphe <version>" \
  --notes-file <(git log --oneline "$(git describe --tags --abbrev=0 HEAD^)"..HEAD)
```

Release notes are for the people who will install it, not for the people who wrote it. "Fixed a race
in the event relay" names the repair; "the conversation no longer jumps to the bottom while you are
reading" names what they will notice. Write the second one. Developers are the audience now, so the
operation's real name belongs in them — branch, commit, worktree, rename — but the sentence is still
about what changed for somebody using it.

## 5. Update the Homebrew cask

The cask lives in the tap repository, `AadiXC0DE/homebrew-tap`. `Casks/graphe.rb` in this
repository is the template it is copied from. Its `version` and both `sha256` values are the
placeholder `REPLACED_BY_RELEASE_WORKFLOW` and must stay that way: a checksum committed beside the
source goes stale the next time anything is built.

The release workflow opens that pull request for you when the `TAP_TOKEN` secret is set — a
fine-grained personal access token with contents and pull-request write on the tap. Without it the
workflow says so and the release still publishes; then do it by hand:

```bash
shasum -a 256 release/Graphe-<version>-arm64.zip
shasum -a 256 release/Graphe-<version>-x64.zip
```

In the tap's `Casks/graphe.rb`, update `version` and both `sha256` values. Either way, review and
merge the pull request, then, from a clean machine or after `brew uninstall --cask graphe`:

```bash
brew tap AadiXC0DE/tap
brew install --cask graphe
open -a Graphe
```

**A note on the dialog, because Homebrew 6 changed the ground rules.** Older Homebrew did not
set the quarantine attribute on cask downloads, which is why this file claimed a no-dialog
install. Homebrew 6.0 (June 2026) applies the quarantine attribute to cask installs, so an app
that is only ad-hoc signed and not notarized will now show a Gatekeeper prompt on first launch
regardless of how it was installed. Do not fight this from the cask — no `no_quarantine`, no
xattr stripping in a postflight. The only real fix is notarization (the $99 route described below).
Until then, a first-time user allows the app with "Open Anyway" (System Settings → Privacy &
Security), or right-click → Open in Finder.

**A quick check that the install is sane** — the signature must still verify (it does not matter
that Gatekeeper prompts):

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Graphe.app
spctl --assess --type execute /Applications/Graphe.app   # will say "rejected": expected, not notarized
xattr -p com.apple.quarantine /Applications/Graphe.app   # present on Homebrew 6: expected, not a bug
```

---

## Signing, said once and plainly

- `mac.identity: null` in `electron-builder.yml` turns Apple code signing off.
- `scripts/adhoc-sign.mjs` then runs `codesign --sign -` on the packed app, because
  electron-builder's own rewriting invalidates the signature Electron shipped with, and an
  **unsigned app does not launch on Apple Silicon at all** — no dialog, no message, just a process
  that dies.
- `CSC_IDENTITY_AUTO_DISCOVERY=false` is set by the packaging script so that a machine which happens
  to have a Developer ID in its keychain does not quietly produce a differently-signed build from
  the one the release workflow produces.

None of this is notarization. A browser download will still be quarantined and will still send the
user to System Settings. That is the known cost of the free route, and the reason the alpha's
install instructions are a `brew install` line.

When we do pay the $99: set `mac.identity` to the Developer ID, turn `hardenedRuntime` back on, add
an entitlements file, and add a notarization step. `scripts/adhoc-sign.mjs` becomes unnecessary and
should be deleted rather than left in as a fallback.

---

## Third-party licences

`THIRD-PARTY-LICENSES.md` is generated from the real dependency tree by
`scripts/third-party-licenses.mjs`. It carries the fingerprint of the `package-lock.json` it was
generated from, and a run whose lockfile still matches writes nothing — so it no longer shows up as
a change after every release. `--force` rebuilds it anyway. It is committed so the repository and
the shipped app agree, and CI runs:

```bash
npm run licenses:check
```

which fails if the file on disk was generated from a different lockfile, or no longer matches the
tree. The generated file and
`THIRD-PARTY-NOTICES.md` are both copied into the app bundle at `Contents/Resources/`.

## Windows and Linux

No build, and none promised. `electron-builder.js` configures `mac` targets only, so `npm run
package` produces Mac artifacts and nothing else.

Nothing in the app is deliberately Mac-only — the window chrome and the quit behaviour already
branch on `process.platform`, and Electron itself runs everywhere — so a source build elsewhere is
plausible. It is also untested, and at least one thing is outright Mac-only: opening a file in an
editor shells out to `open -a`. Somebody who wants to try has the source and the licence; that is a
different sentence from a supported platform, and neither the site nor this file should blur the
two.

Adding one properly means a `win`/`linux` block, icons, an install route for each, and somebody
running it on those machines before it is offered. Mac first, done properly.
