import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://morbin.parthkhandelwal-dev.workers.dev";
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/docs`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/getting-started`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/creating-events`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/ticket-types`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/payments`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/check-in`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/tickets`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/legal/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/legal/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
