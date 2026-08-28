/**
 * The two switches, and how far along the note this device has seen.
 *
 * Nothing here is synced. Autosave and a remembered key are properties of a
 * device -- the laptop at home can hold the key, the one at work should not --
 * and putting them in the record would be deciding that for every device at
 * once.
 *
 * No secret is kept here. The remembered note key lives in IndexedDB, where it
 * can be stored as a key rather than as a string: see vault.ts.
 */

const SETTINGS = "blaajerv.settings";
const SEEN = "blaajerv.seen";

export interface Settings {
  /** Off by default: a save publishes a record, and that should be something you asked for. */
  readonly autosave: boolean;
  /** Whether the note key stays on this device. Off by default too. */
  readonly remember: boolean;
}

export const DEFAULTS: Settings = { autosave: false, remember: false };

/** Separate from the loading so it can be tested without a browser. */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Both off unless they were turned on, whatever else is in the blob.
    return { autosave: parsed.autosave === true, remember: parsed.remember === true };
  } catch {
    return DEFAULTS;
  }
}

export const loadSettings = (): Settings => parseSettings(localStorage.getItem(SETTINGS));

export const saveSettings = (settings: Settings): void =>
  localStorage.setItem(SETTINGS, JSON.stringify(settings));

/**
 * The highest save counter this device has ever opened.
 *
 * A PDS is trusted to hold the note, not to be honest about which version of it
 * is current, and `swapRecord` only catches a racing client. This is the thing
 * that catches a server: a repo wound back to last month still decrypts, but it
 * decrypts to a counter lower than one already seen here, and that is a lie
 * rather than an old note.
 *
 * Trust on first use, necessarily -- a device that has seen nothing has nothing
 * to compare against. Nothing here is secret, so it survives signing out.
 */
export function parseSeen(raw: string | null): number {
  const seen = Number(raw);
  return Number.isSafeInteger(seen) && seen > 0 ? seen : 0;
}

const slot = (did: string): string => `${SEEN}:${did}`;

export const loadSeen = (did: string): number => parseSeen(localStorage.getItem(slot(did)));

export const saveSeen = (did: string, counter: number): void => {
  if (counter > loadSeen(did)) localStorage.setItem(slot(did), String(counter));
};

/**
 * Only for a note this device is creating from nothing.
 *
 * A repo with no record in it has no history to be wound back to, and a counter
 * left over from a note that has been deleted would refuse the replacement --
 * locking the owner out of a note they just made. Losing the note is a visible
 * failure, which is a different thing from the silent one this guards.
 */
export const resetSeen = (did: string): void => localStorage.removeItem(slot(did));

/** Signing out leaves the note in the repo and no secret on the device. */
export const forget = (): void => localStorage.removeItem(SETTINGS);
