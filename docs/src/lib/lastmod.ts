import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { posix } from "node:path";
import { stripTypeScriptTypes } from "node:module";

// WEB-18: a sitemap <lastmod> is the date the page's own content last changed,
// read from git. Search engines only trust lastmod that tracks real content
// edits, so site-wide chrome (Base layout, Nav, Footer, the repeated Aside
// card, global.css, motion.ts) is deliberately left out: a footer edit must
// not stamp every page with the same new date. Paths are relative to docs/.
const fixed: Record<string, string[]> = {
  "": [
    "src/pages/index.astro",
    "src/components/Hero.astro",
    "src/components/Showcase.astro",
    "src/components/Palette.astro",
    "src/components/StoryNotes.astro",
    "src/components/CompareCards.astro",
    "src/components/Faq.astro",
    "src/components/CTA.astro",
    "src/lib/comparisons.ts",
    "src/lib/art.ts",
  ],
  "features/": ["src/pages/features/index.astro", "src/lib/art.ts"],
  "compare/": ["src/pages/compare/index.astro", "src/lib/comparisons.ts"],
  "download/": ["src/pages/download.astro", "src/lib/art.ts"],
  "faq/": ["src/pages/faq.astro", "src/components/Faq.astro"],
  // The shortcut table is generated from the app's own keybinding config.
  "shortcuts/": ["src/pages/shortcuts.astro", "../src/config/keybindings.ts"],
};

export function contentSources(path: string): string[] {
  if (fixed[path]) return fixed[path];
  if (/^features\/[^/]+\/$/.test(path))
    return ["src/pages/features/[slug].astro", "src/lib/art.ts"];
  if (/^compare\/[^/]+\/$/.test(path))
    return ["src/pages/compare/[slug].astro", "src/lib/comparisons.ts"];
  if (/^[a-z-]+\/$/.test(path)) return [`src/pages/${path.slice(0, -1)}.astro`];
  throw new Error(`WEB-18: no content sources mapped for "${path}"`);
}

// site.ts holds every feature's copy and every FAQ in one file, so its file
// date would move all of those pages whenever any one of them is edited.
// Instead each page names the slice of site.ts it renders, and is dated by the
// newest commit that changed that slice.
type SiteData = { features?: any[]; faqs?: any[] };
export function siteSlice(path: string) {
  if (path === "") return (d: SiteData) => d.faqs?.slice(0, 5);
  if (path === "features/")
    return (d: SiteData) =>
      d.features?.map((f) => [f.slug, f.name, f.title, f.description]);
  if (path === "faq/") return (d: SiteData) => d.faqs;
  const slug = /^features\/([^/]+)\/$/.exec(path)?.[1];
  if (slug) return (d: SiteData) => d.features?.find((f) => f.slug === slug);
}

// Resolved from the repo root, so it works whether Astro runs from docs/ (CI)
// or from the root with --root docs (the local preview config).
let top: string | undefined;
function git(...args: string[]): string {
  top ??= execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  return execFileSync("git", args, {
    cwd: top,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

const siteAt = new Map<string, Promise<SiteData | null>>();
function loadSite(rev: string): Promise<SiteData | null> {
  if (!siteAt.has(rev)) {
    let source: string;
    try {
      source = git("show", `${rev}:docs/src/lib/site.ts`);
    } catch {
      siteAt.set(rev, Promise.resolve(null)); // file didn't exist yet
      return siteAt.get(rev)!;
    }
    const js = stripTypeScriptTypes(source);
    siteAt.set(
      rev,
      import(
        /* @vite-ignore */ "data:text/javascript," + encodeURIComponent(js)
      ).catch(() => null),
    );
  }
  return siteAt.get(rev)!;
}

async function sliceDate(slice: (d: SiteData) => unknown): Promise<string> {
  const log = git("log", "--format=%H %cs", "--", "docs/src/lib/site.ts");
  for (const line of log.split("\n")) {
    const [sha, date] = line.split(" ");
    const [now, before] = await Promise.all([
      loadSite(sha),
      loadSite(sha + "^"),
    ]);
    const key = (d: SiteData | null) => JSON.stringify(d && slice(d));
    if (key(now) !== key(before)) return date;
  }
  throw new Error("WEB-18: site.ts slice never changed in history");
}

let checked = false;
const cache = new Map<string, Promise<string>>();

// YYYY-MM-DD of the newest commit that changed the page's own content. Fails
// the build instead of guessing: a shallow clone would date every page to the
// checkout commit, which is exactly the fixed-date lie this avoids.
export function lastmod(path: string): Promise<string> {
  if (!cache.has(path)) cache.set(path, compute(path));
  return cache.get(path)!;
}
async function compute(path: string): Promise<string> {
  if (!checked) {
    if (git("rev-parse", "--is-shallow-repository") === "true")
      throw new Error(
        "WEB-18: shallow git clone; sitemap lastmod needs full history (actions/checkout fetch-depth: 0)",
      );
    checked = true;
  }
  const files = contentSources(path).map((file) => posix.join("docs", file));
  for (const file of files)
    if (!existsSync(posix.join(top!, file)))
      throw new Error(`WEB-18: missing source ${file}`);
  const dates = [git("log", "-1", "--format=%cs", "--", ...files)];
  const slice = siteSlice(path);
  if (slice) dates.push(await sliceDate(slice));
  for (const date of dates)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new Error(`WEB-18: no committed history for "${path}"`);
  return dates.sort().at(-1)!;
}
