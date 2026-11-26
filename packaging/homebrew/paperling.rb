# Homebrew cask for a personal tap (issue #212). See packaging/README.md §3:
# the official homebrew/cask repo no longer accepts apps that fail Gatekeeper,
# and the macOS build is not yet signed + notarized, so publish this from a
# tap repo (Razee4315/homebrew-tap) until it is.
cask "paperling" do
  version "1.3.0"
  sha256 "7cfe47f5764aafda0c38ca6f6f04aa62330941960cf8de03246e0e2ea0c9aedf"

  url "https://github.com/Razee4315/Paperling/releases/download/v#{version}/Paperling_#{version}_universal.dmg"
  name "Paperling"
  desc "Minimal Markdown reader and editor"
  homepage "https://github.com/Razee4315/Paperling"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Paperling.app"

  zap trash: [
    "~/Library/Application Support/com.saqla.marklite",
    "~/Library/Caches/com.saqla.marklite",
    "~/Library/Saved Application State/com.saqla.marklite.savedState",
    "~/Library/WebKit/com.saqla.marklite",
  ]

  caveats <<~EOS
    Paperling is not yet notarized by Apple. On first launch, right-click
    Paperling.app in Applications and choose Open.
  EOS
end
