# Paperling website redesign

| Area | Result |
| --- | --- |
| Design | Manrope headings, warm paper/forest green, custom SVG illustration, brief motion, oversized footer |
| Content | Shorter copy, creator's origin story, 20 indexable pages and a custom 404 |
| Comparisons | Obsidian, Typora, VS Code, MarkText: table first, short recommendation, official sources |
| Search | Existing homepage and anchors preserved; route-specific metadata, canonicals, breadcrumbs, sitemap |
| Performance | Removed GSAP, Lenis, Tailwind and icon runtime dependencies; static HTML and small progressive enhancements |
| Publishing | GitHub Pages only; production build and output checks in Actions |

## Design and content

Vuoom informed the editorial spacing, tactile paper details, and substantial footer. Paperling has its own illustration, palette, and layout. At the owner's request, serif typography was replaced with Manrope and comparison prose reduced to a table and a short recommendation. The founder story describes building Paperling early in his journey to solve his own difficulty reading Markdown files.

Fresh app screenshots replace the old MarkLite sample. No invented testimonials, download statistics, performance benchmarks, or ratings are used. Comparisons explicitly credit competitors and distinguish free app licensing from optional paid services. Offline and AI copy explains relevant network use and provider charges.

## Search implementation

- `/Paperling/` remains the canonical homepage. Existing `#top`, `#features`, `#editor`, `#themes`, `#ai`, `#download`, and `#faq` links still resolve.
- Each supporting page has a distinct title, description, canonical, Open Graph, and Twitter metadata.
- Static, crawlable HTML; semantic headings; breadcrumbs; SoftwareApplication and FAQ structured data match visible content. No rich-result or ranking promise.
- The sitemap is generated from the shared route inventory and keeps the existing `/sitemap.xml` URL. The Google verification file remains intact.
- Google recommends consistent canonicals and sitemaps: [canonical documentation](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [sitemap documentation](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

## Validation and maintenance

See [TEST-CHECKLIST.md](TEST-CHECKLIST.md) for the owner's short review path. The website workflow typechecks, tests, builds, verifies its rendered output, and stores a preview artifact for 14 days. The deployment workflow verifies the artifact before publishing. No production build runs locally.

The original full app test attempt exhausted worker startup time on this machine. Limiting Vitest to two workers passed. After synchronizing the latest main (including audit round 4), the root suite passed 572 tests with two existing skips, and the root typecheck passed. Website diagnostics had zero errors or warnings; URL regression tests and all 21 rendered-page checks passed.

Live browser checks cover desktop and phone layouts, screenshot tabs with arrow/Home/End keys, FAQ disclosures, navigation, the compact comparison table, and download navigation. SVG motion ends after four seconds and respects reduced-motion preferences. Content remains visible if JavaScript fails; ordinary scrolling remains native.

Repository scope is confined to `docs/` and website workflows. The application audit's root checklist is untouched. Production deployment links and final verification are recorded in the handoff after Actions completes.
