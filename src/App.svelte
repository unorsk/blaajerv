<script lang="ts">
import { BrowserOAuthClient, type OAuthSession } from "@atproto/oauth-client-browser";
import { onMount } from "svelte";
import Editor from "./Editor.svelte";
import { create, type Locked, open, seal, unlock, wrongPassword } from "./lib/crypto.ts";
import { clientId } from "./lib/oauth.ts";
import { context, type Note, VERSION } from "./lib/record.ts";
import { explain, handle, read, type Stored, write } from "./lib/repo.ts";
import {
  forget,
  loadSeen,
  loadSettings,
  resetSeen,
  type Settings,
  saveSeen,
  saveSettings,
} from "./lib/settings.ts";
import { discard, keep, recall } from "./lib/vault.ts";
import Password from "./Password.svelte";
import SettingsPane from "./Settings.svelte";
import SignIn from "./SignIn.svelte";

/**
 * Where handles are turned into the DID and PDS behind them. Only the
 * resolution is bsky.social's business -- the sign-in itself happens on
 * whichever server the account actually lives on.
 */
const HANDLE_RESOLVER = "https://bsky.social";

type Stage =
  | { readonly kind: "starting" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "signin" }
  /** Existing is the record to unlock; null means there is no note yet, so pick a password. */
  | { readonly kind: "password"; readonly existing: Stored | null }
  | { readonly kind: "open"; readonly key: CryptoKey; readonly text: string };

let stage = $state<Stage>({ kind: "starting" });
let settings = $state<Settings>(loadSettings());
let who = $state<string | null>(null);
let view = $state<"edit" | "settings">("edit");

// None of this is rendered. Keeping it out of $state keeps the record's version
// out of reach of an effect, which is the last place a cid should be changed.
let client: BrowserOAuthClient | null = null;
let session: OAuthSession | null = null;
let stored: Stored | null = null;
/** Which save the held record is. Sealed inside it, and one higher on the next write. */
let counter = 0;

onMount(() => {
  void begin();
});

async function begin(): Promise<void> {
  try {
    client = await BrowserOAuthClient.load({
      clientId: clientId(location),
      handleResolver: HANDLE_RESOLVER,
    });
    // Finishes a sign-in if the tab came back from one, and otherwise picks up
    // the session this browser already had.
    const result = await client.init();
    if (!result) {
      stage = { kind: "signin" };
      return;
    }
    await adopt(result.session);
  } catch (cause) {
    stage = { kind: "failed", message: explain(cause) };
  }
}

/** Signed in. What happens next depends on whether a note is already there. */
async function adopt(next: OAuthSession): Promise<void> {
  session = next;
  who = null;
  void handle(next).then((found) => {
    who = found;
  });

  stored = await read(next);
  const remembered = stored ? await recall(next.did) : null;
  if (stored && remembered) {
    try {
      await enter(remembered);
      return;
    } catch (cause) {
      // Kept from before a password change on another device, which re-keyed
      // the note. Anything else -- a wound-back repo above all -- is not ours
      // to swallow.
      if (!wrongPassword(cause)) throw cause;
      await discard(next.did);
    }
  }
  stage = { kind: "password", existing: stored };
}

/** The note, decrypted, once the version it claims to be has been believed. */
async function enter(key: CryptoKey): Promise<string> {
  if (!session || !stored) throw new Error("there is no note to open");
  const plain = await open(key, context(session.did), stored.note);
  // A repo can only move forwards. One that has gone backwards is a server
  // replaying an old note, not an old note.
  if (plain.counter < loadSeen(session.did)) {
    throw new Error("the server sent an older note than this device has seen — refusing it");
  }
  saveSeen(session.did, plain.counter);
  counter = plain.counter;
  stage = { kind: "open", key, text: plain.text };
  return plain.text;
}

/** One place that numbers the next save, writes it, and records that it happened. */
async function publish(key: CryptoKey, text: string, locked?: Locked): Promise<void> {
  if (!session || !stored) throw new Error("the note is not open");
  const next = counter + 1;
  const note: Note = {
    ...stored.note,
    ...locked,
    ...(await seal(key, context(session.did), { counter: next, text })),
    updatedAt: new Date().toISOString(),
  };
  stored = { note, cid: await write(session, note, stored.cid) };
  counter = next;
  saveSeen(session.did, next);
}

/**
 * Setting a password writes the record straight away, rather than waiting for
 * the first save: the key it wraps is what every later save encrypts under, and
 * a key that only exists in a tab is one a refresh throws away.
 */
async function submit(chosen: string, remember: boolean): Promise<void> {
  if (!session) throw new Error("not signed in");
  const { did } = session;
  let key: CryptoKey;
  if (stored) {
    key = await unlock(stored.note, chosen, context(did));
  } else {
    const made = await create(chosen, context(did));
    key = made.key;
    const note: Note = {
      v: VERSION,
      ...made.locked,
      ...(await seal(key, context(did), { counter: 1, text: "" })),
      updatedAt: new Date().toISOString(),
    };
    // Before the write, so that a note being made from nothing is not measured
    // against the counter of one that is gone.
    resetSeen(did);
    stored = { note, cid: await write(session, note, null) };
  }
  change({ ...settings, remember });
  await keep(did, key, remember);
  await enter(key);
}

/** Every write goes through `publish`, so there is one place that holds the cid. */
async function save(text: string): Promise<void> {
  if (stage.kind !== "open") throw new Error("the note is not open");
  // The wrapped key is carried through untouched; only the body is rewritten.
  await publish(stage.key, text);
}

/** Throws the local draft away and returns what the PDS has. */
async function reload(): Promise<string> {
  if (!session || stage.kind !== "open") throw new Error("the note is not open");
  const { key } = stage;
  stored = await read(session);
  if (!stored) throw new Error("the note is no longer in your repo");
  return enter(key);
}

function change(next: Settings): void {
  saveSettings(next);
  settings = next;
}

/** The box in settings, after the fact -- the key is already unwrapped. */
async function remember(on: boolean): Promise<void> {
  if (session && stage.kind === "open") await keep(session.did, stage.key, on);
  change({ ...settings, remember: on });
}

/**
 * A new password re-keys the note rather than re-wrapping it.
 *
 * The old wrapped key was published and stays published: re-wrapping alone
 * would leave a key that anyone who ever cracks the old password can still use
 * on every save made afterwards, which is the one thing changing a password is
 * supposed to stop. So the note gets a new key and is sealed under it, all in
 * the single write that the wrapped key and the note sharing a record buys.
 */
async function repassword(next: string): Promise<void> {
  if (!session || !stored || stage.kind !== "open") throw new Error("the note is not open");
  const { did } = session;
  const { text } = await open(stage.key, context(did), stored.note);
  const made = await create(next, context(did));
  await publish(made.key, text, made.locked);
  await keep(did, made.key, settings.remember);
  stage = { kind: "open", key: made.key, text };
}

async function signOut(): Promise<void> {
  if (session) {
    forget();
    await discard(session.did);
    await session.signOut().catch(() => undefined);
  }
  location.reload();
}
</script>

{#if stage.kind === "open" && view === "settings"}
  <SettingsPane
    {settings}
    {who}
    onautosave={(on) => change({ ...settings, autosave: on })}
    onremember={(on) => void remember(on)}
    onpassword={repassword}
    onsignout={() => void signOut()}
    onclose={() => (view = "edit")}
  />
{:else if stage.kind === "open"}
  <Editor
    text={stage.text}
    {who}
    autosave={settings.autosave}
    onsave={save}
    onreload={reload}
    onsettings={() => (view = "settings")}
  />
{:else if stage.kind === "password"}
  <Password
    existing={stage.existing !== null}
    remember={settings.remember}
    {who}
    onsubmit={submit}
    onsignout={() => void signOut()}
  />
{:else if stage.kind === "signin"}
  <SignIn onsignin={(input) => (client ? client.signInRedirect(input) : Promise.resolve())} />
{:else}
  <div class="bar">
    <h1>blaajerv</h1>
    <span class="rule"></span>
    <span class="status">
      {#if stage.kind === "failed"}
        <span class="bad">{stage.message}</span>
      {:else}
        <span class="dim">starting</span>
      {/if}
    </span>
  </div>
  <div class="pane">
    {#if stage.kind === "failed"}
      <p class="note">
        The app could not start. Reload to try again; if it keeps happening the
        PDS or the sign-in server is unreachable.
      </p>
      <div class="row">
        <button onclick={() => location.reload()}>reload</button>
      </div>
    {/if}
  </div>
{/if}
