// INST-01: the Windows NSIS installer must refuse a PC it can't run on. Both
// setup.exe files are x86 programs, so the arm64 one used to install an ARM64
// paperling.exe on Intel/AMD PCs and claim .md files; every double-click then
// hit Windows' "This app can't run on your PC". The guard lives in
// src-tauri/windows/installer-hooks.nsh. CI has no NSIS compiler outside the
// Tauri build, so this pins the invariants that make the guard actually run.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const conf = JSON.parse(readFileSync(resolve(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
const hooksRel: string | undefined = conf.bundle?.windows?.nsis?.installerHooks;
const hooksPath = hooksRel ? resolve(ROOT, "src-tauri", hooksRel) : "";
const hooks = hooksPath && existsSync(hooksPath) ? readFileSync(hooksPath, "utf8") : "";
// Code only: comments may mention ${ARCH} freely.
const code = hooks
    .split(/\r?\n/)
    .filter((l) => !/^\s*;/.test(l))
    .join("\n");

describe("Windows installer architecture guard (INST-01)", () => {
    it("is wired into the NSIS bundle and the file exists", () => {
        expect(hooksRel).toBeTruthy();
        expect(existsSync(hooksPath)).toBe(true);
    });

    it("stays ASCII so makensis reads it the same on every runner", () => {
        expect(/^[\x00-\x7F]*$/.test(hooks)).toBe(true);
    });

    it("has a guard function for every arch Tauri can bundle", () => {
        for (const arch of ["x64", "arm64", "x86"]) {
            expect(code).toMatch(new RegExp(`^Function PaperlingArchGuard_${arch}$`, "m"));
        }
    });

    it("runs the guard before the first page and again before files are copied", () => {
        expect(code).toMatch(/^!define MUI_CUSTOMFUNCTION_GUIINIT "\$\{PAPERLING_ARCH_GUARD\}"$/m);
        expect(code).toMatch(/!macro NSIS_HOOK_PREINSTALL\s+Call "\$\{PAPERLING_ARCH_GUARD\}"/);
    });

    it("reads ${ARCH} only through the lazily expanded define", () => {
        // Tauri includes the hooks before it defines ARCH; any other direct
        // use would compile to the literal text "${ARCH}".
        const uses = code.match(/\$\{ARCH\}/g) ?? [];
        expect(uses).toHaveLength(1);
        expect(code).toMatch(/^!define PAPERLING_ARCH_GUARD "PaperlingArchGuard_\$\{ARCH\}"$/m);
    });

    it("stops the ARM64 build on anything but a native ARM64 PC", () => {
        const arm64 = code.slice(code.indexOf("Function PaperlingArchGuard_arm64"));
        expect(arm64.slice(0, arm64.indexOf("FunctionEnd"))).toMatch(
            /\$\{IfNot\} \$\{IsNativeARM64\}[\s\S]*Call PaperlingWrongPC/,
        );
    });
});
