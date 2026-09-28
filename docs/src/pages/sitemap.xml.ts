import { paths, absolute } from "../lib/site";
import { lastmod } from "../lib/lastmod";
export async function GET() {
  const dates = await Promise.all(paths.map(lastmod));
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      paths
        .map(
          (path, i) =>
            "<url><loc>" +
            absolute(path) +
            "</loc><lastmod>" +
            dates[i] +
            "</lastmod></url>",
        )
        .join("") +
      "</urlset>",
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
}
