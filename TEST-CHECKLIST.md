# Manual verification — PR review, 16 October 2026

Use the latest Windows Test Build linked in PR #283. These are owner checks on the native app; automated/browser coverage is listed separately in PR_REVIEW_2026-10-16.md.

- [ ] Open a note, choose **Options → Recent**, and open another recent note.
- [ ] Hover Recent and then click it: the submenu stays open and accepts a selection.
- [ ] Use arrows, Home and End inside Recent; Left/Escape returns to the parent, and Escape again closes Options.
- [ ] Confirm pinned notes appear first and identical filenames can be distinguished by their paths.
- [ ] Open Recent in a narrow window, then resize it; every entry remains reachable and the submenu does not cover its trigger.
- [ ] Edit a note without saving, open another recent note, then return: the unsaved text is preserved.
- [ ] Select a recent file that was moved or deleted: an error appears and the current note remains intact.
- [ ] Check Reader and Split views with math, a Mermaid diagram and a definition list.
- [ ] Save and reopen a note; confirm normal filesystem access works with the paired Tauri updates.
- [ ] Install the Windows setup build or launch the portable zip from the final Test Build.
- [ ] On Android, open and save a note using the final test APK; existing debug signing behavior is preserved.
- [ ] Browse the website homepage and Guide; try the feature search and download links.
- [ ] Confirm Actions storage contains the latest useful test downloads and shared caches, with no new PR-specific Rust cache copies.
