<script lang="ts">
import { explain } from "./lib/repo.ts";

interface Props {
  /** Redirects the tab, so it only ever returns by failing. */
  readonly onsignin: (input: string) => Promise<unknown>;
}

const { onsignin }: Props = $props();

let input = $state("");
let busy = $state(false);
let error = $state<string | null>(null);

async function go(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const handle = input.trim().replace(/^@/, "");
  if (!handle || busy) return;
  busy = true;
  error = null;
  try {
    await onsignin(handle);
  } catch (cause) {
    error = explain(cause);
    busy = false;
  }
}
</script>

<div class="bar">
  <h1>blaajerv</h1>
  <span class="where dim">sign in</span>
  <span class="rule"></span>
  <span class="status">
    {#if error}
      <span class="bad">{error}</span>
    {:else if busy}
      <span class="dim">redirecting</span>
    {:else}
      <span class="dim">·</span>
    {/if}
  </span>
</div>

<div class="pane">
  <p class="note">
    One note, encrypted here and kept in your atproto repo. Sign in with your
    handle; the password comes next, and is never sent anywhere.
  </p>

  <form onsubmit={go}>
    <label for="handle">handle</label>
    <div class="row">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="handle"
        bind:value={input}
        placeholder="you.bsky.social"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        autocomplete="username"
        disabled={busy}
        autofocus
      />
      <button type="submit" disabled={busy}>sign in</button>
    </div>
  </form>
</div>

<nav>
  <span>your PDS asks for the password, not this page</span>
</nav>
