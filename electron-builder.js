// What a shipped Graphe is made of.
//
// Run it with `npm run package` — that script builds the window, builds the
// shell, regenerates the licence manifest and then calls electron-builder, in
// that order, because electron-builder packages what is on disk and will
// cheerfully ship yesterday's build.
//
// JavaScript rather than YAML because one part of it has to be worked out
// rather than written down: which dependencies are already compiled into the
// bundles and so must not be copied in a second time. See scripts/what-ships.mjs.
//
// ## Signing: ad-hoc, on purpose
//
// `identity: null` turns off Apple code signing entirely. We have not paid the
// $99 and are not pretending to have — see notes/strategy/ARCHITECTURE.md, "Can
// we ship without paying Apple?". The short version:
//
//   * Gatekeeper's "Apple cannot check it for malicious software" dialog is
//     triggered by the `com.apple.quarantine` attribute, and that attribute is
//     applied by whatever downloaded the file. Browsers set it. Homebrew and
//     curl do not. An app installed with `brew install --cask graphe` therefore
//     launches with no warning at all.
//   * Apple Silicon separately requires every binary to carry *a* signature.
//     An ad-hoc one satisfies it, costs nothing and needs no account.
//
// So the app is ad-hoc signed after packing, by scripts/adhoc-sign.mjs. Without
// that step an arm64 build is killed on launch, because electron-builder's
// rewriting invalidates the signature Electron shipped with. `identity: null`
// alone is not enough, and the failure is silent until somebody double-clicks.
//
// Homebrew is the deliberate distribution route for the alpha. The .dmg is built
// and published anyway, because a direct download is what people try first — it
// just costs them a trip through System Settings until we pay Apple.

import adhocSign from './scripts/adhoc-sign.mjs';
import { squeezeDiskImages } from './scripts/squeeze-dmg.mjs';
import { leaveOut, leaveOutTheLanguages } from './scripts/what-ships.mjs';

export default async function config() {
  return {
    appId: 'xyz.graphe',
    productName: 'Graphe',
    copyright: 'Copyright © 2026 Graphe contributors',

    directories: {
      output: 'release',
      buildResources: 'build',
    },

    // Everything the app needs and nothing else. Overriding this list is what
    // keeps src/, notes/ and the test suite out of the download.
    //
    // node_modules is not listed and does not need to be: electron-builder works
    // out the production dependency tree from package.json itself and copies
    // exactly that. `@earendil-works/pi-coding-agent` is a runtime dependency and
    // is left external by scripts/build-electron.mjs, so it has to arrive this
    // way — see scripts/verify-package.mjs, which checks that it actually did
    // rather than assuming.
    files: [
      'dist/**/*',
      'dist-electron/**/*',
      'package.json',
      // The shell's source maps are for reading a stack trace on this machine.
      // Nothing in a shipped app opens them, and they are larger than the code.
      '!dist-electron/*.map',
      // Pi ships its own docs, examples and changelog. They are ~4MB of Markdown
      // nobody can read from inside a packaged app.
      '!node_modules/@earendil-works/pi-coding-agent/{docs,examples}/**',
      '!node_modules/**/{test,tests,__tests__,example,examples}/**',
      '!node_modules/**/*.map',
      // Everything already compiled into dist/ and dist-electron/. Worked out
      // from the tree on disk, because a written list goes stale silently.
      ...(await leaveOut()),
    ],

    // Licences belong somewhere a person can open without unpacking an archive.
    extraResources: [
      'LICENSE',
      'THIRD-PARTY-NOTICES.md',
      'THIRD-PARTY-LICENSES.md',
      // The skills the app comes with. Read from disk at runtime, so they travel
      // unpacked rather than inside the archive.
      'skills',
    ],

    // Nothing in the tree compiles. The .node files that are in there are
    // prebuilt binaries belonging to Pi's terminal interface, which this app
    // never loads, and a rebuild against Electron's headers would be several
    // minutes spent producing the same files.
    npmRebuild: false,

    asar: true,
    // Pi is reached through a dynamic ESM import at runtime. Keeping it out of
    // the archive means that import resolves to an ordinary file on disk, which
    // is one fewer thing to be surprised by, and it is also where the prebuilt
    // .node files live — those cannot be loaded from inside an asar at all.
    asarUnpack: ['node_modules/@earendil-works/**'],

    // After packing, before the .dmg is built. The trim has to come first: it
    // changes bytes the signature covers.
    afterPack: async (context) => {
      await leaveOutTheLanguages(context);
      await adhocSign(context);
    },

    mac: {
      // It edits a folder, runs builds and talks to model providers. "Graphics &
      // Design" would read better against how Graphe is positioned, but the
      // category describes what the app does to a machine, not who it is for.
      category: 'public.app-category.developer-tools',
      icon: 'build/icon.icns',
      // Placeholder artwork — see build/README.md.
      darkModeSupport: true,
      identity: null,
      // Both of these are only meaningful with a real Developer ID, and leaving
      // them on makes electron-builder go looking for a keychain we do not have.
      hardenedRuntime: false,
      gatekeeperAssess: false,
      // No `arch` here on purpose. Pinning both against each target makes the
      // architecture the config's decision, so `--arm64` on the command line was
      // ignored and a quick look built the whole x64 side as well — twice the
      // work for a bundle that machine cannot run. `scripts/package-app.mjs`
      // names the architecture on every call and goes through both for a
      // release, so a build still produces exactly what it did before.
      target: [
        { target: 'dmg' },
        // The cask installs from the zip: Homebrew unpacks it without ever
        // setting the quarantine attribute, which is the whole reason the free
        // route works.
        { target: 'zip' },
      ],
      extendInfo: {
        // The microphone is offered because saying a change out loud is easier
        // than writing one, and only ever after a press. Nothing is recorded and
        // nothing is sent anywhere — the words are turned into text by the
        // system and land in the box for editing.
        //
        // Every other request is refused outright in electron/main.ts, so the
        // reason this list was pinned in the first place still holds: no
        // dependency can quietly acquire anything, including the microphone this
        // string names.
        NSMicrophoneUsageDescription:
          'Graphe listens only while you hold the button, so you can say a change instead of typing it.',
        NSCameraUsageDescription: false,
      },
    },

    dmg: {
      // Deliberately unconfigured. electron-builder's default disk image is
      // already the whole of what this one should be — the app on the left, a
      // link to /Applications on the right, and nothing else to read.
      //
      // In particular, do NOT set `title`. The default volume name carries the
      // architecture ("Graphe 0.0.1-arm64"); a fixed title gives both builds the
      // same name, and because the two architectures are packaged in parallel
      // they then race for the same /Volumes mount point. The loser is not an
      // error — it is a disk image that quietly comes out with no Applications
      // link in it, which nobody notices until somebody cannot install the app.
      // Ask how we know.
      window: { width: 540, height: 380 },
    },

    // The disk images are rewritten once more after they are built — a quarter
    // off the download, for a few seconds. See scripts/squeeze-dmg.mjs.
    afterAllArtifactBuild: squeezeDiskImages,

    // Artifact names that say what they are without a lookup table. Homebrew's
    // cask needs to write one of these out by hand, so they should be guessable.
    artifactName: '${productName}-${version}-${arch}.${ext}',

    // Nothing is published from a developer's machine. Releases are built in CI
    // and uploaded to GitHub Releases deliberately — see RELEASING.md.
    publish: null,
  };
}
