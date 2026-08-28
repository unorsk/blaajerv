/**
 * Who this client says it is.
 *
 * An atproto OAuth client has no secret -- it is a page, and a page cannot keep
 * one. Instead the client id *is* a URL, and the authorization server fetches
 * it to find out what the client is allowed to do. So the deployed address has
 * to be baked into a file at build time: see the plugin in vite.config.ts,
 * which writes `client-metadata.json` next to the app.
 *
 * On a loopback host there is nothing to fetch and no https to fetch it over,
 * so the spec allows the whole document to be encoded into the client id
 * itself. That is the only difference between running this locally and running
 * it on Pages.
 *
 * Kept free of browser APIs and of the atproto packages, so the build can call
 * it and the tests can too.
 */

/**
 * `atproto` to prove who you are, `transition:generic` to write a record. The
 * second is broader than this app needs -- it is every collection in the repo --
 * but it is what every PDS understands today.
 */
export const SCOPE = "atproto transition:generic";

/** The part of `location` any of this depends on. */
export interface Where {
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
  readonly href: string;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The document served at the client id. Written at build time, read by the PDS. */
export const clientMetadata = (site: string): Record<string, unknown> => {
  // A trailing slash, always: the redirect uri has to match to the character,
  // and a directory URL without one is a redirect waiting to happen.
  const base = new URL(site.endsWith("/") ? site : `${site}/`).href;
  return {
    client_id: `${base}client-metadata.json`,
    client_name: "blaajerv",
    client_uri: base,
    redirect_uris: [base],
    scope: SCOPE,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    application_type: "web",
    token_endpoint_auth_method: "none",
    dpop_bound_access_tokens: true,
  };
};

/**
 * The client id for wherever the page happens to be running.
 *
 * Loopback ids name their redirect uri by IP, never by name: `localhost` is not
 * an origin the way `127.0.0.1` is. The library redirects the tab if it is on
 * the wrong one, which is why the port and path have to be carried through.
 */
export function clientId(where: Where): string {
  if (!LOOPBACK.has(where.hostname)) return new URL("client-metadata.json", where.href).href;
  const host = where.hostname === "localhost" ? "127.0.0.1" : where.hostname;
  const port = where.port ? `:${where.port}` : "";
  const params = new URLSearchParams({
    redirect_uri: `${where.protocol}//${host}${port}${where.pathname}`,
    scope: SCOPE,
  });
  return `http://localhost${where.pathname === "/" ? "" : where.pathname}?${params}`;
}
