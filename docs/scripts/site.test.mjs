import { test } from "node:test";
import assert from "node:assert/strict";
import {
  absolute,
  url,
  paths,
  comparisonSlugs,
  features,
} from "../src/lib/site.ts";
import { comparisons } from "../src/lib/comparisons.ts";
test("WEB-01: preserve the homepage and resolve deep links under the GitHub project", () => {
  assert.equal(absolute(), "https://razee4315.github.io/Paperling/");
  assert.equal(url("/compare/typora/"), "/Paperling/compare/typora/");
  assert.equal(url("#download"), "#download");
  assert.equal(
    url("https://github.com/Razee4315/Paperling"),
    "https://github.com/Razee4315/Paperling",
  );
});
test("WEB-03: every comparison and feature is discoverable without indexing the 404", () => {
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(!paths.some((p) => p.includes("404")));
  assert.deepEqual(
    comparisons.map((c) => c.slug).sort(),
    [...comparisonSlugs].sort(),
  );
  for (const c of comparisons) {
    assert.ok(paths.includes(`compare/${c.slug}/`));
    assert.ok(c.sources.length);
  }
  for (const f of features) assert.ok(paths.includes(`features/${f.slug}/`));
});
test("WEB-17: cross-links use each repo's exact casing and skip Paperling", async () => {
  const { moreProjects } = await import("../src/lib/projects.ts");
  assert.deepEqual(
    moreProjects.map(([href]) => href),
    [
      "https://razee4315.github.io/",
      "https://razee4315.github.io/snipflag/",
      "https://razee4315.github.io/Vuoom/",
      "https://razee4315.github.io/coldframe/",
    ],
  );
  assert.ok(!moreProjects.some(([href]) => /paperling/i.test(href)));
});
test("WEB-18: lastmod follows each page's own content, never site chrome", async () => {
  const { contentSources, lastmod } = await import("../src/lib/lastmod.ts");
  const today = new Date().toISOString().slice(0, 10);
  const chrome =
    /layouts\/|Nav\.astro|Footer\.astro|Aside\.astro|global\.css|motion\.ts|projects\.ts/;
  for (const path of paths) {
    for (const file of contentSources(path)) assert.ok(!chrome.test(file), file);
    const date = await lastmod(path);
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(date <= today, path);
  }
  assert.ok(
    contentSources("shortcuts/").includes("../src/config/keybindings.ts"),
  );
  assert.throws(() => contentSources("nope/deeper/still/"));
});
test("WEB-18: editing one feature's copy moves only that feature's slice", async () => {
  const { siteSlice } = await import("../src/lib/lastmod.ts");
  const before = structuredClone({ features, faqs: [] });
  const after = structuredClone(before);
  after.features[0].sections[0][1] += " Edited.";
  const moved = (path) =>
    JSON.stringify(siteSlice(path)(before)) !==
    JSON.stringify(siteSlice(path)(after));
  assert.ok(moved(`features/${features[0].slug}/`));
  assert.ok(!moved(`features/${features[1].slug}/`));
  assert.ok(!moved("features/"), "index cards don't show section copy");
  assert.ok(!moved("faq/"));
});
