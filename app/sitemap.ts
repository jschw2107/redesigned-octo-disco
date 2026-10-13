import type { MetadataRoute } from "next";
import { campaignPath, listCampaigns } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
const base = () => (process.env.SITE_URL || "https://groupbuy-yu.vercel.app").replace(/\/$/, "");

/** Tells search engines about the homepage, the requests page and every public GroupBuy. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const b = base();
  const campaigns = await listCampaigns({ publicOnly: true }).catch(() => []);
  return [
    { url: `${b}/`, changeFrequency: "daily", priority: 1 },
    { url: `${b}/requests`, changeFrequency: "daily", priority: 0.6 },
    { url: `${b}/in-stock`, changeFrequency: "daily", priority: 0.7 },
    ...campaigns.map((c) => ({
      url: `${b}${campaignPath(c.number)}`, changeFrequency: "daily" as const, priority: c.status === "live" ? 0.9 : 0.4,
    })),
  ];
}
