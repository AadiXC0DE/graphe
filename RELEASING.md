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
npm run check            # if the project has one; otherwise: npm test && npm run typecheck
npm run package          # builds, licences, packages, and verifies
```

Then upload `release/Graphe-<version>-{arm64,x64}.{dmg,zip}` to a GitHub release tagged `v<version>`,
and update the cask.

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

## 4. Tag and publish

```bash
git tag v<version>
git push origin v<version>
gh release create v<version> \
  release/Graphe-<version>-arm64.dmg \
  release/Graphe-<version>-arm64.zip \
  release/Graphe-<version>-x64.dmg \
  release/Graphe-<version>-x64.zip \
  --title "Graphe <version>" \
  --notes-file <(git log --oneline "$(git describe --tags --abbrev=0 HEAD^)"..HEAD)
```

Release notes are for designers. "Fixed a race in the event relay" means nothing to them; "the
conversation no longer jumps to the bottom while you are reading" does.

## 5. Update the Homebrew cask

The cask lives in the tap repository, `AadiXC0DE/homebrew-tap`. `Casks/graphe.rb` in this
repository is the template it is copied from.

```bash
shasum -a 256 release/Graphe-<version>-arm64.zip
shasum -a 256 release/Graphe-<version>-x64.zip
```

In the tap's `Casks/graphe.rb`, update `version` and both `sha256` values. Then, from a clean
machine or after `brew uninstall --cask graphe`:

```bash
brew tap AadiXC0DE/tap
brew install --cask graphe
open -a Graphe
```

**It must open with no dialog at all.** If Gatekeeper appears, something set the quarantine
attribute — check that the download came from Homebrew and not from a browser, and check that the
ad-hoc signature survived:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Graphe.app
spctl --assess --type execute /Applications/Graphe.app   # will say "rejected": expected, not notarized
xattr -p com.apple.quarantine /Applications/Graphe.app   # should say: No such xattr
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
  the one CI produces.

None of this is notarization. A browser download will still be quarantined and will still send the
user to System Settings. That is the known cost of the free route, and the reason the alpha's
install instructions are a `brew install` line.

When we do pay the $99: set `mac.identity` to the Developer ID, turn `hardenedRuntime` back on, add
an entitlements file, and add a notarization step. `scripts/adhoc-sign.mjs` becomes unnecessary and
should be deleted rather than left in as a fallback.

---

## Third-party licences

`THIRD-PARTY-LICENSES.md` is generated from the real dependency tree by
`scripts/third-party-licenses.mjs`, and packaging regenerates it every time. It is committed so the
repository and the shipped app agree, and CI should run:

```bash
npm run licenses:check
```

which fails if the file on disk no longer matches the tree. The generated file and
`THIRD-PARTY-NOTICES.md` are both copied into the app bundle at `Contents/Resources/`.

## Windows and Linux

Not yet — G6 in the backlog. Mac first, done properly.
