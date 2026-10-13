import type { MetadataRoute } from "next";

/** Let search engines in, but keep the admin, the API and private commitment links out of results. */
export default function robots(): MetadataRoute.Robots {
  const b = (process.env.SITE_URL || "https://groupbuy-yu.vercel.app").replace(/\/$/, "");
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/c/"] }], sitemap: `${b}/sitemap.xml` };
}
