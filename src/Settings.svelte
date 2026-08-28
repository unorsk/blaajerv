<script lang="ts">
import { MINIMUM, suggest } from "./lib/crypto.ts";
import { explain } from "./lib/repo.ts";
import type { Settings } from "./lib/settings.ts";

interface Props {
  readonly settings: Settings;
  readonly who: string | null;
  readonly onautosave: (on: boolean) => void;
  readonly onremember: (on: boolean) => void;
  readonly onpassword: (password: string) => Promise<void>;
  readonly onsignout: () => void;
  readonly onclose: () => void;
}

const { settings, who, onautosave, onremember, onpassword, onsignout, onclose }: Props = $props();

let changing = $state(false);
let password = $state("");
let confirm = $state("");
let busy = $state(false);
let status = $state<{ readonly kind: "ok" | "bad"; readonly message: string } | null>(null);

const ready = $derived(password.length >= MINIMUM && password === confirm);

let generated = $state("");
const showing = $derived(generated !== "" && password === generated);

function fill(): void {
  generated = suggest();
  password = generated;
  confirm = generated;
}

async function change(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!ready || busy) return;
  busy = true;
  status = null;
  try {
    await onpassword(password);
    password = "";
    confirm = "";
    changing = false;
    status = { kind: "ok", message: "password changed" };
  } catch (cause) {
    status = { kind: "bad", message: explain(cause) };
  } finally {
    busy = false;
  }
}

function signOut(): void {
  const warning = settings.remember
    ? "Sign out, and forget the key kept in this browser? The note stays in your repo."
    : "Sign out? The note stays in your repo.";
  if (confirmDialog(warning)) onsignout();
}

// Named so the local `confirm` field does not shadow the global one.
const confirmDialog = (message: string): boolean => window.confirm(message);
</script>

<div class="bar">
  <h1>blaajerv</h1>
  <span class="where dim">settings</span>
  <span class="rule"></span>
  <span class="status">
    {#if status}
      <span class={status.kind === "ok" ? "ok" : "bad"}>{status.message}</span>
    {:else}
      <span class="dim">{who ?? ""}</span>
    {/if}
  </span>
</div>

<div class="pane">
  <button class="toggle" type="button" onclick={() => onautosave(!settings.autosave)}>
    [{settings.autosave ? "x" : " "}] autosave
  </button>
  <p class="note">
    Two seconds after you stop typing, and again when the tab goes to the
    background. Off, nothing is written until you ask for it.
  </p>

  <button class="toggle" type="button" onclick={() => onremember(!settings.remember)}>
    [{settings.remember ? "x" : " "}] keep this note unlocked in this browser
  </button>
  <p class="note">
    Off, the password is asked for on every reload. On, the note's key stays in
    this browser so it opens without asking — the password itself is never
    stored. The key cannot be read back out, but anything that can run script on
    this origin can use it. Convenient on a phone you hold, wrong on a machine
    you share.
  </p>

  {#if changing}
    <form onsubmit={change}>
      <label for="new-password">new password</label>
      <div class="row">
        <input id="new-password" type="password" bind:value={password} autocomplete="new-password" disabled={busy} />
      </div>
      <label for="new-confirm">again</label>
      <div class="row">
        <input id="new-confirm" type="password" bind:value={confirm} autocomplete="new-password" disabled={busy} />
        <button type="submit" disabled={busy || !ready}>change</button>
        <button class="ghost" type="button" onclick={fill} disabled={busy}>suggest</button>
        <button class="ghost" type="button" onclick={() => (changing = false)} disabled={busy}>
          cancel
        </button>
      </div>
      {#if showing}
        <p class="note warn">{generated} — save this somewhere before you continue.</p>
      {:else if password !== "" && password.length < MINIMUM}
        <p class="note">{MINIMUM - password.length} more characters.</p>
      {/if}
    </form>
    <p class="note">
      The note is re-keyed, not just re-wrapped. The old wrapped key is in a
      public repo and stays there, so leaving the note under the same key would
      mean anyone who ever breaks the old password can still read everything you
      write from here on — which is the one thing changing a password is for.
      One write, and the old password opens nothing current.
    </p>
  {:else}
    <div class="row">
      <button class="ghost" type="button" onclick={() => (changing = true)}>change password</button>
      <button class="ghost push" type="button" onclick={signOut}>sign out</button>
    </div>
  {/if}
</div>

<nav>
  <button class="link" onclick={onclose}>note</button>
</nav>
