# Homebrew cask for a personal tap (issue #212). See packaging/README.md §3:
# the official homebrew/cask repo no longer accepts apps that fail Gatekeeper,
# and the macOS build is not yet signed + notarized, so publish this from a
# tap repo (Razee4315/homebrew-tap) until it is.
cask "paperling" do
  version "1.0.51"
  sha256 "9e35edc90ce0db0c0cacbb2aa2f00d24f473e00490367361c4ee976fa5b054cf"

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
