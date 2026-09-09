#!/usr/bin/env node
/**
 * Patch the Tauri-generated Android project for three things the template lacks:
 *
 * 1. "Open with" / "Always" for .md files. Android delivers these as ACTION_VIEW
 *    intents carrying a content:// URI — there is no command line on Android, so
 *    the desktop CLI-arg path never sees them. This patch adds an intent-filter
 *    (text/markdown, text/x-markdown, text/plain) to the manifest and intent
 *    capture in MainActivity: the file is copied from the content resolver into
 *    the app's cache dir and a small incoming.json marker is written. The Rust
 *    command `get_incoming_file` hands that to the frontend (take-once), which
 *    opens it like any other note.
 *
 * 2. System-bar insets. The template calls enableEdgeToEdge(), so the webview
 *    draws UNDER the status and navigation bars, and Android WebView reports
 *    env(safe-area-inset-*) = 0 — the app bar controls ended up cramped against
 *    the status bar. The patch applies the real status/cutout/nav insets as
 *    PADDING on the window's content view, so the webview viewport starts below
 *    the status bar and above the gesture bar on every Android version
 *    (including 15+/16 where edge-to-edge cannot be opted out of).
 *
 * 3. System back (gesture / button) that behaves like an app. The template's
 *    default finishes the activity outright, so back with Settings open killed
 *    the whole editor. The patch routes back presses to the web app: the IME
 *    hides first, then the frontend's window.__paperlingBack() closes its
 *    topmost surface (menu, palette, settings, find bar, panels...) and reports
 *    `true`; only `false` (nothing left to close) finishes the activity.
 *
 * 4. Launcher icon safe zone. `tauri icon` ships a foreground that fills the
 *    whole 108dp adaptive-icon canvas, so launcher masks (a ~72dp circle or
 *    squircle) clipped the logo's outer strokes. The patch routes the
 *    foreground through an inset drawable that scales it into the safe zone.
 *
 * 5. Backup/exclusion rules. The AI API key file and the notes folder are
 *    excluded from cloud and device-to-device backups (Android 12+
 *    dataExtractionRules, plus legacy fullBackupContent for 10–11): the key
 *    must never leave the app sandbox, and the notes are local-first by
 *    design.
 *
 * The PaperlingAndroid JS bridge and every evaluateJavascript call are
 * origin-guarded to the app's tauri.localhost origin: Android's JS interface
 * has no origin model of its own (unlike Tauri's IPC), and a remote page must
 * never hold a native bridge or have app JS evaluated over it.
 *
 * Idempotent via markers; fails loudly (dumping the target file) if the
 * template anchors moved — same contract as patch-android-release-signing.mjs.
 *
 * Usage: node patch-android-open-with.mjs <gen/android>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const MANIFEST_MARKER = "PAPERLING-OPEN-WITH";
const ACTIVITY_MARKER = "PAPERLING-INIntent";

const INTENT_FILTER_XML = `\
            <!-- ${MANIFEST_MARKER}: appear in "Open with" for markdown and text files -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/markdown" />
                <data android:mimeType="text/x-markdown" />
                <data android:mimeType="text/plain" />
            </intent-filter>
`;

const ACTIVITY_IMPORTS = `\
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import org.json.JSONObject
`;

const ACTIVITY_BODY = `\
  // ${ACTIVITY_MARKER}: system-bar insets, "open with" handling, the app-style
  // back handler and the system document picker (CI patch).
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    applySystemBarInsets()
    setupBackHandler()
    attachDocumentBridge()
    handleOpenIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleOpenIntent(intent)
  }

  // Edge-to-edge is on (and forced on Android 15+), and the WebView reports
  // env(safe-area-inset-*) as 0 — so pad the window's content view with the
  // real status/cutout/nav insets. The webview viewport then starts below the
  // status bar and above the gesture bar; the web app needs no inset CSS.
  private fun applySystemBarInsets() {
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.statusBars()
          or WindowInsetsCompat.Type.displayCutout()
          or WindowInsetsCompat.Type.navigationBars()
      )
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  // System back, app-style. The default (finish the activity) made back with
  // Settings open close the whole editor. Order of precedence, matching how
  // Android apps behave:
  //   1. keyboard up  -> hide the IME (standard behaviour, never the app)
  //   2. web app says it closed its topmost surface (__paperlingBack() === true)
  //   3. otherwise the default: finish the activity (leave the app)
  private fun setupBackHandler() {
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val decor = window.decorView
        val insets = ViewCompat.getRootWindowInsets(decor)
        if (insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
          WindowCompat.getInsetsController(window, decor).hide(WindowInsetsCompat.Type.ime())
          return
        }
        val web = findWebView(decor)
        if (web == null) {
          finish()
          return
        }
        // A non-app page must never have app JS evaluated over it — and none
        // of the app's surfaces exist there anyway — so back simply leaves.
        if (!isAppOrigin(web)) {
          finish()
          return
        }
        web.evaluateJavascript(
          "(function(){try{if(window.__paperlingBack&&window.__paperlingBack()===true){return '1'}}catch(e){}return '0'})()"
        ) { result ->
          if (result?.trim('"') != "1") {
            finish()
          }
        }
      }
    })
  }

  // The Tauri webview is buried in the view hierarchy; walk it depth-first.
  private fun findWebView(v: View?): WebView? {
    if (v is WebView) return v
    if (v is android.view.ViewGroup) {
      for (i in 0 until v.childCount) {
        findWebView(v.getChildAt(i))?.let { return it }
      }
    }
    return null
  }

  // True when the given WebView is showing (or about to show) the app's own
  // content. Tauri serves the app from the tauri.localhost origin; a blank
  // page counts only while the app page is still committing into a fresh
  // webview. Every bridge entry point and every evaluateJavascript runs
  // behind this check: the Android JS interface and JS evaluation have no
  // origin model of their own, so the guard lives here.
  private fun isAppOrigin(web: WebView?): Boolean {
    if (web == null) return false
    val url = web.url ?: return false
    if (url == "about:blank") return true
    return url.startsWith("https://tauri.localhost") || url.startsWith("http://tauri.localhost")
  }

  // ==== Web <-> native bridge ====
  //
  // One JavascriptInterface ("PaperlingAndroid") exposes two native actions to
  // the web app: openDocument() (system SAF picker -> copied to app cache ->
  // delivered via __paperlingOpenFile) and saveToDownloads(name, content)
  // (MediaStore write to the user-visible Downloads folder, mirrored into the
  // app cache so the app can reopen and autosave the note).
  //
  // addJavascriptInterface only reaches pages that load AFTER the call, and
  // Tauri creates the webview (and starts loading) asynchronously well after
  // onCreate — so the attach retries until the webview exists and then reloads
  // the still-initializing page once. That reload happens before first paint
  // and is invisible; without it the interface never exists in the running
  // page and the picker reports "not available".
  private var documentBridgeAttached = false
  private var documentBridgeGaveUp = false
  private var documentBridgeReloaded = false
  private var documentBridgeRetries = 0
  private val requestOpenDocument = 4201

  private fun attachDocumentBridge() {
    if (documentBridgeAttached || documentBridgeGaveUp) return
    val web = findWebView(window.decorView)
    if (web == null) {
      documentBridgeRetries += 1
      if (documentBridgeRetries > 200) {
        documentBridgeGaveUp = true
        return
      }
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ attachDocumentBridge() }, 150)
      return
    }
    // addJavascriptInterface is NOT origin-aware (unlike Tauri's IPC): once
    // attached, ANY page this WebView loads can call it. Only ever attach over
    // the app's own origin, and give up permanently if foreign content is
    // showing — a remote page must never hold a native bridge. A null URL
    // means the first load hasn't committed yet; the retry loop handles it.
    val currentUrl = web.url
    if (currentUrl != null && currentUrl != "about:blank" && !isAppOrigin(web)) {
      documentBridgeGaveUp = true
      return
    }
    documentBridgeAttached = true
    web.addJavascriptInterface(object {
      @android.webkit.JavascriptInterface
      fun openDocument() {
        // Origin re-check at entry: a page that navigated away after attach
        // must not be able to drive native actions.
        if (!isAppOrigin(findWebView(window.decorView))) return
        runOnUiThread { launchDocumentPicker() }
      }

      @android.webkit.JavascriptInterface
      fun saveToDownloads(name: String, content: String, mime: String) {
        // Runs on the JS bridge thread — do the IO here, report on the UI one.
        if (!isAppOrigin(findWebView(window.decorView))) return
        performSaveToDownloads(name, content, mime)
      }
    }, "PaperlingAndroid")
    // Only pages loaded after addJavascriptInterface see it. If the app page
    // already started loading, one early reload puts the bridge in place.
    val url = web.url
    if (!documentBridgeReloaded && url != null && url != "about:blank") {
      documentBridgeReloaded = true
      web.evaluateJavascript("location.reload()", null)
    }
  }

  // True when the page is loaded far enough for evaluateJavascript to reach
  // the app's window (the __paperlingOpenFile stub is inline in <head>, so any
  // committed page has it).
  private fun pageReady(): Boolean {
    val web = findWebView(window.decorView) ?: return false
    val url = web.url ?: return false
    if (url == "about:blank") return false
    return web.progress >= 100
  }

  // Deliver an opened file to the web app over the JS bridge, waiting (up to
  // ~60s) for the bridge attach/reload and the first page load to settle. The
  // incoming.json marker written by handleOpenIntent stays as the boot-time
  // fallback; the app dedupes the two deliveries by tab path.
  private fun deliverToWebview(path: String, name: String, attempt: Int = 0) {
    if (attempt > 200) return
    val attached = documentBridgeAttached || documentBridgeGaveUp
    if (!attached || !pageReady()) {
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
        { deliverToWebview(path, name, attempt + 1) },
        300,
      )
      return
    }
    val js = "window.__paperlingOpenFile && window.__paperlingOpenFile(" +
      JSONObject.quote(path) + ", " + JSONObject.quote(name) + ")"
    webviewEval(js)
  }

  private fun launchDocumentPicker() {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      // "*/*", unfiltered: .md files are registered with every MIME under the
      // sun (octet-stream, text/plain, vendor types) — filtering would hide
      // exactly the files the user is looking for.
      type = "*/*"
    }
    startActivityForResult(intent, requestOpenDocument)
  }

  // "Save to Downloads": write into the shared Downloads collection via
  // MediaStore (no storage permission needed for the app's own inserts on
  // API 29+), then mirror the bytes into the app cache so the note has a real
  // path the Rust file commands can read (reopen, recents, autosave).
  // mime carries the file's type so exported HTML (unlike notes) opens in a
  // browser; anything blank or odd falls back to text/markdown.
  private fun performSaveToDownloads(rawName: String, content: String, rawMime: String) {
    try {
      if (android.os.Build.VERSION.SDK_INT < 29) throw IllegalStateException("Needs Android 10+")
      val safe = rawName.replace(Regex("[/\\\\\\\\:*?\\"<>|]"), "_")
      val mime = rawMime.trim().replace(Regex("[^A-Za-z0-9+./-]"), "").ifBlank { "text/markdown" }
      val values = android.content.ContentValues().apply {
        put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, safe)
        put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime)
        put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS)
      }
      val uri = contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IllegalStateException("Could not create the Downloads entry")
      contentResolver.openOutputStream(uri)?.use { out ->
        out.write(content.toByteArray(Charsets.UTF_8))
      } ?: throw IllegalStateException("Could not open the Downloads entry for writing")
      val actualName = queryDisplayName(uri) ?: safe
      val dir = File(cacheDir, "open")
      dir.mkdirs()
      val cache = File(dir, actualName)
      cache.writeText(content, Charsets.UTF_8)
      val js = "window.__paperlingOnSaveResult && window.__paperlingOnSaveResult(true, " +
        JSONObject.quote(cache.absolutePath) + ", " + JSONObject.quote(actualName) + ")"
      runOnUiThread { webviewEval(js) }
    } catch (e: Exception) {
      android.util.Log.e("Paperling", "Save to Downloads failed", e)
      val js = "window.__paperlingOnSaveResult && window.__paperlingOnSaveResult(false, " +
        JSONObject.quote(e.message ?: "Save failed") + ", null)"
      runOnUiThread { webviewEval(js) }
    }
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != requestOpenDocument) return
    val uri = if (resultCode == RESULT_OK) data?.data else null
    if (uri == null) {
      webviewEval("window.__paperlingPickDone && window.__paperlingPickDone(false)")
      return
    }
    try {
      val name = queryDisplayName(uri) ?: "picked.md"
      val safe = name.replace(Regex("[/\\\\\\\\:*?\\"<>|]"), "_")
      val dir = File(cacheDir, "open")
      dir.mkdirs()
      val outFile = File(dir, safe)
      contentResolver.openInputStream(uri)?.use { input ->
        outFile.outputStream().use { output -> input.copyTo(output) }
      } ?: run {
        webviewEval("window.__paperlingPickDone && window.__paperlingPickDone(false)")
        return
      }
      val js = "window.__paperlingOpenFile && window.__paperlingOpenFile(" +
        JSONObject.quote(outFile.absolutePath) + ", " + JSONObject.quote(safe) + ")"
      webviewEval(js)
    } catch (e: Exception) {
      android.util.Log.e("Paperling", "Failed to import the picked file", e)
      webviewEval("window.__paperlingPickDone && window.__paperlingPickDone(false)")
    }
  }

  // The single JS-injection point for picker/save callbacks. Foreign pages
  // get nothing evaluated over them (see isAppOrigin).
  private fun webviewEval(js: String) {
    val web = findWebView(window.decorView) ?: return
    if (!isAppOrigin(web)) return
    web.evaluateJavascript(js, null)
  }

  // A file manager "Open with Paperling" hands us a content:// URI the Rust
  // file commands cannot read. Copy it into the app-private cache, then
  // deliver it to the web app twice over, on purpose:
  //   - incoming.json as the boot-time fallback (get_incoming_file, take-once)
  //   - the JS bridge (__paperlingOpenFile) as the live path, which also
  //     covers warm starts where the boot pull already ran.
  // The app dedupes the two deliveries by tab path.
  private fun handleOpenIntent(intent: Intent?) {
    if (intent?.action != Intent.ACTION_VIEW) return
    val uri = intent.data ?: return
    try {
      val name = queryDisplayName(uri) ?: "opened.md"
      val safe = name.replace(Regex("[/\\\\\\\\:*?\\"<>|]"), "_")
      val dir = File(cacheDir, "open")
      dir.mkdirs()
      val outFile = File(dir, safe)
      contentResolver.openInputStream(uri)?.use { input ->
        outFile.outputStream().use { output -> input.copyTo(output) }
      } ?: return
      val payload = JSONObject()
      payload.put("path", outFile.absolutePath)
      payload.put("name", safe)
      File(cacheDir, "incoming.json").writeText(payload.toString())
      deliverToWebview(outFile.absolutePath, safe)
    } catch (e: Exception) {
      android.util.Log.e("Paperling", "Failed to import the opened file", e)
    }
  }

  private fun queryDisplayName(uri: Uri): String? {
    if (uri.scheme == "file") {
      val path = uri.path ?: return null
      return File(path).name
    }
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (idx >= 0) return cursor.getString(idx)
        }
      }
    } catch (e: Exception) {
      // Fall through to the last path segment.
    }
    return uri.lastPathSegment
  }
}
`;

const fail = (msg, content, path) => {
    console.error(`::error::${msg}`);
    console.error(`----- ${path} -----`);
    console.error(content);
    process.exit(1);
};

const genDir = process.argv[2];
if (!genDir) {
    console.error("Usage: node patch-android-open-with.mjs <gen/android>");
    process.exit(1);
}

// ---- 1. AndroidManifest.xml: VIEW intent-filter ----
const manifestPath = join(genDir, "app", "src", "main", "AndroidManifest.xml");
let manifest;
try {
    manifest = readFileSync(manifestPath, "utf8");
} catch (err) {
    console.error(`::error::Cannot read ${manifestPath}: ${err.message}`);
    process.exit(1);
}

if (manifest.includes(MANIFEST_MARKER)) {
    console.log(`${manifestPath}: already patched (${MANIFEST_MARKER})`);
} else {
    const activityClose = "</activity>";
    if (!manifest.includes(activityClose)) {
        fail("Anchor `</activity>` not found in AndroidManifest.xml — the Tauri template changed; update this script.", manifest, manifestPath);
    }
    manifest = manifest.replace(activityClose, `${INTENT_FILTER_XML}    ${activityClose}`);
    if (!manifest.includes(MANIFEST_MARKER)) fail("Manifest patch did not apply (marker missing).", manifest, manifestPath);
    writeFileSync(manifestPath, manifest);
    console.log(`Patched ${manifestPath}: + VIEW intent-filter (markdown/text)`);
}

// ---- 1b. AndroidManifest.xml: keep secrets and notes out of backups ----
//
// Android's auto-backup uploads app-private files to the user's Google Drive
// backup by default. Two things must never ride along:
//   - the AI API key file (plaintext inside the app sandbox by design — it
//     must never leave it), and
//   - the notes folder ("everything lives on this device" is the product's
//     privacy promise; the welcome note says so).
// dataExtractionRules governs Android 12+; fullBackupContent covers 10–11
// (minSdk 24: Android 6–9 don't back up internal app storage at all, so
// there is nothing to exclude there). The attributes are also what an
// allowBackup="true" default needs to be safe; the template sets none of
// them, which is exactly why this patch exists.
const BACKUP_RULES_MARKER = 'android:dataExtractionRules="@xml/paperling_data_extraction_rules"';
const BACKUP_RULES_XML = `\
<?xml version="1.0" encoding="utf-8"?>
<!-- PAPERLING-BACKUP-RULES: keep the AI key and the private notes out of
     cloud/device backups — the key must never leave the app sandbox, and
     the notes are local-first by design. -->
<full-backup-content>
    <exclude domain="file" path="ai-key" />
    <exclude domain="file" path="notes/" />
</full-backup-content>
`;
const EXTRACTION_RULES_XML = `\
<?xml version="1.0" encoding="utf-8"?>
<!-- PAPERLING-BACKUP-RULES: Android 12+ counterpart of
     paperling_backup_rules.xml (cloud backups and device-to-device
     migration). -->
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="file" path="ai-key" />
        <exclude domain="file" path="notes/" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="file" path="ai-key" />
        <exclude domain="file" path="notes/" />
    </device-transfer>
</data-extraction-rules>
`;

manifest = readFileSync(manifestPath, "utf8");
if (manifest.includes(BACKUP_RULES_MARKER)) {
    console.log(`${manifestPath}: backup rules already patched`);
} else {
    const appTag = /<application\b[^>]*>/;
    if (!appTag.test(manifest)) {
        fail("Anchor `<application …>` not found in AndroidManifest.xml — the Tauri template changed; update this script.", manifest, manifestPath);
    }
    const backupAttrs =
        `\n    android:fullBackupContent="@xml/paperling_backup_rules"` +
        `\n    ${BACKUP_RULES_MARKER}`;
    manifest = manifest.replace(appTag, (tag) => tag.slice(0, -1) + backupAttrs + ">");
    if (!manifest.includes(BACKUP_RULES_MARKER)) fail("Manifest backup-rule attributes did not apply.", manifest, manifestPath);
    writeFileSync(manifestPath, manifest);

    const xmlDir = join(genDir, "app", "src", "main", "res", "xml");
    mkdirSync(xmlDir, { recursive: true });
    writeFileSync(join(xmlDir, "paperling_backup_rules.xml"), BACKUP_RULES_XML);
    writeFileSync(join(xmlDir, "paperling_data_extraction_rules.xml"), EXTRACTION_RULES_XML);
    console.log(`Patched ${manifestPath}: + backup/extraction rules (ai-key, notes/ excluded)`);
    console.log("  + res/xml/paperling_backup_rules.xml, res/xml/paperling_data_extraction_rules.xml");
}

// ---- 2. MainActivity.kt: insets + intent capture ----
const activityPath = join(genDir, "app", "src", "main", "java");
let activityFile;
try {
    // The package dir mirrors the app identifier; find MainActivity.kt anywhere below java/.
    const { readdirSync, statSync } = await import("node:fs");
    const walk = (dir) =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            const p = join(dir, e.name);
            return e.isDirectory() ? walk(p) : e.name === "MainActivity.kt" ? [p] : [];
        });
    const found = walk(activityPath);
    if (found.length !== 1) fail(`Expected exactly one MainActivity.kt under ${activityPath}, found ${found.length}.`, "", activityPath);
    activityFile = found[0];
} catch (err) {
    console.error(`::error::Cannot locate MainActivity.kt: ${err.message}`);
    process.exit(1);
}

let activity;
try {
    activity = readFileSync(activityFile, "utf8");
} catch (err) {
    console.error(`::error::Cannot read ${activityFile}: ${err.message}`);
    process.exit(1);
}

if (activity.includes(ACTIVITY_MARKER)) {
    console.log(`${activityFile}: already patched (${ACTIVITY_MARKER})`);
    process.exit(0);
}

// 2a. Imports: insert after the last existing import line.
if (!/^import android\.os\.Bundle$/m.test(activity)) {
    fail("Anchor `import android.os.Bundle` not found in MainActivity.kt — the Tauri template changed; update this script.", activity, activityFile);
}
activity = activity.replace(/(^import .*$)/m, `$1\n${ACTIVITY_IMPORTS}`);

// 2b. Class body: replace the onCreate block + closing brace with the full
//     patched body. Tolerate the exact template shape first, then a looser
//     regex for minor drift.
const exactPattern =
    /  override fun onCreate\(savedInstanceState: Bundle\?\) \{\n(?:.*\n)*?  \}\n\}\s*$/;
const simplePattern =
    /override fun onCreate\(savedInstanceState: Bundle\?\) \{[\s\S]*\n\}\s*$/;
if (exactPattern.test(activity)) {
    activity = activity.replace(exactPattern, ACTIVITY_BODY);
} else if (simplePattern.test(activity)) {
    activity = activity.replace(simplePattern, ACTIVITY_BODY);
} else {
    fail("Anchor `onCreate(savedInstanceState: Bundle?)` block not found in MainActivity.kt — the Tauri template changed; update this script.", activity, activityFile);
}

if (!activity.includes(ACTIVITY_MARKER) || !activity.includes("handleOpenIntent")) {
    fail("MainActivity patch did not apply (markers missing).", activity, activityFile);
}
writeFileSync(activityFile, activity);
console.log(`Patched ${activityFile}:`);
console.log("  + system-bar inset padding (status/cutout/nav)");
console.log("  + ACTION_VIEW capture (content:// copied to cache, incoming.json marker)");
console.log("  + app-style back handler (IME -> web app -> finish)");
console.log("  + system document picker bridge (PaperlingAndroid.openDocument)");

// ---- 3. Launcher icon safe zone ----
//
// `tauri icon` generates the adaptive-icon foreground at the full 108dp
// canvas with the logo edge-to-edge; launchers mask that to a ~72dp circle or
// squircle, so the logo's outer strokes were visibly clipped on the phone
// (reproduced locally by simulating the mask).
//
// The padding is baked straight into the mipmap foreground PNGs (scale the
// artwork to 60% of the canvas — the 66dp guaranteed-visible safe zone — on a
// transparent square). It deliberately does NOT go through a wrapper drawable:
// the template ships res/drawable-v24/ic_launcher_foreground.xml (the Tauri
// logo vector) and a v24 qualifier beats plain drawable/ at resource
// resolution — the first inset attempt pointed the adaptive icon at
// @drawable/ic_launcher_foreground and phones rendered the template's logo
// instead of ours.
const resDir = join(genDir, "app", "src", "main", "res");
const iconMarkerFile = join(genDir, ".paperling-icons-padded");

if (existsSync(iconMarkerFile)) {
    console.log("Launcher icon foregrounds already padded (marker file present)");
} else {
    const foregrounds = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]
        .map((d) => join(resDir, `mipmap-${d}`, "ic_launcher_foreground.png"))
        .filter(existsSync);
    if (foregrounds.length === 0) {
        fail("No mipmap-*/ic_launcher_foreground.png found — run `tauri icon` / the icon copy step before this patch.", "", resDir);
    }
    if (!existsSync(join(resDir, "values", "ic_launcher_background.xml"))) {
        fail("values/ic_launcher_background.xml missing — the adaptive background color must exist for the adaptive icon XML to compile.", "", resDir);
    }

    const sharp = (await import("sharp")).default;
    const SAFE_ZONE_FRACTION = 0.6;
    for (const p of foregrounds) {
        const meta = await sharp(p).metadata();
        if (!meta.width || !meta.height) fail(`Cannot read dimensions of ${p}.`, "", p);
        const inner = Math.round(Math.min(meta.width, meta.height) * SAFE_ZONE_FRACTION);
        const content = await sharp(p)
            .resize(inner, inner, { fit: "inside" })
            .png()
            .toBuffer();
        const padded = await sharp({
            create: {
                width: meta.width,
                height: meta.height,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
        })
            .composite([
                {
                    input: content,
                    left: Math.round((meta.width - inner) / 2),
                    top: Math.round((meta.height - inner) / 2),
                },
            ])
            .png()
            .toBuffer();
        writeFileSync(p, padded);
    }

    // The adaptive icons point straight at the padded mipmap bitmaps — no
    // drawable indirection (see the v24 note above).
    mkdirSync(join(resDir, "mipmap-anydpi-v26"), { recursive: true });
    const ADAPTIVE_ICON_XML = `\
<?xml version="1.0" encoding="utf-8"?>
<!-- ${MANIFEST_MARKER}: foreground baked with safe-zone padding by the CI patch. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <background android:drawable="@color/ic_launcher_background" />
</adaptive-icon>
`;
    writeFileSync(join(resDir, "mipmap-anydpi-v26", "ic_launcher.xml"), ADAPTIVE_ICON_XML);
    writeFileSync(join(resDir, "mipmap-anydpi-v26", "ic_launcher_round.xml"), ADAPTIVE_ICON_XML);

    // Self-heal: a previous version of this patch routed the foreground
    // through drawable/ic_launcher_foreground.xml; remove it so the template's
    // v24 vector can never shadow the real logo again.
    rmSync(join(resDir, "drawable", "ic_launcher_foreground.xml"), { force: true });

    writeFileSync(iconMarkerFile, new Date().toISOString() + "\n");
    console.log(`Padded ${foregrounds.length} launcher foreground PNGs into the launcher safe zone`);
}
