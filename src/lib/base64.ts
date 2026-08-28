/**
 * Base64, because JSON cannot hold bytes.
 *
 * Everything the record carries -- a salt, a wrapped key, ciphertext -- is
 * bytes, and an atproto record is JSON. Base64 is the standard
 * alphabet with padding: nothing here is ever typed by a human or put in a URL,
 * so the url-safe variant would buy nothing.
 *
 * atob/btoa rather than Uint8Array.toBase64: the newer methods need Safari
 * 18.2, and the phone this runs on is the last place to find that out.
 */

/**
 * A plain byte array. The explicit ArrayBuffer matters: WebCrypto will not
 * accept a view that might sit on a SharedArrayBuffer, and the unparameterised
 * Uint8Array might.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export function toBase64(bytes: Bytes): string {
  // Character at a time, not fromCharCode(...bytes): spreading a note-sized
  // array over the argument list overflows the stack.
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Throws on anything that is not base64. Every caller is reading a field out of
 * a record it did not write, so a bad field has to fail rather than decode to
 * something arbitrary that then fails as a decryption error.
 */
export const fromBase64 = (text: string): Bytes =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** Concatenation, since ciphertext is stored as iv ++ body in a single field. */
export function join(head: Bytes, tail: Bytes): Bytes {
  const out = new Uint8Array(head.length + tail.length);
  out.set(head);
  out.set(tail, head.length);
  return out;
}
