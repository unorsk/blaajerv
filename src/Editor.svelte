<script lang="ts">
import { onMount } from "svelte";
import { explain } from "./lib/repo.ts";

interface Props {
  /** The note as it stands on the PDS, decrypted. The draft starts here. */
  readonly text: string;
  readonly who: string | null;
  readonly autosave: boolean;
  readonly onsave: (text: string) => Promise<void>;
  readonly onreload: () => Promise<string>;
  readonly onsettings: () => void;
}

const { text: initial, who, autosave, onsave, onreload, onsettings }: Props = $props();

/** Long enough that a burst of typing lands as one write, short enough to forget about. */
const SAVE_DELAY = 2000;

type Status =
  | { readonly kind: "clean" }
  | { readonly kind: "dirty" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly at: Date }
  | { readonly kind: "error"; readonly message: string };

// svelte-ignore state_referenced_locally
let text = $state(initial);
let status = $state<Status>({ kind: "clean" });

// Not $state: none of it is rendered, and making the in-flight flags reactive
// would only invite re-entrancy through effects.
let dirty = false;
let saving = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function save(): Promise<void> {
  clearTimeout(timer);
  if (!dirty || saving) return;
  saving = true;
  status = { kind: "saving" };
  // The text can move on while the request is in flight, so what was actually
  // written has to be compared against what is on screen afterwards.
  const written = text;
  let ok = false;
  try {
    await onsave(written);
    ok = true;
    if (written === text) {
      dirty = false;
      status = { kind: "saved", at: new Date() };
    } else {
      status = { kind: "dirty" };
    }
  } catch (cause) {
    // No automatic retry: a conflict or an expired session would just loop
    // against the PDS. Typing again, or ⌘S, asks for another attempt.
    status = { kind: "error", message: explain(cause) };
  } finally {
    saving = false;
  }
  if (ok && dirty && autosave) schedule();
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void save(), SAVE_DELAY);
}

function touch(): void {
  dirty = true;
  status = { kind: "dirty" };
  // Off by default: a save publishes a record, and that should be something
  // you asked for. Settings turns it on for a note you type into all day.
  if (autosave) schedule();
}

function keydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === "s") {
    event.preventDefault();
    void save();
  }
}

async function reload(): Promise<void> {
  if (dirty && !confirm("Discard unsaved changes and reload from your PDS?")) return;
  clearTimeout(timer);
  status = { kind: "saving" };
  try {
    text = await onreload();
    dirty = false;
    status = { kind: "clean" };
  } catch (cause) {
    status = { kind: "error", message: explain(cause) };
  }
}

/** Settings can write the record too, so leaving with a draft has to be asked about. */
function leave(): void {
  if (dirty && !confirm("Discard unsaved changes and leave the note?")) return;
  onsettings();
}

onMount(() => {
  // The phone is where edits get lost: switching apps can kill the tab without
  // ever firing beforeunload, but it always goes hidden first. With autosave
  // off nothing is written behind your back, so the guard is all there is.
  const flush = (): void => {
    if (autosave && document.visibilityState === "hidden") void save();
  };
  const guard = (event: BeforeUnloadEvent): void => {
    if (dirty) event.preventDefault();
  };
  document.addEventListener("visibilitychange", flush);
  window.addEventListener("beforeunload", guard);

  return () => {
    document.removeEventListener("visibilitychange", flush);
    window.removeEventListener("beforeunload", guard);
    clearTimeout(timer);
  };
});

const clock = (at: Date): string =>
  at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
</script>

<div class="bar">
  <h1>blaajerv</h1>
  <span class="where dim">{who ?? ""}</span>
  <span class="rule"></span>
  <span class="status">
    {#if status.kind === "saving"}
      <span class="dim">saving</span>
    {:else if status.kind === "saved"}
      <span class="ok">saved {clock(status.at)}</span>
    {:else if status.kind === "dirty"}
      <span class="dim">unsaved</span>
    {:else if status.kind === "error"}
      <span class="bad">{status.message}</span>
    {:else}
      <span class="dim">·</span>
    {/if}
  </span>
</div>

<textarea
  bind:value={text}
  oninput={touch}
  onkeydown={keydown}
  autocapitalize="sentences"
  autocorrect="off"
  spellcheck="false"
></textarea>

<nav>
  <button class="link" onclick={() => void save()}>save</button>
  <button class="link" onclick={() => void reload()}>reload</button>
  <button class="link" onclick={leave}>settings</button>
  <span>⌘S save{autosave ? " · autosave on" : ""}</span>
</nav>
