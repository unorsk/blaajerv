/**
 * One key for the note, and a password that wraps it.
 *
 * The note is encrypted under AES-256-GCM with 32 random bytes generated in the
 * browser. Those bytes are the thing worth protecting, and the password never
 * touches the note: it is stretched with PBKDF2 into a key that wraps the note
 * key, and it is the wrapped key that goes in the record. So the PDS holds a
 * salt and two ciphertexts, and the password stays on the device.
 *
 * Everything below follows from one fact: the record is *published*. A repo is a
 * public, replicated log, so an attacker who ever fetched it holds the salt and
 * the wrapped key forever and can attack the password offline, unobserved, at
 * leisure. Three things fall out of that.
 *
 * The password is never the long-term secret, and a new one is never just a new
 * wrapping. `create` mints a fresh note key every time it is called, so changing
 * a password re-keys the note -- see App.svelte's `repassword`. Re-wrapping the
 * same key would leave it recoverable from the old record for as long as that
 * record exists, which is forever, and would make the change cosmetic.
 *
 * The note key is only ever extractable for the instant it takes to wrap it. The
 * copy handed back for the session cannot be exported at all, so nothing that
 * gets a foothold on the page can copy it out and keep it.
 *
 * And the ciphertext is padded and carries a counter, because GCM hides content
 * but not length, and a public log otherwise publishes the note's exact size and
 * a timestamped trace of every keystroke burst. See `frame`.
 *
 * The cost is the usual one: the password is the only way in. There is no reset,
 * because there is nobody holding anything to reset it with.
 */

import { type Bytes, fromBase64, join, toBase64 } from "./base64.ts";

const CIPHER = "AES-GCM";
const BITS = 256;
const IV_BYTES = 12;
const SALT_BYTES = 16;

/**
 * OWASP's floor for PBKDF2-HMAC-SHA256, and about a quarter second on a phone.
 * It is paid once at unlock and once at setup, never per save.
 */
const ITERATIONS = 600_000;

/** A counter and the text's true length, ahead of the text itself. */
const HEADER_BYTES = 8;

/**
 * Every note is padded up to a multiple of this before it is sealed, so the
 * published size moves in kilobyte steps rather than tracking the note byte for
 * byte. A kilobyte of padding is nothing next to what it stops leaking.
 */
const BLOCK_BYTES = 1024;

/** The note key as it sits in the record: wrapped, and useless on its own. */
export interface Locked {
  /** PBKDF2 salt. Random per note, and not a secret. */
  readonly salt: string;
  /** iv ++ AES-GCM(raw note key) under the password-derived key. */
  readonly key: string;
}

/** The note itself. Self-contained, given the key. */
export interface Sealed {
  /** iv ++ AES-GCM(framed note). */
  readonly body: string;
}

/**
 * What is actually sealed: the text, and which save it was.
 *
 * The counter is inside the ciphertext rather than beside it, so a server cannot
 * set it. It only rises, which is what lets a device notice a repo that has been
 * wound back to an older note.
 */
export interface Plain {
  readonly counter: number;
  readonly text: string;
}

const random = (length: number): Bytes => crypto.getRandomValues(new Uint8Array(length));

const utf8 = new TextEncoder();

const algorithm = { name: CIPHER, length: BITS } as const;

/**
 * Both ciphertexts are bound to the account and the record they belong to, so
 * one cannot be transplanted into another repo and passed off as its note.
 */
const params = (iv: Bytes, aad: Bytes): AesGcmParams => ({
  name: CIPHER,
  iv,
  additionalData: aad,
});

/** The password, stretched into a key that can wrap the note key. */
async function derive(password: string, salt: Bytes): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", utf8.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    algorithm,
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/**
 * The note key for a session. Never extractable: a password change mints a new
 * key rather than re-wrapping this one, so nothing ever needs to export it, and
 * script that gets onto the page can use it but cannot take it away.
 */
const unwrap = (kek: CryptoKey, aad: Bytes, wrapped: Bytes): Promise<CryptoKey> =>
  crypto.subtle.unwrapKey(
    "raw",
    wrapped.subarray(IV_BYTES),
    kek,
    params(wrapped.subarray(0, IV_BYTES), aad),
    algorithm,
    false,
    ["encrypt", "decrypt"],
  );

/**
 * A new note key, and the record fields that carry it.
 *
 * Called for a new note and again for every password change, because a password
 * change re-keys. The generated key is extractable for exactly as long as it
 * takes to wrap it and is then dropped; what comes back is the unwrapped copy.
 */
export async function create(
  password: string,
  aad: Bytes,
): Promise<{ readonly key: CryptoKey; readonly locked: Locked }> {
  const salt = random(SALT_BYTES);
  const iv = random(IV_BYTES);
  const kek = await derive(password, salt);
  const draft = await crypto.subtle.generateKey(algorithm, true, ["encrypt", "decrypt"]);
  const wrapped = join(
    iv,
    new Uint8Array(await crypto.subtle.wrapKey("raw", draft, kek, params(iv, aad))),
  );
  return {
    key: await unwrap(kek, aad, wrapped),
    locked: { salt: toBase64(salt), key: toBase64(wrapped) },
  };
}

/**
 * The note key back out of a record.
 *
 * A wrong password arrives as a GCM tag mismatch, which WebCrypto reports as a
 * bare OperationError -- see `wrongPassword`.
 */
export async function unlock(locked: Locked, password: string, aad: Bytes): Promise<CryptoKey> {
  const wrapped = fromBase64(locked.key);
  if (wrapped.length <= IV_BYTES) throw new Error("the wrapped key is too short to be one");
  return unwrap(await derive(password, fromBase64(locked.salt)), aad, wrapped);
}

/** WebCrypto says the same thing however decryption failed, and this is what it is. */
export const wrongPassword = (cause: unknown): boolean =>
  cause instanceof DOMException && cause.name === "OperationError";

/**
 * The bytes that get sealed: counter, length, text, then zeros to the next
 * block. The length is what makes the padding removable, and it is inside the
 * ciphertext so that the padding is not distinguishable from the note.
 */
function frame({ counter, text }: Plain): Bytes {
  if (!Number.isInteger(counter) || counter < 1 || counter > 0xff_ff_ff_ff) {
    throw new Error("the save counter has run out of room");
  }
  const body = utf8.encode(text);
  const out = new Uint8Array(Math.ceil((HEADER_BYTES + body.length) / BLOCK_BYTES) * BLOCK_BYTES);
  const header = new DataView(out.buffer);
  header.setUint32(0, counter);
  header.setUint32(4, body.length);
  out.set(body, HEADER_BYTES);
  return out;
}

/** The other direction. Only reached once GCM has vouched for the bytes. */
function unframe(bytes: Bytes): Plain {
  if (bytes.length < HEADER_BYTES) throw new Error("the note is too short to be one");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = header.getUint32(4);
  if (HEADER_BYTES + length > bytes.length)
    throw new Error("the note claims to be longer than it is");
  return {
    counter: header.getUint32(0),
    text: new TextDecoder().decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + length)),
  };
}

/**
 * Every save re-encrypts the whole note under a fresh random iv. GCM's 96-bit
 * iv would only start to worry at billions of encryptions; a note saved every
 * few seconds for a lifetime is nowhere near that.
 */
export async function seal(key: CryptoKey, aad: Bytes, plain: Plain): Promise<Sealed> {
  const iv = random(IV_BYTES);
  const body = await crypto.subtle.encrypt(params(iv, aad), key, frame(plain));
  return { body: toBase64(join(iv, new Uint8Array(body))) };
}

/** The other direction. Fails if the note was sealed under a different key. */
export async function open(key: CryptoKey, aad: Bytes, sealed: Sealed): Promise<Plain> {
  const bytes = fromBase64(sealed.body);
  if (bytes.length <= IV_BYTES) throw new Error("ciphertext too short");
  const plain = await crypto.subtle.decrypt(
    params(bytes.subarray(0, IV_BYTES), aad),
    key,
    bytes.subarray(IV_BYTES),
  );
  return unframe(new Uint8Array(plain));
}

/**
 * The shortest password this app will set.
 *
 * Everywhere else a weak password is throttled by whoever holds the ciphertext.
 * Here nobody does: the record is world-readable and the wrapped key's GCM tag
 * answers each guess exactly, so the attack runs offline at whatever rate the
 * attacker can buy. 600,000 iterations makes each guess expensive; only length
 * makes there be too many of them. Four words clears this; three does not.
 */
export const MINIMUM = 16;

/** Crockford's alphabet: 32 symbols, so five bits of a random byte pick one evenly. */
const SYMBOLS = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * A password nobody has to invent.
 *
 * Twenty symbols is a hundred bits, which is past anything the offline attack
 * above can reach, and it is grouped because it will be read off a screen and
 * typed on a phone. Offered rather than imposed: a passphrase you can hold in
 * your head is fine too, as long as it is long.
 */
export const suggest = (): string =>
  Array.from(random(20), (byte) => SYMBOLS.charAt(byte & 31))
    .join("")
    .replace(/.{5}(?=.)/g, "$&-");
