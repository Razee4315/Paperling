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
