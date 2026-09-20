# Homebrew cask for Graphe. A template: the version and the checksums are
# written by the release workflow, and everything else is decided here.
#
# ## Why this is the launch route
#
# Homebrew and browser downloads can be quarantined by macOS. This app is not
# notarized, so first launch may require approval in Privacy & Security.
#
# The app is ad-hoc signed (`codesign --sign -`), which is what Apple Silicon
# requires and what costs nothing. It is not notarized, and this file must not
# pretend otherwise — no `no_quarantine` flag, no xattr stripping in a postflight
# block. A cask that quietly disarms Gatekeeper for its users is a cask that
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
# ## What the release workflow fills in
#
# `version` and the two `sha256` values are placeholders here and are written by
# the workflow from the zips it just built. They are deliberately not real: a
# checksum committed beside the source is a checksum that goes stale the next
# time anything is built, and a cask carrying a version's name over another
# version's bytes is the one thing a cask must never do.
#
# To try it by hand, fill them in locally and do not commit that:
#
#     shasum -a 256 release/Graphe-<version>-arm64.zip
#     shasum -a 256 release/Graphe-<version>-x64.zip
#
# `url` changes only if the GitHub owner or repository name does.
#
# RELEASING.md walks the whole thing through in order.

cask "graphe" do
  # The zip, not the dmg. Homebrew can install from either, but a dmg has to be
  # mounted and unmounted for every install and upgrade, and the zip is the
  # smaller download of the two.
  arch arm: "arm64", intel: "x64"

  version "REPLACED_BY_RELEASE_WORKFLOW"
  sha256 arm:   "REPLACED_BY_RELEASE_WORKFLOW",
         intel: "REPLACED_BY_RELEASE_WORKFLOW"

  url "https://github.com/AadiXC0DE/graphe/releases/download/v#{version}/Graphe-#{version}-#{arch}.zip",
      verified: "github.com/AadiXC0DE/graphe/"
  name "Graphe"
  desc "Agentic coding platform for the desktop"
  homepage "https://github.com/AadiXC0DE/graphe"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Graphe's window is the entire product, so an old copy is a different
  # product. Say so rather than letting people sit on the build they installed.
  auto_updates false
  depends_on macos: :ventura

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
    Graphe is ad-hoc signed, not notarized by Apple. On first launch macOS
    may require approval through "Open Anyway" in System Settings,
    Privacy & Security. This cask does not bypass Gatekeeper.
  EOS
end
