import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  // Only so `lang="ts"` in a component is stripped by the same TypeScript the
  // rest of the build uses. Nothing else here needs configuring.
  preprocess: vitePreprocess(),
};
