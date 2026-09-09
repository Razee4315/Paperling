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

Files: [`winget/`](./winget/) — three manifests for `Razee4315.Paperling` v0.6.21,
targeting the per-user NSIS `.exe`. The hash is already filled in and verified.

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
   `manifests/r/Razee4315/Paperling/0.6.21/`.
3. Open a PR. Microsoft's bot validates the URL + hash and installs it in a
   sandbox; once merged, `winget install Razee4315.Paperling` works for everyone.

**Even easier** — let `wingetcreate` build & submit from the release:
```powershell
wingetcreate update Razee4315.Paperling -u "https://github.com/Razee4315/Paperling/releases/download/v0.6.21/Paperling_0.6.21_x64-setup.exe" -v 0.6.21 --submit
```

> Tip: add a `wingetcreate update ... --submit` step to `release.yml` so every
> release auto-opens the winget PR. (Needs a PAT with access to your fork.)

---

## 2. Scoop (Windows)

File: [`scoop/paperling.json`](./scoop/paperling.json).

Releases now include a **portable zip** — `Paperling_<version>_x64-portable.zip`,
built by `scripts/make-portable-zip.ps1` in `release.yml` (the unpacked
`Paperling.exe` plus any runtime DLLs). The manifest's pinned version still
points at the legacy NSIS-installer extraction (the `#/dl.7z` trick) because a
hash can only be pinned for an existing file; `autoupdate` points at the
portable zip, so every new release installs the clean portable way — no
extraction hacks — which makes it eligible for the Scoop `extras` bucket.

To publish: create a bucket repo (e.g. `Razee4315/scoop-bucket`), drop the JSON
in, then `scoop bucket add paperling https://github.com/Razee4315/scoop-bucket`.

---

## 3. Roadmap — other channels (high discovery value)

| Channel | Platform | Effort | Notes |
|---|---|---|---|
| **Chocolatey** | Windows | Low | Installer-native. A `.nuspec` + `chocolateyInstall.ps1` that downloads the `.exe` and runs `/S`. Big audience. |
| **Flathub** | Linux | Medium | Largest Linux app store. Needs a flatpak manifest (can wrap the existing build). Huge organic discovery. |
| **AUR** | Arch Linux | Low | A `PKGBUILD` (`paperling-bin`) pointing at the `.AppImage` or `.deb`. The Arch crowd finds apps here. |
| **Homebrew cask** | macOS | Low | Needs a macOS build first (see below), then a one-file cask. |
| **Microsoft Store** | Windows | Medium | Free for individuals; massive built-in search. Package the MSI/MSIX. |

### Enabling macOS (unblocks Homebrew cask)
CI currently builds Windows + Linux only. To ship macOS, add a
`macos-latest` entry to the `release.yml` matrix — `tauri-action` will produce a
`.dmg`/`.app`. Unsigned builds work but warn on first launch; notarization
removes the warning.

---

## Files

```
packaging/
├── winget/
│   ├── Razee4315.Paperling.yaml                # version manifest
│   ├── Razee4315.Paperling.installer.yaml      # installer + sha256
│   └── Razee4315.Paperling.locale.en-US.yaml   # metadata
└── scoop/
    └── paperling.json
```
