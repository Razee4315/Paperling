# Tracking upstream (`Razee4315/Paperling`)

This repository is a **fork** of [Razee4315/Paperling](https://github.com/Razee4315/Paperling)
that adds a Simplified-Chinese interface and a few fixes. `origin` is the owner's
own Gitea (`norden/paperling`); `upstream` is the original project.

The rule this doc exists for: **take upstream's upgrades, keep our changes, and
never write anything back to upstream.**

---

## Remotes

| Remote | URL | Use |
|---|---|---|
| `origin` | `ssh://git@localhost:2222/norden/paperling.git` | Clone / push / PRs (ours) |
| `upstream` | `https://github.com/Razee4315/Paperling.git` | **Fetch only** |

`upstream` has its **push URL disabled** (`git remote set-url --push upstream
DISABLED://never-push-to-upstream`), so an accidental `git push upstream` fails
instead of publishing our work. Leave that in place.

```bash
git remote -v
# upstream  https://github.com/Razee4315/Paperling.git (fetch)
# upstream  DISABLED://never-push-to-upstream (push)
```

---

## The recurring routine

```bash
# 1. See what upstream has that we don't.
git fetch upstream
git log --oneline HEAD..upstream/main        # incoming upstream commits
git log --oneline upstream/main..HEAD        # our local-only work

# 2. Merge it on a branch (never on main directly).
git checkout main && git pull
git checkout -b chore/upstream-sync-$(date +%F)
git merge upstream/main

# 3. Resolve conflicts (playbook below), then prove it still works:
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run

# 4. Commit the merge, push the branch, open a PR to origin and merge there.
git commit && git push -u origin chore/upstream-sync-$(date +%F)
```

`scripts/upstream-sync.sh` does steps 1–2 (fetch + branch + merge) and leaves the
conflicts for you. It never commits or pushes.

---

## One-time history repair (already done — 2026-10-12)

The fork was imported **without upstream's git history** (its root commit is
`ab34e95 "init repo"`), so `git merge upstream/main` used to fail with *"refusing
to merge unrelated histories"* and would have conflicted on every file.

The snapshot matches upstream at commit **`5fb5b14`** (27 Sep 2026) exactly,
except that `.github/` was removed. So we grafted the fork's root onto that
commit:

```bash
git replace --graft ab34e95 5fb5b14
```

and then merged `upstream/main` (`dca18cd`, v1.1.1) as commit **`6f63166`**,
which now has **both** histories as parents. From that point on the merge base
is a real upstream commit, so the routine above just works — no more grafts are
needed. (The `refs/replace/*` entry is local-only and cosmetic: it makes the old
history display with upstream ancestry. Losing it on a fresh clone changes
nothing about future merges.)

If you ever start a *new* fork from a tarball/zip again, the same trick is the
fix, but this repository no longer needs it.

---

## Conflict playbook

Most conflicts are "upstream redesigned X, we translated X". The default move is
**take upstream's structure, re-apply our `t()` calls on top** — never keep an
old layout just because it was already translated.

| File / area | Resolution |
|---|---|
| Components we translated (`TitleBar`, `SettingsMenu`, `SettingsModal`, …) | Upstream's structure + our `useI18n()`/`t()` labels. If upstream added new labels, add keys to **both** dictionaries. |
| `src/i18n/en.ts` / `zh-CN.ts` | Keep keys identical in both. `src/i18n/i18n.test.tsx` asserts key parity, no empty strings, and matching `{placeholders}` — run it first. |
| `.github/**` | **Take upstream's, do not delete it.** The fork's CI and the PR back to upstream both run on GitHub Actions; a branch that removes the workflows looks like it breaks CI. The early import dropped them, which is why they reappear in the 1.2.0 sync. |
| `src-tauri/Cargo.lock` | Take upstream's, then set the `[[package]] name = "paperling"` version to match `Cargo.toml`. |
| `package.json`, `CHANGELOG.md`, `AGENTS.md` | Usually auto-merges; on conflict keep **both** sides (upstream's release notes *and* our fork notes). |
| Audit reports, checklists, proof screenshots | Stay deleted (upstream dropped them, and `AGENTS.md` keeps them out of the repo); put that material in the PR description or the chat. |

### The i18n invariant

When upstream adds a user-visible string, it is **English and hard-coded**. To
keep the Chinese UI complete:

1. add a key to `src/i18n/en.ts` **and** `src/i18n/zh-CN.ts` (same key, both
   languages — `i18n.test.tsx` will fail otherwise), and
2. wire the component to `t("…")`.

Newly added English-only surfaces are acceptable short-term, but they are the one
thing that silently regresses the fork's whole reason for existing, so treat them
as a bug, not a nit.

---

## Fork features (do not lose these in a merge)

- Simplified-Chinese UI + the **Language** setting (`src/i18n/**`,
  `Settings → Appearance → 语言`, the `paperling:locale-change` event).
- Local-build fix (`bun run build:local`, `src-tauri/tauri.local.conf.json`).
- The non-ASCII image-path fix (`src/utils/resolveRelativePath`,
  `MarkdownPreview` decoding).

Keep fork work on `fix/…` / `feat/…` branches and merge into `main` via a PR on
`origin`. `main` should always be a descendant of `upstream/main` so the next
sync stays a clean 3-way merge.
