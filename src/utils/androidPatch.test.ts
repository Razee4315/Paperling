// Exercise the patch against a generated-template fixture twice. Kotlin
// compilation and device behavior are verified separately by Android CI.
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

describe("Android generated activity (#252/#253/#254)", () => {
    it("patches UI-thread bridge checks and reserves IME space idempotently", () => {
        const dir = mkdtempSync(join(tmpdir(), "paperling-android-patch-"));
        try {
            const main = join(dir, "app/src/main");
            mkdirSync(join(main, "java/test"), { recursive: true });
            writeFileSync(join(main, "AndroidManifest.xml"), '<manifest><application><activity android:name=".MainActivity">\n</activity></application></manifest>');
            const file = join(main, "java/test/MainActivity.kt");
            writeFileSync(file, 'package test\nimport android.os.Bundle\nclass MainActivity : TauriActivity() {\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n  }\n}\n');
            writeFileSync(join(dir, ".paperling-icons-padded"), "fixture");
            const run = () => execFileSync(process.execPath, ["scripts/patch-android-open-with.mjs", dir], { encoding: "utf8" });
            run();
            const activity = readFileSync(file, "utf8");
            for (const method of ["openDocument", "saveToDownloads"]) {
                expect(activity).toMatch(new RegExp(`fun ${method}\\([^]*?runOnUiThread \\{[^]*?isAppOrigin`));
            }
            expect(activity).toContain("maxOf(bars.bottom, ime.bottom)");
            expect(activity).toContain('uri.host == "tauri.localhost"');
            expect(activity).toContain("reportPickerError");
            run();
            expect(readFileSync(file, "utf8")).toBe(activity);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
