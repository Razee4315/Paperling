#!/usr/bin/env node
/**
 * Patch the Tauri-generated Android Gradle project so RELEASE builds are
 * SIGNED.
 *
 * Why: `tauri android init` generates app/build.gradle.kts from the CLI
 * template, and that template's `release` build type has **no signingConfig at
 * all** — a plain release build produces an UNSIGNED APK, which Android
 * refuses to install. This script injects a signingConfig that:
 *   - reads `keystore.properties` from the project root when it exists
 *     (real release signing path — put your keystore details there), or
 *   - falls back to Android's DEBUG key, which the Android Gradle Plugin
 *     generates itself on first use. Nobody has to handle a signing secret
 *     for a CI test build; the artifact is a test APK, never a release.
 *
 * Kotlin DSL traps baked into the inserted code (each one is a compile error
 * six minutes into a build):
 *   - `Properties()` must resolve via a top-level `import java.util.Properties`
 *     — bare `java.util.Properties()` fails because `java` resolves to the
 *     Java plugin extension inside .gradle.kts. The import is prepended here.
 *   - `Properties` values are read with `getProperty(...)` — `props["k"] as
 *     String` is flagged "No cast needed" (an error) on a platform type.
 *
 * Idempotent: a marker comment guards re-runs. Fail-loud: if the expected
 * anchors are missing (template drift), the file is dumped and we exit 1 so
 * CI fails at this step — not six minutes later inside Gradle.
 *
 * Usage: node patch-android-release-signing.mjs <path-to-build.gradle.kts>
 */

import { readFileSync, writeFileSync } from "node:fs";

const MARKER = "PAPERLING-RELEASE-SIGNING";
const SIGNING_CONFIGS_BLOCK = `\
    // ${MARKER}: release signing without a committed keystore. When
    // keystore.properties exists at the project root it is used verbatim;
    // otherwise the release build falls back to the debug key that the
    // Android Gradle Plugin generates itself, so a test APK is always
    // installable. A debug/test-key install cannot be upgraded in place by a
    // properly signed build — the first real release costs one uninstall.
    signingConfigs {
        create("release") {
            val ksFile = rootProject.file("keystore.properties")
            if (ksFile.exists()) {
                val ksProps = Properties()
                ksFile.inputStream().use { ksProps.load(it) }
                keyAlias = ksProps.getProperty("keyAlias")
                keyPassword = ksProps.getProperty("keyPassword")
                storeFile = file(ksProps.getProperty("storeFile"))
                storePassword = ksProps.getProperty("storePassword")
            }
        }
    }
`;

const RELEASE_SIGNING_LINE = `\
        // ${MARKER} (release): see the signingConfigs block above.
        signingConfig = if (rootProject.file("keystore.properties").exists())
            signingConfigs.getByName("release") else signingConfigs.getByName("debug")
`;

const path = process.argv[2];
if (!path) {
    console.error("Usage: node patch-android-release-signing.mjs <path-to-build.gradle.kts>");
    process.exit(1);
}

let content;
try {
    content = readFileSync(path, "utf8");
} catch (err) {
    console.error(`::error::Cannot read ${path}: ${err.message}`);
    process.exit(1);
}

if (content.includes(MARKER)) {
    console.log(`${path} is already patched (${MARKER}) — nothing to do.`);
    process.exit(0);
}

// ---- Anchor validation (fail loudly, with the file for debugging) ----
// (A pre-existing signingConfigs block is fine; the anchors we truly need
// are the buildTypes block and the release build type below.)
const fail = (msg) => {
    console.error(`::error::${msg}`);
    console.error(`----- ${path} -----`);
    console.error(content);
    process.exit(1);
};
if (!content.includes("buildTypes")) fail("Anchor `buildTypes` not found — the Tauri Android Gradle template changed; update this script.");
if (!/getByName\(\s*"release"\s*\)\s*\{/.test(content)) fail('Anchor `getByName("release") {` not found — the Tauri Android Gradle template changed; update this script.');

// ---- 1. Import for Properties (Kotlin DSL: bare `java.util.` is unusable) ----
let updated = content;
if (!/^import java\.util\.Properties$/m.test(updated)) {
    updated = `import java.util.Properties\n${updated}`;
}

// ---- 2. Insert the signingConfigs block right before `buildTypes {` ----
const buildTypesMatch = updated.match(/^([ \t]*)buildTypes\s*\{/m);
if (!buildTypesMatch) fail("Anchor `buildTypes {` (at line start) vanished after import insert.");
updated = updated.replace(buildTypesMatch[0], `${SIGNING_CONFIGS_BLOCK}${buildTypesMatch[0]}`);

// ---- 3. Insert the release signingConfig assignment as the FIRST statement ----
//       of the release build type. Signed release or no build at all.
const releaseMatch = updated.match(/getByName\(\s*"release"\s*\)\s*\{/);
if (!releaseMatch) fail('Anchor `getByName("release") {` vanished after signingConfigs insert.');
updated = updated.replace(releaseMatch[0], `${releaseMatch[0]}\n${RELEASE_SIGNING_LINE}`);

// ---- 4. Verify the patch actually landed ----
const occurrences = (updated.match(new RegExp(MARKER, "g")) ?? []).length;
if (occurrences < 2 || !updated.includes("signingConfig = if")) {
    fail("Patch did not apply cleanly (markers missing after write).");
}

writeFileSync(path, updated);
console.log(`Patched ${path}:`);
console.log("  + import java.util.Properties");
console.log("  + signingConfigs.release (keystore.properties, debug-key fallback)");
console.log("  + release buildType signingConfig");
