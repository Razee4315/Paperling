# Paperling Roadmap

A living, high-level view of where Paperling is headed. This is **directional, not
a promise** — priorities shift, and community input changes them. If something
here excites you, it's an open invitation to contribute. 🙌

New here? Start with [`good first issue`](https://github.com/Razee4315/Paperling/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
and read the [Contributing guide](CONTRIBUTING.md).

## 🟢 Now (in progress / just shipped)

- **AI assistant panel** — Ask + Agent modes with inline diff review. *(shipped)*
- **Editor core on CodeMirror 6** — fixes cursor drift and typing lag. *(shipped)*
- **Discovery & distribution** — landing page, package-manager manifests
  (winget/Scoop), SEO. *(in progress)*

## 🔵 Next

- **winget submission** so `winget install Razee4315.Paperling` works.
- **macOS builds** — add `macos-latest` to the release matrix and publish a
  `.dmg` (unblocks a Homebrew cask).
- **Portable Windows build** (zipped `.exe`) for first-class Scoop support.
- **Flathub** package for Linux discovery.

## 🟣 Later

- **Export polish** — PDF/HTML theming options, configurable page size.
- **More diagram/preview formats** as requested by users.
- **Per-folder workspace** niceties (recent folders, quick switch).
- **Accessibility pass** — screen-reader audit of the editor and dialogs.

## 💡 Ideas / discussion

These aren't committed — open or upvote an issue if you want one:

- Plugin/snippet system
- Sync or vault-style multi-file navigation
- Additional themes contributed by the community
- Localization / i18n

## How priorities are set

1. Bugs that affect everyday writing come first.
2. Then high-leverage discovery/distribution work (more users → more feedback).
3. Then features with clear demand (👍 on issues) and reasonable scope.

Have a different idea? [Open an issue](https://github.com/Razee4315/Paperling/issues/new/choose)
or start a discussion — early feedback shapes this list.
