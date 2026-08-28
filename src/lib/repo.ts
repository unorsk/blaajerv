/**
 * The note, over three XRPC calls against whichever PDS the account lives on.
 *
 * There is no server of ours in this: the session's fetch handler signs each
 * request with the DPoP key held in this browser and sends it straight to the
 * PDS. The base URL is the one the OAuth flow resolved from the handle, so a
 * self-hosted account works exactly as a bsky.social one does.
 *
 * `cid` is the version tag. A put carries the cid the note was read at, and the
 * PDS refuses the write if the record has moved on since -- which is what stops
 * the phone from silently overwriting an edit made on the laptop.
 */

import type { OAuthSession } from "@atproto/oauth-client-browser";
import { asValue, COLLECTION, type Note, parse, RKEY } from "./record.ts";

export interface Stored {
  readonly note: Note;
  readonly cid: string;
}

/** What went wrong, in a status bar's worth of words. */
export const explain = (cause: unknown): string =>
  cause instanceof TypeError
    ? "no connection"
    : // WebCrypto reports every decryption failure as an OperationError with an
      // empty message, and an empty status bar is not a report.
      cause instanceof DOMException
      ? "the note could not be decrypted"
      : cause instanceof Error
        ? cause.message || "something went wrong"
        : String(cause);

interface Failure {
  readonly error?: string;
  readonly message?: string;
}

const failure = async (response: Response): Promise<Failure> =>
  ((await response.json().catch(() => null)) as Failure | null) ?? {};

async function call(
  session: OAuthSession,
  method: string,
  init: RequestInit,
  query?: Record<string, string>,
): Promise<Response> {
  const search = query ? `?${new URLSearchParams(query)}` : "";
  // A record read a minute ago is not the record: always go to the network.
  return session.fetchHandler(`/xrpc/${method}${search}`, { cache: "no-store", ...init });
}

/** The current note, or null on an account that has never saved one. */
export async function read(session: OAuthSession): Promise<Stored | null> {
  const response = await call(
    session,
    "com.atproto.repo.getRecord",
    { method: "GET" },
    {
      repo: session.did,
      collection: COLLECTION,
      rkey: RKEY,
    },
  );
  if (response.status === 400 || response.status === 404) {
    const { error, message } = await failure(response);
    // The ordinary first run, not a problem to report.
    if (error === "RecordNotFound") return null;
    throw new Error(message ?? error ?? "could not read the note");
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const body = (await response.json()) as { cid?: string; value?: unknown };
  if (!body.cid) throw new Error("the PDS returned a record with no cid");
  return { note: parse(body.value), cid: body.cid };
}

/**
 * Writes the note and returns its new cid. Pass the cid it was read at, or null
 * to create it; a mismatch is a conflict rather than something to resolve here,
 * because only the person typing knows which version they meant.
 */
export async function write(
  session: OAuthSession,
  note: Note,
  cid: string | null,
): Promise<string> {
  const response = await call(session, "com.atproto.repo.putRecord", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo: session.did,
      collection: COLLECTION,
      rkey: RKEY,
      record: asValue(note),
      // Explicitly null on the first write: "there must be no record here" is a
      // different claim from "I do not care what is here".
      swapRecord: cid,
    }),
  });
  if (!response.ok) {
    const { error, message } = await failure(response);
    if (error === "InvalidSwap") {
      throw new Error("conflict: the note changed elsewhere — reload before saving");
    }
    throw new Error(message ?? error ?? `${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { cid?: string };
  if (!body.cid) throw new Error("the PDS accepted the write but returned no cid");
  return body.cid;
}

/**
 * The handle behind the session's DID, for the sake of the header. A DID is the
 * account; a handle is how its owner recognises it.
 */
export async function handle(session: OAuthSession): Promise<string | null> {
  try {
    const response = await call(
      session,
      "com.atproto.repo.describeRepo",
      { method: "GET" },
      {
        repo: session.did,
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { handle?: string };
    return body.handle ?? null;
  } catch {
    // Cosmetic. A failure here must not stop the note from opening.
    return null;
  }
}
