# Website verification — September 26, 2026

## Quick visual check

- [ ] Open the homepage on desktop and a phone. Check the Manrope headings, green/paper palette, the waving mascot beside the headline, the split-view app screenshot right under it, and the footer.
- [ ] Use “Take a look inside”; switch all three screenshot tabs (Paper, Light, Math & diagrams). Arrow keys, Home, and End should work when a tab has focus.
- [ ] Each of the three feature cards shows its hand-drawn icon (pencil, math, sparkles), and “And a few more things in the box” shows twelve icon cards: four across on desktop, two on a phone.
- [ ] The painting mascot leans on the corner of the story card, and the rocket mascot flies beside “Your next big idea.” in the green banner.
- [ ] Read “Made for myself. Shared with you.” Confirm the origin story reflects why you started Paperling.
- [ ] Open each comparison. A short introduction, comparison table, and brief recommendation should be enough to scan it.
- [ ] Expand Sources & review notes to inspect the official comparison sources.
- [ ] Open the mobile menu, follow a link, and use Escape to close it.
- [ ] Expand an FAQ answer and follow the download link to the official GitHub release.
- [ ] Browse Features, Guide, Shortcuts, Privacy, Open source, and What's new from the footer.
- [ ] Follow an unknown URL. The custom 404 shows the crumpled mascot and offers a working route home.
- [ ] Open Download (juggling mascot), Features (an icon on each card), and any feature page (its icon beside the heading).
- [ ] Enable reduced motion in your device settings. Decorative movement and smooth scrolling should stop.

## Automated checks

- `bun run check` in `docs/`: Astro and TypeScript diagnostics.
- `bun run test` in `docs/`: URL and route inventory regression tests.
- `node scripts/verify-site.mjs http://127.0.0.1:4327` in `docs/`: checks all 21 rendered pages during development.
- `bun run verify` in `docs/`: checks the production output, run in CI after building.
- Root `tsc --noEmit` and full Vitest suite with `--maxWorkers=2`.

The production verifier checks unique titles/descriptions, exact canonical and social URLs, one H1 per page, valid JSON-LD, internal pages/anchors, sitemap completeness, noindex 404, and the original Google verification file. Test Website uploads a 14-day artifact. Deploy docs to Pages repeats output verification before publishing.

## Scope

Website-only changes: `docs/` and its two Actions workflows. No app release, version bump, installer publication, or updater change. The original working directory and audit branch stay under the owner's control; development used a separate Git worktree.
