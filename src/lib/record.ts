/**
 * The one record this app owns, and how to read a stranger's JSON as one.
 *
 * A repo is a public, replicated store: anyone can fetch this record, and
 * anyone can put anything in a repo they control. So the value that comes back
 * is untrusted JSON until this module has looked at it -- a missing field must
 * fail here, with a sentence about the record, rather than three layers down as
 * a base64 or WebCrypto error about something the reader cannot see.
 *
 * One record, at a fixed key, holding both the wrapped note key and the note.
 * Keeping them together is what makes the app a single fetch and a single
 * write, and what makes a password change atomic with the note it was changed
 * over. The record is exactly a `Locked` plus a `Sealed` plus a version and a
 * timestamp, which is why it is flat: there is nothing to group.
 */

import type { Bytes } from "./base64.ts";
import type { Locked, Sealed } from "./crypto.ts";

/** Our lexicon, under the domain the app is published from. */
export const COLLECTION = "io.github.unorsk.blaajerv.note";

/** One note per person, so the key is a constant rather than a timestamp. */
export const RKEY = "self";

/**
 * How the bytes are put together, and the only value this app reads.
 *
 * Cheap now, impossible later: the records live in other people's repos, so
 * there is no migration to run over them. A reader that can name the version it
 * is looking at can refuse it clearly; one that cannot will decode a future
 * record as a corrupt current one.
 */
export const VERSION = 1;

export interface Note extends Locked, Sealed {
  /** The scheme the ciphertexts were written under. */
  readonly v: number;
  /** ISO 8601, as every atproto record spells a time. Written, never read back. */
  readonly updatedAt: string;
}

/**
 * What both ciphertexts are authenticated against.
 *
 * Not a secret and not stored -- every reader rebuilds it. It is here so that a
 * record only decrypts in the place it was written for: lifted into another
 * repo, or replayed under another rkey or scheme, it fails as a forgery rather
 * than opening.
 */
export const context = (did: string): Bytes =>
  new TextEncoder().encode(`${COLLECTION}/${RKEY}/${VERSION}/${did}`);

export const asValue = (note: Note): Record<string, unknown> => ({ $type: COLLECTION, ...note });

/** A required string field, named so a failure says which one. */
function field(source: Record<string, unknown>, name: string): string {
  const value = source[name];
  if (typeof value !== "string" || value === "") throw new Error(`record is missing ${name}`);
  return value;
}

export function parse(value: unknown): Note {
  if (typeof value !== "object" || value === null) throw new Error("record is not an object");
  const source = value as Record<string, unknown>;
  if (source.v !== VERSION) {
    throw new Error(`the note is not version ${VERSION}, which is the only one this app reads`);
  }
  return {
    v: VERSION,
    salt: field(source, "salt"),
    key: field(source, "key"),
    body: field(source, "body"),
    // Absent is not worth failing over: nothing reads it, and it is outside the
    // authenticated envelope anyway, so it is a label rather than evidence --
    // the counter inside the ciphertext is what says how old a note is.
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
  };
}
