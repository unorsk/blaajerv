<script lang="ts">
import { MINIMUM, suggest, wrongPassword } from "./lib/crypto.ts";
import { explain } from "./lib/repo.ts";

interface Props {
  /** True to unlock an existing note, false to choose the password for a new one. */
  readonly existing: boolean;
  readonly remember: boolean;
  readonly who: string | null;
  readonly onsubmit: (password: string, remember: boolean) => Promise<void>;
  readonly onsignout: () => void;
}

const { existing, remember, who, onsubmit, onsignout }: Props = $props();

let password = $state("");
let confirm = $state("");
// The prop is the stored default; the box is the user's, from here on.
// svelte-ignore state_referenced_locally
let keep = $state(remember);
let busy = $state(false);
let error = $state<string | null>(null);

// An existing note is unlocked by whatever it was locked with; only a password
// being *set* has to clear the floor.
const ready = $derived(
  existing ? password !== "" : password.length >= MINIMUM && password === confirm,
);

const short = $derived(!existing && password !== "" && password.length < MINIMUM);

// A generated password is no use in a field that renders it as dots, so it is
// shown as text until it is typed over -- at which point it is no longer what
// is in the box, and saying otherwise would be a lie.
let generated = $state("");
const showing = $derived(generated !== "" && password === generated);

function fill(): void {
  generated = suggest();
  password = generated;
  confirm = generated;
}

async function go(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!ready || busy) return;
  busy = true;
  error = null;
  try {
    await onsubmit(password, keep);
  } catch (cause) {
    error = wrongPassword(cause) ? "wrong password" : explain(cause);
    busy = false;
  }
}
</script>

<div class="bar">
  <h1>blaajerv</h1>
  <span class="where dim">{who ?? ""}</span>
  <span class="rule"></span>
  <span class="status">
    {#if error}
      <span class="bad">{error}</span>
    {:else if busy}
      <span class="dim">{existing ? "unlocking" : "generating a key"}</span>
    {:else}
      <span class="dim">locked</span>
    {/if}
  </span>
</div>

<div class="pane">
  {#if existing}
    <p class="note">The password that unlocks this note. It is not stored anywhere but here.</p>
  {:else}
    <p class="note warn">
      Choose a password. It wraps the key this browser just generated, and that
      key is the only way back into the note — there is nobody holding a copy,
      so nobody can reset it. Pick something you will still have in a year.
    </p>
    <p class="note">
      Length is the whole of it. Your record sits in a public repo, so anyone can
      fetch it and guess at the password offline for as long as they like — with
      nothing on the other end to slow them down or notice. Four words clears
      that; three does not. Minimum {MINIMUM} characters, or take a generated one.
    </p>
  {/if}

  <form onsubmit={go}>
    <label for="password">password</label>
    <div class="row">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="password"
        type="password"
        bind:value={password}
        autocomplete={existing ? "current-password" : "new-password"}
        disabled={busy}
        autofocus
      />
      {#if existing}
        <button type="submit" disabled={busy || !ready}>unlock</button>
      {/if}
    </div>

    {#if !existing}
      <label for="confirm">again</label>
      <div class="row">
        <input
          id="confirm"
          type="password"
          bind:value={confirm}
          autocomplete="new-password"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !ready}>set</button>
        <button class="ghost" type="button" onclick={fill} disabled={busy}>suggest</button>
      </div>
      {#if showing}
        <p class="note warn">{generated} — save this somewhere before you continue.</p>
      {:else if short}
        <p class="note">{MINIMUM - password.length} more characters.</p>
      {/if}
    {/if}
  </form>

  <button class="toggle" type="button" onclick={() => (keep = !keep)}>
    [{keep ? "x" : " "}] keep the password in this browser
  </button>
  <p class="note">
    {keep
      ? "This device will open the note without asking. Anything else that can run script on this origin can read the password out of localStorage."
      : "The password is asked for again on every reload."}
  </p>
</div>

<nav>
  <button class="link" onclick={onsignout}>sign out</button>
</nav>
