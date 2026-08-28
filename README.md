# blaajerv

One note, encrypted in the browser, kept in your atproto repo.

There is no backend. The page runs on GitHub Pages, signs you in to whichever
PDS your handle points at, and writes a single record there. Encryption happens
before the record leaves the tab, so the PDS stores ciphertext and a salt and
never sees anything else — which matters more here than it does for a
private file somewhere, because a repo is a public, replicated store by design.
Anyone can fetch the record. Nobody can read it.

## Setup

**1. A repo, and Pages turned on.** Settings → Pages → Source: *GitHub Actions*.
Push to `main` and `.github/workflows/deploy.yml` builds and publishes.

**2. Nothing else.** No token, no app password, no key to copy between devices.
An atproto OAuth client has no secret — it is a page, and a page cannot keep
one — so the client id *is* the URL of a document describing this app, and the
build writes that document with the address Pages assigned. That is the whole
reason the workflow runs `actions/configure-pages` before building.

**3. Open the page and sign in** with your handle. The PDS asks for your
password, not this page; what comes back is a token scoped to your repo.

## The password

The first time in, you choose one. It is not the key.

The key is 32 random bytes generated in the browser, and the note is encrypted
under it with AES-256-GCM. The password never touches the note: it is stretched
with PBKDF2-HMAC-SHA256 at 600,000 iterations into a key that wraps the note
key, and it is the wrapped key that goes in the record. The password itself
never leaves the device.

**Make it long.** This is the one thing asked of you, and the reason is the same
reason the app exists: the record is *published*. Anyone who knows your DID can
fetch the salt and the wrapped key, keep them, and guess at the password offline
for as long as they like — no server on the other end to slow them down, lock
them out, or notice. 600,000 iterations makes each guess expensive; only length
makes there be too many of them to try. Four words clears that comfortably.
Three does not. The minimum is sixteen characters, and **suggest** will generate
one if you would rather not invent it.

The cost is the usual one. Nobody is holding anything to reset it with: forget
the password and the note is unreadable, by construction.

### Changing it

A new password does not re-wrap the old key — it mints a new one and re-seals
the note under it, in the same single write.

Re-wrapping would be cheaper and would be wrong. The old wrapped key is in a
public repo and stays there; anyone who ever breaks the old password recovers
whatever key it wrapped. If that were still the note's key, they would be able
to read everything you wrote *after* the change, which is precisely what
changing a password is meant to stop. Re-keying costs one re-encryption of a
text note, and buys the property back.

What it cannot do is un-read what was already read. A change protects the
future, not the past.

### Keeping it

**keep this note unlocked in this browser** stores the note's key, not the
password, and stores it in IndexedDB as a key rather than as text — so it cannot
be read back out, only used. The password is never written to disk at all. That
matters because a password is the secret most likely to be reused somewhere
else, and a key that only opens this note is not.

Anything that can run script on this origin can still *use* that key while it is
there. Right for a phone you hold, wrong for a machine you share. Off is the
default, and then the password is asked for on every reload.

## Using it

Nothing is written until you ask: **save**, or `⌘S`. Leaving the note with
unsaved changes asks first, and so does closing the tab. **autosave** in
settings gives the other behaviour — two seconds after you stop typing, and
again when the tab goes to the background, which suits a note you type into all
day. Off is the default: a save publishes a record.

Nothing merges. Every write carries the `cid` the note was read at, and the PDS
refuses it if the record has moved on since — so the phone cannot silently
overwrite an edit made on the laptop. Hit **reload** and redo the losing edit.

## What is stored

One record, at `io.github.unorsk.blaajerv.note/self`. One note per person, which
is why the rkey is a constant rather than a timestamp, and why opening the app
is one fetch and lands you in the editor rather than in a list.

```
v          1                     the scheme these bytes were written under
salt       16 bytes, base64      PBKDF2 salt, not a secret
key        iv ++ ciphertext      the note key, wrapped under the password
body       iv ++ ciphertext      counter ++ length ++ note ++ padding
updatedAt  ISO 8601              a label, not evidence — see below
```

Key and note live in the same record so that a save is one write, and so that
changing the password is atomic with the note it was changed over.

Both ciphertexts are authenticated against `collection/rkey/version/did`, so a
record lifted into somebody else's repo fails as a forgery rather than opening.

The note is padded to a kilobyte boundary before it is sealed, because GCM hides
what a note says and not how long it is, and a public log would otherwise
publish the exact byte count after every keystroke burst. The padding is inside
the ciphertext, which is why the true length is stored there too.

The counter is the version tag `updatedAt` cannot be. It is sealed *inside* the
body, so a server cannot choose it, and it only rises. Each device remembers the
highest it has opened and refuses anything lower — which is what catches a PDS
that serves last month's record as though it were current. `swapRecord` catches
a racing client; this catches a lying server. A device that has never seen the
note has nothing to compare against, necessarily.

## What is not hidden

Nobody can read the note. Things about it are still public, and a repo is
replicated and streamed to anyone subscribed:

- **its rough size**, in kilobyte steps, which is what the padding leaves.
- **when you save.** `updatedAt`, and the write itself appearing on the
  firehose. With autosave on, that is a timestamped trace of when you were
  typing, at two-second resolution.
- **that you use this app at all**, since the collection is named after it.

None of that is fixable from inside the record, and none of it is a reason not
to keep the note here — but it should be known rather than discovered.

The requested scope is `atproto transition:generic`, which is broader than this
app needs — it is every collection in your repo, not just ours. It is what
every PDS understands today; a narrower one would be better and is the obvious
thing to tighten when it is universally available.

## What the page is trusted with

All of this rests on nothing else running script on this origin, so two things
enforce that rather than assume it.

The built page declares a `default-src 'none'` policy: one same-origin module,
one same-origin stylesheet, one same-origin font, and nothing inline. It is
emitted by the build rather than written into `index.html`, because the dev
server needs a websocket and injects its stylesheets from script, and a policy
loose enough for that would not be worth having. The one directive that cannot
be narrowed is `connect-src`, since a PDS can be any host — it is bounded to
`https:` and no further. `frame-ancestors` is missing because Pages cannot send
headers and a meta-tag policy cannot carry it.

The note key is never extractable. It is generated extractable for exactly as
long as it takes to wrap it, and the copy the session gets cannot be exported at
all — so script that gets a foothold can use the key while the tab is open, but
cannot take it away.

## Handles

`https://bsky.social` resolves a handle to the DID and PDS behind it. That is
all it is used for: the sign-in itself happens on whichever server the account
actually lives on, so a self-hosted account works exactly as a bsky.social one
does.

## Development

```
npm run dev        # local server
npm run check      # lint, typecheck, test, build
```

Locally there is no https and nothing to fetch a client document from, so the
spec's loopback rule applies: the whole document is encoded into the client id,
and the tab is moved from `localhost` to `127.0.0.1` because a redirect uri has
to name an origin by IP. `npm run build` without `SITE_URL` says plainly that it
emitted no `client-metadata.json`, rather than emitting one pointing at the
wrong place.

The font is JetBrains Mono Nerd Font, whole, taken from
[jerv](https://github.com/unorsk/jerv) — every icon in it is one you can paste
into the note and see. It is served as its own request rather than inlined: the
stylesheet declares two faces off the one file, so text swaps in from the system
monospace immediately and only the icon planes block, since nothing on the
system could stand in for those codepoints.
