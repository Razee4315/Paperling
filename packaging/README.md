# Packaging & distribution

Manifests and a playbook for getting Paperling into package managers. Each
registry is a discovery channel — people search/browse them, and a one-line
install removes friction. **winget** is the highest-value target for Windows;
do that one first.

> When a new version ships, bump `PackageVersion` / `version` and the
> `InstallerUrl` / `url`, then recompute the installer hash:
>
> ```powershell
> # Windows
> (Get-FileHash .\Paperling_<ver>_x64-setup.exe -Algorithm SHA256).Hash
> ```
> ```bash
> # macOS/Linux
> sha256sum Paperling_<ver>_x64-setup.exe
> ```

---

## 1. winget (Windows) — ready to submit ✅

Files: [`winget/`](./winget/) — three manifests for `Razee4315.Paperling` v1.0.51,
targeting the per-user NSIS `.exe` for **x64 and arm64**. Hashes are the SHA-256
digests GitHub publishes for the release assets; `winget validate` passes.

**Submit:**

1. Install the tooling and validate locally:
   ```powershell
   winget install wingetcreate
   winget validate --manifest packaging/winget
   # optional sandbox test:
   winget install --manifest packaging/winget
   ```
2. Fork [`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs) and
   copy these files to
   `manifests/r/Razee4315/Paperling/1.0.51/`.
3. Open a PR. Microsoft's bot validates the URL + hash and installs it in a
   sandbox; once merged, `winget install Razee4315.Paperling` works for everyone.

**Even easier** — let `wingetcreate` build & submit from the release:
```powershell
wingetcreate new "https://github.com/Razee4315/Paperling/releases/download/v1.0.51/Paperling_1.0.51_x64-setup.exe" "https://github.com/Razee4315/Paperling/releases/download/v1.0.51/Paperling_1.0.51_arm64-setup.exe"
# after the first version is merged, later releases are one line:
wingetcreate update Razee4315.Paperling -u <x64-setup.exe url> <arm64-setup.exe url> -v <version> --submit
```

> Tip: add a `wingetcreate update ... --submit` step to `release.yml` so every
> release auto-opens the winget PR. (Needs a PAT with access to your fork.)

---

## 2. Scoop (Windows)

File: [`scoop/paperling.json`](./scoop/paperling.json).

Releases include a **portable zip** — `Paperling_<version>_x64-portable.zip`,
built by `scripts/make-portable-zip.ps1` in `release.yml` (the unpacked
`Paperling.exe` plus any runtime DLLs, at the zip root). The manifest pins
v1.0.51's portable zip and `autoupdate` follows new releases, so there is no
installer-extraction hack left, which makes it eligible for the Scoop
`extras` bucket.

To publish: create a bucket repo (e.g. `Razee4315/scoop-bucket`), drop the JSON
in, then `scoop bucket add paperling https://github.com/Razee4315/scoop-bucket`.

---

## 3. Roadmap — other channels (high discovery value)

| Channel | Platform | Effort | Notes |
|---|---|---|---|
| **Chocolatey** | Windows | Low | Installer-native. A `.nuspec` + `chocolateyInstall.ps1` that downloads the `.exe` and runs `/S`. Big audience. |
| **Flathub** | Linux | Medium | Largest Linux app store. Needs a flatpak manifest (can wrap the existing build). Huge organic discovery. |
| **AUR** | Arch Linux | Low | A `PKGBUILD` (`paperling-bin`) pointing at the `.AppImage` or `.deb`. The Arch crowd finds apps here. |
| **Microsoft Store** | Windows | Medium | Free for individuals; massive built-in search. Package the MSI/MSIX. |
| **apt repository** | Debian/Ubuntu | Medium | The `.deb` already ships with each release. A real `apt install` needs a signed repo (e.g. GitHub Pages + `reprepro`, or a hosted service like Cloudsmith/packagecloud) and a GPG key the owner controls. |
| **F-Droid** | Android | High | F-Droid builds every app from source on its own servers; the Tauri Android build (Rust + bun + Gradle) would need an F-Droid build recipe and reproducible output. Obtainium / the release `.apk` cover sideloading meanwhile. |

---

## 4. Homebrew (macOS) — tap-ready

File: [`homebrew/paperling.rb`](./homebrew/paperling.rb) — a cask for the
universal `.dmg` (Apple Silicon + Intel), v1.0.51, with the release digest.

The official `homebrew/cask` repository no longer accepts apps that fail
Gatekeeper, and the macOS build is not signed + notarized yet, so publish it
from a personal tap:

```bash
# one-time: create the GitHub repo Razee4315/homebrew-tap, add Casks/paperling.rb
brew tap razee4315/tap
brew install --cask paperling
brew audit --cask --online razee4315/tap/paperling   # before each publish
```

Once the app is notarized (Apple Developer ID + `APPLE_*` secrets in
`release.yml`), the same file can go to `homebrew/cask` and the caveat can go.

---

## Files

```
packaging/
├── winget/
│   ├── Razee4315.Paperling.yaml                # version manifest
│   ├── Razee4315.Paperling.installer.yaml      # installer + sha256
│   └── Razee4315.Paperling.locale.en-US.yaml   # metadata
├── scoop/
│   └── paperling.json
└── homebrew/
    └── paperling.rb
```

---

## 9. Nix

File: [`flake.nix`](../flake.nix) (issue #117).

Builds the full app (frontend via `bun`, Rust crate via
`rustPlatform.buildRustPackage`) against the GTK/WebKit stack from nixpkgs.
Verified in CI by `.github/workflows/nix-build.yml` on every `flake.nix` or
Cargo lock change.

```sh
# run it
nix run github:Razee4315/Paperling

# or build
nix build github:Razee4315/Paperling#paperling
```

A `flake.lock` is intentionally not committed; Nix generates one on first
use. Pin by setting an input URL with a rev if you need reproducibility.
