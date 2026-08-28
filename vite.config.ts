import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";
import { clientMetadata } from "./src/lib/oauth.ts";

/**
 * The OAuth client id is a URL the authorization server fetches, so the
 * document it points at has to name the address the app was deployed to --
 * something only the deploy knows. The workflow passes it in; `npm run build`
 * without it produces a bundle that runs fine on a loopback host and says so
 * plainly anywhere else, rather than one that half works.
 */
function metadata(site: string | undefined): Plugin {
  return {
    name: "client-metadata",
    apply: "build",
    generateBundle() {
      if (!site) {
        this.warn("SITE_URL is not set: client-metadata.json will not be emitted");
        return;
      }
      this.emitFile({
        type: "asset",
        fileName: "client-metadata.json",
        source: `${JSON.stringify(clientMetadata(site), null, 2)}\n`,
      });
    },
  };
}

/**
 * The whole design rests on nothing else running script on this origin, and
 * until now nothing enforced that. The built page makes a strict policy cheap:
 * one external module, one external stylesheet, a same-origin font, and no
 * inline anything -- so `'self'` costs nothing, which is worth taking while it
 * is still true.
 *
 * `connect-src` is the one that cannot be narrowed, since a PDS can be any host.
 * It still forbids plaintext, and everything not named here is closed by
 * `default-src 'none'`. `frame-ancestors` is missing because a meta-tag policy
 * cannot carry it and Pages cannot send headers.
 */
const POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src https:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * Build only. The dev server serves its client over a websocket and injects
 * stylesheets from script, both of which the policy above forbids -- so putting
 * it in index.html would mean either breaking `npm run dev` or loosening the
 * thing it exists to tighten.
 */
const policy = (): Plugin => ({
  name: "csp",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: POLICY },
      injectTo: "head-prepend",
    },
  ],
});

export default defineConfig({
  // Relative, so the same build works at unorsk.github.io/blaajerv/, at the
  // root of a user site, and from a local preview -- nothing hardcodes the
  // repo name. The client metadata is the one thing that cannot be relative.
  base: "./",
  plugins: [svelte(), metadata(process.env.SITE_URL), policy()],
});
