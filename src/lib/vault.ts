/**
 * Where a remembered note key sits between visits.
 *
 * The convenient thing to keep is the password, and it is the wrong one. A
 * password is the secret most likely to be reused somewhere else, and in
 * `localStorage` it is a string on disk that outlives the tab, the browser and
 * often the machine.
 *
 * The note key is reused nowhere, and IndexedDB will store a `CryptoKey` as
 * itself rather than as bytes -- so it goes in non-extractable, and script on
 * this origin can ask WebCrypto to decrypt with it but cannot read it out or
 * carry it anywhere. Ticking the box now trades a secret for a capability,
 * which is a better trade than it was.
 *
 * Keyed by DID, so signing in as somebody else on the same browser does not
 * hand them the first account's note.
 */

const DB = "blaajerv";
const STORE = "keys";

const database = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open the key store"));
  });

/** One request, one transaction, one connection -- there is never more than one in flight. */
async function run<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = act(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("the key store failed"));
    });
  } finally {
    db.close();
  }
}

/** Writes or erases in one call, so the checkbox and the store cannot disagree. */
export const keep = async (did: string, key: CryptoKey, remember: boolean): Promise<void> => {
  await (remember ? run("readwrite", (store) => store.put(key, did)) : discard(did));
};

/** Null unless this device was told to remember, and IndexedDB is available. */
export async function recall(did: string): Promise<CryptoKey | null> {
  try {
    const found = await run<unknown>("readonly", (store) => store.get(did));
    return found instanceof CryptoKey ? found : null;
  } catch {
    // Private windows and storage pressure both take this away. Asking for the
    // password again is the right answer to that, not an error.
    return null;
  }
}

export const discard = async (did: string): Promise<void> => {
  await run("readwrite", (store) => store.delete(did)).catch(() => undefined);
};
