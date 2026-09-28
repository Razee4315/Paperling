// The main window is created hidden (visible:false in tauri.conf.json) and
// revealed from the frontend. Tauri's ACL denies window.show()/setFocus()
// unless the capability file grants them — and that denial once shipped as an
// app whose window could NEVER appear (the reveal's catch swallowed the
// "not allowed by ACL" rejection; process ran invisibly in the background).
// Frontend tests can't exercise the ACL itself, so this pins the contract:
// if the window starts hidden, the reveal permissions must be granted.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) =>
    JSON.parse(readFileSync(resolve(__dirname, "../../", rel), "utf8"));

describe("hidden-window reveal contract", () => {
    it("grants the permissions revealMainWindow needs whenever the window starts hidden", () => {
        const conf = read("src-tauri/tauri.conf.json");
        const startsHidden = conf.app.windows.some(
            (w: { visible?: boolean }) => w.visible === false,
        );
        if (!startsHidden) return; // visible windows need no reveal

        const caps = read("src-tauri/capabilities/default.json");
        const perms = caps.permissions.filter(
            (p: unknown): p is string => typeof p === "string",
        );
        expect(perms).toContain("core:window:allow-show");
        expect(perms).toContain("core:window:allow-set-focus");
    });
});
