import { docsSource } from "@/lib/source";
import { SITE_URL, buildUrlset, xmlResponse, type SitemapEntry } from "@/lib/sitemap-builder";

export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  const now = new Date();
  const entries: SitemapEntry[] = docsSource.getPages().map((page) => ({
    loc: `${SITE_URL}${page.url}`,
    lastmod: now,
    changefreq: "weekly",
    priority: 0.75,
  }));
  return xmlResponse(buildUrlset(entries));
}
