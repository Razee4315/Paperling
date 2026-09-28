import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { parseHTML } from "linkedom";
import { paths, absolute, SITE } from "../src/lib/site.ts";
import { moreProjects } from "../src/lib/projects.ts";

// WEB-03: exercise the rendered output, not copies of template logic. This runs
// against Astro dev locally and the exact production artifact before deployment.
const target = process.argv[2];
const remote = target?.startsWith("http");
const dist = resolve(target || "dist");
async function read(path) {
  if (remote) {
    const response = await fetch(new URL(SITE.base + path, target));
    assert.equal(
      response.status,
      path === "404.html" ? 404 : 200,
      `HTTP status for ${path}`,
    );
    return response.text();
  }
  return readFile(
    resolve(dist, path.endsWith("/") || !path ? path + "index.html" : path),
    "utf8",
  );
}
const docs = new Map();
const titles = new Set(),
  descriptions = new Set();
for (const path of [...paths, "404.html"]) {
  const { document } = parseHTML(await read(path));
  docs.set(path, document);
  const title = document.querySelector("title")?.textContent;
  const description = document
    .querySelector('meta[name="description"]')
    ?.getAttribute("content");
  assert.ok(title && !titles.has(title), `Unique title: ${path}`);
  assert.ok(
    description && !descriptions.has(description),
    `Unique description: ${path}`,
  );
  titles.add(title);
  descriptions.add(description);
  assert.equal(document.querySelectorAll("h1").length, 1, `Single h1: ${path}`);
  assert.equal(document.querySelector("html")?.getAttribute("lang"), "en");
  assert.equal(
    document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    absolute(path),
  );
  assert.equal(
    document.querySelector('meta[property="og:url"]')?.getAttribute("content"),
    absolute(path),
  );
  assert.equal(
    document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content"),
    title,
  );
  assert.equal(
    document
      .querySelector('meta[name="twitter:title"]')
      ?.getAttribute("content"),
    title,
  );
  assert.equal(
    document
      .querySelector('meta[name="robots"]')
      ?.getAttribute("content")
      ?.includes("noindex"),
    path === "404.html",
  );
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    const data = JSON.parse(script.textContent);
    assert.equal(data["@context"], "https://schema.org");
    assert.ok(
      !script.textContent.includes("aggregateRating"),
      "No fabricated ratings",
    );
  }
  const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, `Unique IDs: ${path}`);
  for (const img of document.querySelectorAll("img"))
    assert.ok(img.hasAttribute("alt"), `Image alt: ${path}`);
  if (!remote) {
    for (const asset of document.querySelectorAll(
      'img[src], script[src], link[rel="stylesheet"], link[rel="icon"]',
    )) {
      const assetUrl = new URL(
        asset.getAttribute("src") || asset.getAttribute("href"),
        absolute(path),
      );
      assert.equal(assetUrl.origin, SITE.origin, `Self-hosted assets: ${path}`);
      assert.ok(
        assetUrl.pathname.startsWith(SITE.base),
        `Asset base path: ${path}`,
      );
      await access(
        resolve(
          dist,
          decodeURIComponent(assetUrl.pathname.slice(SITE.base.length)),
        ),
      );
    }
  }
}
for (const [path, document] of docs) {
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    const link = new URL(href, absolute(path));
    if (link.origin !== SITE.origin) continue;
    // WEB-17: sibling projects on the same github.io origin, exact casing only.
    if (moreProjects.some(([project]) => project === href)) continue;
    assert.ok(
      link.pathname.startsWith(SITE.base),
      `Base path retained: ${path} → ${href}`,
    );
    const local = link.pathname.slice(SITE.base.length);
    if (docs.has(local)) {
      if (link.hash)
        assert.ok(
          docs
            .get(local)
            .getElementById(decodeURIComponent(link.hash.slice(1))),
          `Anchor exists: ${path} → ${href}`,
        );
    } else if (extname(local)) {
      if (!remote) await access(resolve(dist, local));
    } else assert.fail(`Missing internal page: ${path} → ${href}`);
  }
}
const sitemap = await read("sitemap.xml");
const entries = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
assert.deepEqual(
  entries.sort(),
  paths.map(absolute).sort(),
  "Sitemap matches every indexable page",
);
const lastmods = [...sitemap.matchAll(/<url>(.*?)<\/url>/g)].map(
  (m) => /<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/.exec(m[1])?.[1],
);
assert.equal(lastmods.length, paths.length, "WEB-18: one <url> per page");
for (const date of lastmods)
  assert.ok(
    date && date <= new Date().toISOString().slice(0, 10),
    `WEB-18: every sitemap entry has a real lastmod (${date})`,
  );
for (const document of docs.values()) {
  const more = [...document.querySelectorAll(".footer-more a")].map((a) =>
    a.getAttribute("href"),
  );
  assert.deepEqual(
    more,
    moreProjects.map(([href]) => href),
    "WEB-17: footer links to the other projects",
  );
}
const home = docs.get("");
if (!remote) {
  const card = await readFile(resolve(dist, "og.png"));
  assert.equal(card.readUInt32BE(16), 1200, "Social card width");
  assert.equal(card.readUInt32BE(20), 630, "Social card height");
}
for (const id of [
  "top",
  "features",
  "editor",
  "themes",
  "ai",
  "download",
  "faq",
])
  assert.ok(home.getElementById(id), `Existing homepage anchor #${id}`);
assert.ok(
  (await read("google0d979f7b74e3dae0.html")).includes(
    "google-site-verification",
  ),
);
assert.ok((await read("robots.txt")).includes(absolute("sitemap.xml")));
console.log(
  `Verified ${docs.size} pages: metadata, canonicals, structured data, headings, links, anchors, sitemap, and search verification.`,
);
