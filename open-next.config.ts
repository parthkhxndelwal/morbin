import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Uncomment to enable R2 cache reinvalidation, then add the bucket binding to wrangler.jsonc
  // incrementalCache: r2IncrementalCache,
});
