# Homebrew cask for Graphe. A template — see the FILL IN markers below.
#
# ## Why this is the launch route
#
# Homebrew does not set `com.apple.quarantine` on what it downloads. Browsers
# and mail clients do. That one difference is the whole reason Graphe can ship
# without an Apple Developer Program membership: an app installed through this
# cask launches with no Gatekeeper dialog at all, while the same .dmg downloaded
# in Safari sends the user into System Settings to allow it by hand.
#
# The app is ad-hoc signed (`codesign --sign -`), which is what Apple Silicon
# requires and what costs nothing. It is not notarized, and this file must not
# pretend otherwise — no `no_quarantine` flag, no xattr stripping in a postflight
# block. Both of those exist to work around the dialog, and neither is needed
# here; a cask that quietly disarms Gatekeeper for its users is a cask that
# should not be trusted, and Homebrew's own reviewers say so.
#
# See notes/strategy/ARCHITECTURE.md, "Can we ship without paying Apple?".
#
# ## Where this file goes
#
# Not here. This is the template kept beside the source. At release time it is
# copied into the tap repository — `AadiXC0DE/homebrew-tap`, as
# `Casks/graphe.rb` — because Homebrew only reads casks from a tap. Then:
#
#     brew tap AadiXC0DE/tap
#     brew install --cask graphe
#
# Moving to homebrew-cask proper needs a stable release history and a project
# that is not obviously pre-1.0, so it is a later conversation.
#
# ## FILL IN at every release
#
#   1. `version`  — must match package.json exactly. The url interpolates it.
#   2. `sha256`   — one per architecture, from the *zip* files, not the dmg:
#
#          shasum -a 256 release/Graphe-<version>-arm64.zip
#          shasum -a 256 release/Graphe-<version>-x64.zip
#
#      Or from a published release, which is what CI should be trusted for:
#
#          brew fetch --cask ./Casks/graphe.rb   # prints what it got
#
#   3. `url`      — only if the GitHub owner or repository name changes.
#
# RELEASING.md walks the whole thing through in order.

cask "graphe" do
  # The zip, not the dmg. Homebrew can install from either, but a dmg has to be
  # mounted and unmounted for every install and upgrade, and the zip is the
  # smaller download of the two.
  arch arm: "arm64", intel: "x64"

  version "0.0.1"                     # FILL IN — match package.json
  sha256 arm:   "0000000000000000000000000000000000000000000000000000000000000000", # FILL IN
         intel: "0000000000000000000000000000000000000000000000000000000000000000"  # FILL IN

  url "https://github.com/AadiXC0DE/graphe/releases/download/v#{version}/Graphe-#{version}-#{arch}.zip",
      verified: "github.com/AadiXC0DE/graphe/"
  name "Graphe"
  desc "Gentle coding agent for designers"
  homepage "https://github.com/AadiXC0DE/graphe"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Graphe is pre-1.0 and its window is the entire product, so an old copy is a
  # different product. Say so rather than letting people sit on the first build.
  auto_updates false
  depends_on macos: ">= :monterey"

  app "Graphe.app"

  # What Graphe leaves behind on this machine, so `brew uninstall --zap` really
  # does remove it. Deliberately *not* listed: `~/.pi`, which holds the account
  # the user connected and belongs to Pi rather than to us, and no project
  # folder anywhere — those are the user's own work and nothing we install may
  # ever remove them.
  zap trash: [
    "~/Library/Application Support/Graphe",
    "~/Library/Caches/xyz.graphe",
    "~/Library/Preferences/xyz.graphe.plist",
    "~/Library/Saved Application State/xyz.graphe.savedState",
  ]

  caveats <<~EOS
    Graphe is signed, but not notarized by Apple — we have not paid for a
    developer account yet. Installing it this way is fine: Homebrew downloads
    without marking the file as quarantined, so it opens normally.

    Downloading the same app in a browser does not, and macOS will ask you to
    allow it in System Settings first.
  EOS
end
