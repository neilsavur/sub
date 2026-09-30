# Layers — Subliminal + Music Multi-Layer Player

A web app, installed on iPhone via Safari → Add to Home Screen, that plays any number of audio
layers mixed into one output: a subliminal looping underneath, plus music playlists, ambient
tracks, more subliminals — each with its own volume. Mixed through the Web Audio API so iOS treats
it as a single audio session, with lock-screen controls and playback that survives the screen
locking.

**Live:** https://neilsavur.github.io/sub/

## The gating question, answered

The whole design rested on one unverified thing: whether a playlist layer advances from track to
track *while the screen is locked*. Reports suggested the next track might only start on unlock.

`spike/` was a throwaway test page built to answer exactly that, and it was **tested on-device:
playback continues and the playlist rolls over correctly while locked.** So the straightforward
design — one media element per layer, advancing on the `ended` event — is what the app uses.
The spike is kept in the repo as a diagnostic tool, not as part of the app.

## What it does

- **Unlimited layers.** No fixed cap; `+ Add layer` any time. Layers are entries in a `Map`, so
  each one is just another node chain.
- **Loop or playlist, per layer.** Loop repeats one track forever; playlist walks its tracks in
  order and starts again.
- **Independent volume** per layer, plus mute and a master volume.
- **Your own files.** Upload MP3s (or m4a/wav/aiff) into the library; stored on-device in IndexedDB.
- **Presets.** Save a named snapshot of the whole setup — which files, loop vs playlist, volumes,
  mute states — and load it back.
- **Lock screen.** Now-playing metadata and play/pause/next through the Media Session API.
- **Session memory.** Reopening the app restores the layers you left set up.

## Installing it on the phone

Open https://neilsavur.github.io/sub/ in **Safari** → Share → **Add to Home Screen**, then launch
it from the icon. It must run standalone rather than in a Safari tab — backgrounding behaves
differently in a tab.

## How it fits together

```
index.html / style.css / app.js      UI wiring, transport, media session, persistence
audio/mixer.js                       the AudioContext, master bus, the layer Map
audio/layer.js                       one layer: element -> gain -> master, loop or playlist
storage/db.js                        IndexedDB wrapper (files + presets stores)
storage/files.js                     the audio library; blobs in, object URLs out
storage/presets.js                   named layer snapshots
ui/layerView.js                      the layer cards
ui/library.js                        upload / pick / delete sheet
ui/presets.js                        save / load / delete sheet
sw.js                                app-shell cache (audio never goes in here)
spike/                               the original lock-screen diagnostic page
```

### Three decisions that are load-bearing on iOS

Changing any of these will break background playback in ways that are hard to debug, so they are
commented in place:

1. **`HTMLAudioElement` + `createMediaElementSource`, not `AudioBufferSourceNode`.** iOS ties
   background playback and the now-playing session to a real media element. A pure buffer graph
   often gets no lock-screen presence at all.
2. **One element per layer, reused for every track by swapping `src`.** iOS grants playback
   permission to an element once it has played inside a user gesture. A *new* element created later
   — while locked, say — would be blocked from starting.
3. **Nothing the lock screen depends on sits behind `requestAnimationFrame`.** rAF does not fire
   while the page is hidden, which is exactly the locked case; media-session updates run
   synchronously, and only the layer-list DOM rebuild is deferred.

## Storage

Audio lives in IndexedDB on the device. The app requests persistent storage, but **iOS can still
evict it** — the footer shows how much space is in use. Keep your original files in the Files app
as backup. Large files are also worth re-encoding: a subliminal at 128 kbps MP3 is roughly a tenth
the size of a WAV with no audible difference for that kind of layer.

## Developing

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/. No build step and no dependencies — plain ES modules.

Deploys are automatic: pushing to `main` publishes to GitHub Pages.

## Known limits

- Service workers do not register in some embedded/preview browsers; this is caught and ignored,
  and only affects offline use.
- The volume slider is disabled while a layer is muted — unmute to adjust it.
- Track reordering within a playlist is not implemented; remove and re-add to change the order.
