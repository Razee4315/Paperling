// WEB-17: footer cross-links to the owner's other GitHub Pages projects, so
// crawlers can reach every project from any one of them. They share this
// origin, so verify-site exempts exactly these from the base-path check.
// Pages paths are case-sensitive: keep each repo's exact casing. Paperling
// itself is left out. Kept out of site.ts so adding a project doesn't move
// the content lastmod of the pages built from site.ts (WEB-18).
export const moreProjects = [
  ["https://razee4315.github.io/", "All projects"],
  ["https://razee4315.github.io/snipflag/", "Snipflag"],
  ["https://razee4315.github.io/Vuoom/", "Vuoom"],
  ["https://razee4315.github.io/coldframe/", "Coldframe"],
];
