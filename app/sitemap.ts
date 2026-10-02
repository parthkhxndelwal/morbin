import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://morbin.space";
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/apply`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/docs`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/getting-started`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/roles`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/creating-events`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/ticket-types`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/payments`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/check-in`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/tickets`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/legal/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/legal/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
