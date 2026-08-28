import assert from "node:assert/strict";
import { test } from "node:test";
import { clientId, clientMetadata } from "./oauth.ts";

const at = (href: string) => {
  const url = new URL(href);
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    href: url.href,
  };
};

test("on Pages the client id is a file next to the app", () => {
  assert.equal(
    clientId(at("https://unorsk.github.io/blaajerv/")),
    "https://unorsk.github.io/blaajerv/client-metadata.json",
  );
  // index.html, a query, a hash: all resolve to the same directory.
  assert.equal(
    clientId(at("https://unorsk.github.io/blaajerv/index.html?a=1#b")),
    "https://unorsk.github.io/blaajerv/client-metadata.json",
  );
});

test("the metadata names exactly the url it was built for", () => {
  const meta = clientMetadata("https://unorsk.github.io/blaajerv/");
  assert.equal(meta.client_id, clientId(at("https://unorsk.github.io/blaajerv/")));
  assert.deepEqual(meta.redirect_uris, ["https://unorsk.github.io/blaajerv/"]);
  // Pages hands the workflow a url without one; the redirect uri needs it.
  assert.deepEqual(clientMetadata("https://unorsk.github.io/blaajerv").redirect_uris, [
    "https://unorsk.github.io/blaajerv/",
  ]);
});

test("a loopback client id carries its own document, by IP", () => {
  const id = new URL(clientId(at("http://localhost:5173/")));
  assert.equal(id.origin, "http://localhost");
  assert.equal(id.pathname, "/");
  assert.equal(id.searchParams.get("redirect_uri"), "http://127.0.0.1:5173/");
  assert.match(id.searchParams.get("scope") ?? "", /^atproto\b/);
});

test("loopback keeps the port and the path it was served from", () => {
  const id = new URL(clientId(at("http://127.0.0.1:4173/blaajerv/")));
  assert.equal(id.pathname, "/blaajerv/");
  assert.equal(id.searchParams.get("redirect_uri"), "http://127.0.0.1:4173/blaajerv/");
});
